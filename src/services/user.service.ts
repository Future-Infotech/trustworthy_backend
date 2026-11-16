import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { canAssignRole } from '../rbac/permissions';
import { refreshTokenRepository } from '../repositories/refreshToken.repository';
import { roleRepository } from '../repositories/role.repository';
import { userRepository, type UserWithRole } from '../repositories/user.repository';
import { Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import type { RequestContext } from '../utils/requestContext';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from '../validators/user.validators';
import { auditService, type AuditActor } from './audit.service';
import { passwordService } from './password.service';
import { auditSnapshot, toPublicUser } from './user.mapper';

/**
 * Guards against privilege escalation: an actor may only manage users whose
 * current role ranks below their own (SUPER_ADMIN excepted) and never themselves.
 */
async function assertCanManage(actor: AuditActor, target: UserWithRole, ctx: RequestContext, action: string) {
  const deny = async (reason: string) => {
    await auditService.record({
      action,
      resource: 'user',
      resourceId: target.id,
      actor,
      context: ctx,
      result: 'DENIED',
      severity: 'HIGH',
      reason,
    });
    return Errors.forbidden(reason);
  };
  if (target.id === actor.id) throw await deny('You cannot change your own role, status or account through user management');
  if (!canAssignRole(actor.role, target.role.name)) {
    throw await deny(`Your role cannot manage users with the ${target.role.name} role`);
  }
}

async function assertCanAssign(actor: AuditActor, role: CreateUserInput['role'], ctx: RequestContext, action: string, resourceId?: string) {
  if (canAssignRole(actor.role, role)) return;
  await auditService.record({
    action,
    resource: 'user',
    resourceId,
    actor,
    context: ctx,
    result: 'DENIED',
    severity: 'HIGH',
    reason: `Attempted to assign role ${role} without sufficient privilege`,
  });
  throw Errors.forbidden(`Your role cannot assign the ${role} role`);
}

export const userService = {
  async list(query: ListUsersQuery) {
    const { skip, take } = toSkipTake(query);
    const { items, total } = await userRepository.list({ ...query, skip, take });
    return paginate(items.map(toPublicUser), total, query);
  },

  async get(id: string) {
    const user = await userRepository.findById(id);
    if (!user) throw Errors.notFound('User');
    return toPublicUser(user);
  },

  async create(actor: AuditActor, input: CreateUserInput, ctx: RequestContext) {
    await assertCanAssign(actor, input.role, ctx, 'user.create');
    if (await userRepository.findByEmail(input.email)) throw Errors.conflict('An account with this email already exists');
    const role = await roleRepository.findByName(input.role);
    if (!role) throw Errors.badRequest(`Role ${input.role} is not configured`);

    const passwordHash = await passwordService.hash(input.password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await userRepository.create(
        {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          organization: input.organization,
          jobTitle: input.jobTitle,
          passwordHash,
          passwordChangedAt: new Date(),
          roleId: role.id,
          createdById: actor.id,
          updatedById: actor.id,
        },
        tx,
      );
      await auditService.record(
        {
          action: 'user.create',
          resource: 'user',
          resourceId: created.id,
          actor,
          context: ctx,
          after: auditSnapshot(created),
          severity: input.role === 'SUPER_ADMIN' || input.role === 'ADMIN' ? 'HIGH' : 'MEDIUM',
        },
        tx,
      );
      return created;
    });
    return toPublicUser(user);
  },

  async update(actor: AuditActor, id: string, input: UpdateUserInput, ctx: RequestContext) {
    const target = await userRepository.findById(id);
    if (!target || target.status === 'DELETED') throw Errors.notFound('User');

    const changesPrivilege = input.role !== undefined || input.status !== undefined;
    if (changesPrivilege || target.id !== actor.id) await assertCanManage(actor, target, ctx, 'user.update');
    if (input.role && input.role !== target.role.name) await assertCanAssign(actor, input.role, ctx, 'user.update', id);

    const data: Prisma.UserUncheckedUpdateInput = { updatedById: actor.id };
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.organization !== undefined) data.organization = input.organization;
    if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
    if (input.status !== undefined) data.status = input.status;
    if (input.role && input.role !== target.role.name) {
      const role = await roleRepository.findByName(input.role);
      if (!role) throw Errors.badRequest(`Role ${input.role} is not configured`);
      data.roleId = role.id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await userRepository.update(id, data, tx);
      const roleChanged = u.role.name !== target.role.name;
      const suspended = u.status === 'SUSPENDED' && target.status !== 'SUSPENDED';
      if (roleChanged || suspended) {
        await refreshTokenRepository.revokeAllForUser(id, suspended ? 'account_suspended' : 'role_changed', tx);
      }
      await auditService.record(
        {
          action: roleChanged ? 'user.role_change' : suspended ? 'user.suspend' : 'user.update',
          resource: 'user',
          resourceId: id,
          actor,
          context: ctx,
          before: auditSnapshot(target),
          after: auditSnapshot(u),
          reason: input.reason,
          severity: roleChanged || suspended ? 'HIGH' : 'LOW',
        },
        tx,
      );
      return u;
    });
    return toPublicUser(updated);
  },

  /** Soft-deletes (deactivates) a user. Records are retained for audit integrity. */
  async remove(actor: AuditActor, id: string, reason: string | undefined, ctx: RequestContext) {
    const target = await userRepository.findById(id);
    if (!target || target.status === 'DELETED') throw Errors.notFound('User');
    await assertCanManage(actor, target, ctx, 'user.delete');

    await prisma.$transaction(async (tx) => {
      const u = await userRepository.update(id, { status: 'DELETED', deletedAt: new Date(), updatedById: actor.id }, tx);
      await refreshTokenRepository.revokeAllForUser(id, 'account_deleted', tx);
      await auditService.record(
        {
          action: 'user.delete',
          resource: 'user',
          resourceId: id,
          actor,
          context: ctx,
          before: auditSnapshot(target),
          after: auditSnapshot(u),
          reason,
          severity: 'HIGH',
        },
        tx,
      );
    });
  },
};
