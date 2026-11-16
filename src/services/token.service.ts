import type { RoleName } from '@prisma/client';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import type { DbClient } from '../config/prisma';
import { refreshTokenRepository } from '../repositories/refreshToken.repository';
import { randomToken, sha256 } from '../utils/crypto';
import { Errors } from '../utils/errors';
import type { RequestContext } from '../utils/requestContext';

export interface AccessTokenClaims {
  sub: string;
  role: RoleName;
  type: 'access';
  iat: number;
  exp: number;
}

export interface IssuedRefreshToken {
  id: string;
  token: string;
  expiresAt: Date;
  familyId: string;
}

export const tokenService = {
  signAccessToken(userId: string, role: RoleName): string {
    return jwt.sign({ role, type: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithm: 'HS256',
      jwtid: randomUUID(),
    });
  },

  verifyAccessToken(token: string): AccessTokenClaims {
    let payload: string | JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw Errors.unauthorized('Access token expired');
      throw Errors.unauthorized('Invalid access token');
    }
    if (typeof payload === 'string' || payload.type !== 'access' || !payload.sub) {
      throw Errors.unauthorized('Invalid access token');
    }
    return payload as AccessTokenClaims;
  },

  async issueRefreshToken(
    userId: string,
    ctx: RequestContext,
    familyId: string = randomUUID(),
    db?: DbClient,
  ): Promise<IssuedRefreshToken> {
    const token = randomToken(48);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const record = await refreshTokenRepository.create(
      { userId, tokenHash: sha256(token), familyId, expiresAt, createdByIp: ctx.ip, userAgent: ctx.userAgent },
      db,
    );
    return { id: record.id, token, expiresAt, familyId };
  },
};
