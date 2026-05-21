import type { NextFunction, Request, Response } from 'express';
import { AuthTokenUtil } from '~/service/auth/jwt.util';

/**
 * If `Authorization: Bearer <accessToken>` is present and valid, sets `req.user`.
 * Always continues (never 401). Use for routes that work for guests and logged-in users.
 */
export function optionalAccessToken(req: Request, res: Response, next: NextFunction) {
  const accessToken = req.headers?.authorization?.split(' ')?.[1] ?? null;
  if (accessToken) {
    const result = AuthTokenUtil.verifyAccessToken(accessToken);
    if (result.success && result.payload) {
      req.user = result.payload;
      return next();
    }
  }

  // Fallback to refresh token in cookies if access token is not present or expired
  const headerCookie = req.headers.cookie || null;
  if (headerCookie) {
    const cookies = headerCookie.split(';');
    let refreshToken: string | null = null;
    cookies.forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key === AuthTokenUtil.REFRESH_TOKEN_KEY_NAME) {
        refreshToken = value as string | null;
      }
    });

    if (refreshToken) {
      const result = AuthTokenUtil.verifyRefreshToken(refreshToken);
      if (result.success && result.payload) {
        req.user = result.payload;
      }
    }
  }

  next();
}
