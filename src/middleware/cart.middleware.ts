import type { NextFunction, Request, Response } from 'express';

import { ApiResponse } from '~/lib/response';
import type { UserPayloadDAO } from '~/service/auth/auth.types';
import { AuthTokenUtil } from '~/service/auth/jwt.util';
import type { CartOwner } from '~/service/cart/cart.types';

const SESSION_HEADER = 'x-cart-session';
/** Matches `carts.session_id` varchar(100). */
const SESSION_MAX = 100;

/**
 * If `Authorization: Bearer` is valid, sets `req.user` and refreshes the access token header.
 * Does not fail when the token is missing or invalid (guest cart flows).
 */
export const optionalCartBearerUser = (req: Request, res: Response, next: NextFunction) => {
  const accessToken = req.headers?.authorization?.split(' ')?.[1] ?? null;
  if (!accessToken) {
    return next();
  }
  const result = AuthTokenUtil.verifyAccessToken(accessToken);
  if (!result.success || !result.payload) {
    return next();
  }
  const { iat, exp, ...cleanPayload } = result.payload as UserPayloadDAO & {
    iat?: number;
    exp?: number;
  };
  req.user = cleanPayload as UserPayloadDAO;
  const newAccessToken = AuthTokenUtil.generateAccessToken(cleanPayload as UserPayloadDAO);
  res.setHeader('Authorization', `Bearer ${newAccessToken}`);
  return next();
};

/**
 * Resolves cart owner: authenticated user wins over guest session header.
 */
export function getCartOwner(req: Request): CartOwner | null {
  if (req.user?.id != null) {
    return { userId: req.user.id };
  }
  const raw = req.headers[SESSION_HEADER];
  const sessionId =
    typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? (raw[0] ?? '').trim() : '';
  if (!sessionId) {
    return null;
  }
  if (sessionId.length > SESSION_MAX) {
    return null;
  }
  return { sessionId };
}

/**
 * Guest cart operations require `X-Cart-Session` (or a logged-in user with Bearer).
 */
export const requireCartOwner = (req: Request, res: Response, next: NextFunction) => {
  const owner = getCartOwner(req);
  if (!owner) {
    return ApiResponse.badRequest(
      res,
      'Send a valid Authorization Bearer token or X-Cart-Session header',
    );
  }
  return next();
};
