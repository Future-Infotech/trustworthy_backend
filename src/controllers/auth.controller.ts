import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';
import { actorFrom } from '../middleware/authorize';
import { authService, type AuthSession } from '../services/auth.service';
import { getRequestContext } from '../utils/requestContext';

const cookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/auth',
  ...(expires ? { expires } : {}),
});

function sendSession(res: Response, session: AuthSession, status = 200) {
  res.cookie(env.REFRESH_COOKIE_NAME, session.refresh.token, cookieOptions(session.refresh.expiresAt));
  res.status(status).json({ accessToken: session.accessToken, user: session.user, permissions: session.permissions });
}

const refreshCookie = (req: Request): string | undefined => req.cookies?.[env.REFRESH_COOKIE_NAME];

export const authController = {
  async registrationOptions(_req: Request, res: Response) {
    res.json(await authService.registrationOptions());
  },

  async register(req: Request, res: Response) {
    sendSession(res, await authService.register(req.body, getRequestContext(req)), 201);
  },

  async login(req: Request, res: Response) {
    sendSession(res, await authService.login(req.body, getRequestContext(req)));
  },

  async refresh(req: Request, res: Response) {
    try {
      sendSession(res, await authService.refresh(refreshCookie(req), getRequestContext(req)));
    } catch (err) {
      res.clearCookie(env.REFRESH_COOKIE_NAME, cookieOptions());
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    await authService.logout(refreshCookie(req), null, getRequestContext(req));
    res.clearCookie(env.REFRESH_COOKIE_NAME, cookieOptions());
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    res.json(await authService.me(actorFrom(req).id));
  },

  async changePassword(req: Request, res: Response) {
    sendSession(res, await authService.changePassword(actorFrom(req).id, req.body, getRequestContext(req)));
  },
};
