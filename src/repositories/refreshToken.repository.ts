import { prisma, type DbClient } from '../config/prisma';

export const refreshTokenRepository = {
  create(
    data: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
      createdByIp?: string | null;
      userAgent?: string | null;
    },
    db: DbClient = prisma,
  ) {
    return db.refreshToken.create({ data });
  },

  findByHash(tokenHash: string) {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { role: true } } },
    });
  },

  /** Atomically revokes a token only if it is still active. Returns true if this call revoked it. */
  async claimForRotation(id: string, db: DbClient = prisma): Promise<boolean> {
    const { count } = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'rotated' },
    });
    return count === 1;
  },

  setReplacement(id: string, replacedByTokenId: string, db: DbClient = prisma) {
    return db.refreshToken.update({ where: { id }, data: { replacedByTokenId } });
  },

  revoke(id: string, reason: string, db: DbClient = prisma) {
    return db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },

  revokeFamily(familyId: string, reason: string, db: DbClient = prisma) {
    return db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },

  revokeAllForUser(userId: string, reason: string, db: DbClient = prisma) {
    return db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },
};
