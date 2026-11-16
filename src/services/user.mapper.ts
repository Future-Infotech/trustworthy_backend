import type { UserWithRole } from '../repositories/user.repository';

/** Public representation of a user. Never includes credentials or lockout internals. */
export function toPublicUser(user: UserWithRole) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    role: user.role.name,
    roleDisplayName: user.role.displayName,
    status: user.status,
    organization: user.organization,
    jobTitle: user.jobTitle,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;

/** Snapshot of mutable user fields for audit before/after values. */
export function auditSnapshot(user: UserWithRole) {
  return {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.name,
    status: user.status,
    organization: user.organization,
    jobTitle: user.jobTitle,
  };
}
