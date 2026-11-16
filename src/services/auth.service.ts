import type { RoleName } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { SELF_REGISTRATION_ELIGIBLE_ROLES } from '../rbac/permissions';
import { refreshTokenRepository } from '../repositories/refreshToken.repository';
import { roleRepository } from '../repositories/role.repository';
import { userRepository, type UserWithRole } from '../repositories/user.repository';
import { sha256 } from '../utils/crypto';
import { Errors } from '../utils/errors';
import type { RequestContext } from '../utils/requestContext';
import type { ChangePasswordInput, LoginInput, RegisterInput } from '../validators/auth.validators';
import { auditService, type AuditActor } from './audit.service';
import { notificationService } from './notification.service';
import { passwordService } from './password.service';
import { permissionService } from './permission.service';
import { settingsService } from './settings.service';
import { tokenService, type IssuedRefreshToken } from './token.service';
import { toPublicUser, type PublicUser } from './user.mapper';

/** Window in which a just-rotated refresh token may be presented again (parallel tabs) without being treated as theft. */
const ROTATION_GRACE_MS = 10_000;
const CONSENT_POLICY_VERSION = '2026-01';

export interface AuthSession {
  user: PublicUser;
  permissions: string[];
  accessToken: string;
  refresh: IssuedRefreshToken;
}

const actorOf = (user: UserWithRole): AuditActor => ({ id: user.id, email: user.email, role: user.role.name });

async function buildSession(user: UserWithRole, refresh: IssuedRefreshToken): Promise<AuthSession> {
  const permissions = await permissionService.forRole(user.role.name);
  return {
    user: toPublicUser(user),
    permissions: [...permissions].sort(),
    accessToken: tokenService.signAccessToken(user.id, user.role.name),
    refresh,
  };
}

export const authService = {
  async registrationOptions() {
    const [enabled, allowedRoles] = await Promise.all([
      settingsService.get('registration.enabled'),
      settingsService.get('registration.allowedRoles'),
    ]);
    return { enabled, allowedRoles };
  },

  async register(input: RegisterInput, ctx: RequestContext): Promise<AuthSession> {
    const { enabled, allowedRoles } = await this.registrationOptions();
    if (!enabled) throw Errors.forbidden('Self-registration is currently disabled');

    const requestedRole: RoleName = input.role ?? 'STUDENT';
    if (!SELF_REGISTRATION_ELIGIBLE_ROLES.includes(requestedRole) || !allowedRoles.includes(requestedRole)) {
      await auditService.record({
        action: 'auth.register',
        resource: 'user',
        actorEmail: input.email,
        context: ctx,
        result: 'DENIED',
        severity: 'HIGH',
        reason: `Self-registration with role ${requestedRole} is not permitted`,
      });
      throw Errors.forbidden(`Self-registration with role ${requestedRole} is not permitted`);
    }

    if (await userRepository.findByEmail(input.email)) throw Errors.conflict('An account with this email already exists');

    const role = await roleRepository.findByName(requestedRole);
    if (!role) throw Errors.serviceUnavailable('Roles are not configured. Run the database seed.');

    const passwordHash = await passwordService.hash(input.password);
    const { user, refresh } = await prisma.$transaction(async (tx) => {
      const created = await userRepository.create(
        {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          organization: input.organization,
          roleId: role.id,
          passwordChangedAt: new Date(),
        },
        tx,
      );
      await tx.consentRecord.createMany({
        data: ['terms_of_service', 'privacy_notice'].map((consentType) => ({
          userId: created.id,
          consentType,
          granted: true,
          policyVersion: CONSENT_POLICY_VERSION,
          ipAddress: ctx.ip,
        })),
      });
      await auditService.record(
        {
          action: 'auth.register',
          resource: 'user',
          resourceId: created.id,
          actor: actorOf(created),
          context: ctx,
          after: { email: created.email, role: requestedRole },
        },
        tx,
      );
      const issued = await tokenService.issueRefreshToken(created.id, ctx, undefined, tx);
      return { user: created, refresh: issued };
    });

    await notificationService.notify(user.id, {
      type: 'SYSTEM',
      title: 'Welcome to the Trustworthy AI Platform',
      message: 'Start with Module 1 of "Trustworthy AI-Driven Digital Transformation" to begin your learning path.',
      link: '/courses',
    });

    return buildSession(user, refresh);
  },

  async login(input: LoginInput, ctx: RequestContext): Promise<AuthSession> {
    const user = await userRepository.findByEmail(input.email);
    const genericFailure = () => Errors.unauthorized('Invalid email or password');

    if (!user || user.status === 'DELETED') {
      await passwordService.verifyDummy(input.password);
      await auditService.record({
        action: 'auth.login',
        resource: 'session',
        actorEmail: input.email,
        context: ctx,
        result: 'FAILURE',
        severity: 'LOW',
        reason: 'Unknown account',
      });
      throw genericFailure();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await auditService.record({
        action: 'auth.login',
        resource: 'session',
        resourceId: user.id,
        actor: actorOf(user),
        context: ctx,
        result: 'DENIED',
        severity: 'MEDIUM',
        reason: 'Account temporarily locked',
      });
      throw Errors.locked('Too many failed sign-in attempts. Please try again later.');
    }

    const valid = await passwordService.verify(input.password, user.passwordHash);
    if (!valid) {
      const [maxAttempts, lockoutMinutes] = await Promise.all([
        settingsService.get('security.maxFailedLogins'),
        settingsService.get('security.lockoutMinutes'),
      ]);
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= maxAttempts;
      await userRepository.update(user.id, {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60_000) : undefined,
      });
      await auditService.record({
        action: shouldLock ? 'auth.account_locked' : 'auth.login',
        resource: 'session',
        resourceId: user.id,
        actor: actorOf(user),
        context: ctx,
        result: 'FAILURE',
        severity: shouldLock ? 'HIGH' : 'MEDIUM',
        reason: shouldLock ? `Locked for ${lockoutMinutes} minutes after ${attempts} failed attempts` : 'Invalid password',
      });
      throw genericFailure();
    }

    if (user.status !== 'ACTIVE') {
      await auditService.record({
        action: 'auth.login',
        resource: 'session',
        resourceId: user.id,
        actor: actorOf(user),
        context: ctx,
        result: 'DENIED',
        severity: 'MEDIUM',
        reason: `Account status is ${user.status}`,
      });
      throw Errors.forbidden('This account is not active. Contact your administrator.');
    }

    const { updated, refresh } = await prisma.$transaction(async (tx) => {
      const u = await userRepository.update(user.id, { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }, tx);
      const issued = await tokenService.issueRefreshToken(user.id, ctx, undefined, tx);
      await auditService.record(
        { action: 'auth.login', resource: 'session', resourceId: user.id, actor: actorOf(user), context: ctx },
        tx,
      );
      return { updated: u, refresh: issued };
    });
    return buildSession(updated, refresh);
  },

  async refresh(rawToken: string | undefined, ctx: RequestContext): Promise<AuthSession> {
    if (!rawToken) throw Errors.unauthorized('Missing refresh token');
    const stored = await refreshTokenRepository.findByHash(sha256(rawToken));
    if (!stored) throw Errors.unauthorized('Invalid refresh token');

    const { user } = stored;
    if (stored.revokedAt) {
      const withinGrace =
        stored.revokedReason === 'rotated' && Date.now() - stored.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace) {
        await refreshTokenRepository.revokeFamily(stored.familyId, 'reuse_detected');
        await auditService.record({
          action: 'auth.refresh_token_reuse',
          resource: 'session',
          resourceId: user.id,
          actor: actorOf(user),
          context: ctx,
          result: 'DENIED',
          severity: 'HIGH',
          reason: 'A revoked refresh token was presented; all sessions in the token family were revoked',
          metadata: { familyId: stored.familyId },
        });
        throw Errors.unauthorized('Session is no longer valid. Please sign in again.');
      }
    }
    if (stored.expiresAt < new Date()) throw Errors.unauthorized('Session expired. Please sign in again.');
    if (user.status !== 'ACTIVE') {
      await refreshTokenRepository.revokeAllForUser(user.id, 'account_inactive');
      throw Errors.unauthorized('This account is not active');
    }

    const refresh = await prisma.$transaction(async (tx) => {
      if (!stored.revokedAt) await refreshTokenRepository.claimForRotation(stored.id, tx);
      const issued = await tokenService.issueRefreshToken(user.id, ctx, stored.familyId, tx);
      await refreshTokenRepository.setReplacement(stored.id, issued.id, tx);
      return issued;
    });
    return buildSession(user, refresh);
  },

  async logout(rawToken: string | undefined, actor: AuditActor | null, ctx: RequestContext): Promise<void> {
    if (!rawToken) return;
    const stored = await refreshTokenRepository.findByHash(sha256(rawToken));
    if (!stored) return;
    await refreshTokenRepository.revoke(stored.id, 'logout');
    await auditService.record({
      action: 'auth.logout',
      resource: 'session',
      resourceId: stored.userId,
      actor: actor ?? actorOf(stored.user),
      context: ctx,
    });
  },

  async me(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) throw Errors.notFound('User');
    const permissions = await permissionService.forRole(user.role.name);
    return { user: toPublicUser(user), permissions: [...permissions].sort() };
  },

  async changePassword(userId: string, input: ChangePasswordInput, ctx: RequestContext): Promise<AuthSession> {
    const user = await userRepository.findById(userId);
    if (!user) throw Errors.notFound('User');
    if (!(await passwordService.verify(input.currentPassword, user.passwordHash))) {
      await auditService.record({
        action: 'auth.password_change',
        resource: 'user',
        resourceId: user.id,
        actor: actorOf(user),
        context: ctx,
        result: 'FAILURE',
        severity: 'MEDIUM',
        reason: 'Current password incorrect',
      });
      throw Errors.badRequest('Current password is incorrect');
    }
    const passwordHash = await passwordService.hash(input.newPassword);
    const { updated, refresh } = await prisma.$transaction(async (tx) => {
      const u = await userRepository.update(user.id, { passwordHash, passwordChangedAt: new Date() }, tx);
      await refreshTokenRepository.revokeAllForUser(user.id, 'password_changed', tx);
      const issued = await tokenService.issueRefreshToken(user.id, ctx, undefined, tx);
      await auditService.record(
        {
          action: 'auth.password_change',
          resource: 'user',
          resourceId: user.id,
          actor: actorOf(user),
          context: ctx,
          severity: 'MEDIUM',
          reason: 'All other sessions revoked',
        },
        tx,
      );
      return { updated: u, refresh: issued };
    });
    logger.info({ userId }, 'password changed');
    return buildSession(updated, refresh);
  },
};
