import type { RoleName } from '@prisma/client';
import { ALL_PERMISSIONS, canAssignRole, PERMISSIONS, ROLE_PERMISSIONS, SELF_REGISTRATION_ELIGIBLE_ROLES } from '../../src/rbac/permissions';

const ROLES = Object.keys(ROLE_PERMISSIONS) as RoleName[];

describe('RBAC permission matrix', () => {
  it('grants SUPER_ADMIN every permission', () => {
    expect(new Set(ROLE_PERMISSIONS.SUPER_ADMIN)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('only references permissions from the catalogue', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it('reserves role management for SUPER_ADMIN', () => {
    for (const role of ROLES.filter((r) => r !== 'SUPER_ADMIN')) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.ROLES_MANAGE);
    }
  });

  it.each(['STUDENT', 'DEVELOPER', 'PRODUCT_DEVELOPER', 'EXECUTIVE', 'FACULTY'] as RoleName[])(
    '%s cannot manage users, settings or read audit logs',
    (role) => {
      const perms = ROLE_PERMISSIONS[role];
      expect(perms).not.toContain(PERMISSIONS.USERS_MANAGE);
      expect(perms).not.toContain(PERMISSIONS.SETTINGS_MANAGE);
      expect(perms).not.toContain(PERMISSIONS.AUDIT_LOGS_READ);
    },
  );

  it('gives students learning capabilities but not authoring capabilities', () => {
    const s = ROLE_PERMISSIONS.STUDENT;
    expect(s).toEqual(expect.arrayContaining([PERMISSIONS.COURSES_READ, PERMISSIONS.LABS_RUN, PERMISSIONS.QUIZZES_TAKE]));
    expect(s).not.toContain(PERMISSIONS.COURSES_MANAGE);
    expect(s).not.toContain(PERMISSIONS.ASSIGNMENTS_GRADE);
  });

  it('gives executives the executive dashboard but not the admin dashboard', () => {
    expect(ROLE_PERMISSIONS.EXECUTIVE).toContain(PERMISSIONS.ANALYTICS_EXECUTIVE);
    expect(ROLE_PERMISSIONS.EXECUTIVE).not.toContain(PERMISSIONS.ANALYTICS_ADMIN);
  });

  it('never allows privileged roles through self-registration', () => {
    expect(SELF_REGISTRATION_ELIGIBLE_ROLES).not.toContain('ADMIN');
    expect(SELF_REGISTRATION_ELIGIBLE_ROLES).not.toContain('SUPER_ADMIN');
    expect(SELF_REGISTRATION_ELIGIBLE_ROLES).not.toContain('FACULTY');
  });
});

describe('canAssignRole (privilege escalation guard)', () => {
  it('lets SUPER_ADMIN assign any role', () => {
    for (const r of ROLES) expect(canAssignRole('SUPER_ADMIN', r)).toBe(true);
  });

  it('prevents ADMIN from assigning ADMIN or SUPER_ADMIN', () => {
    expect(canAssignRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'FACULTY')).toBe(true);
    expect(canAssignRole('ADMIN', 'STUDENT')).toBe(true);
  });

  it('prevents non-admin roles from assigning roles at or above their rank', () => {
    expect(canAssignRole('STUDENT', 'STUDENT')).toBe(false);
    expect(canAssignRole('DEVELOPER', 'ADMIN')).toBe(false);
  });
});
