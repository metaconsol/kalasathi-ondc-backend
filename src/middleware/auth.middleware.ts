import type { NextFunction, Request, Response } from 'express';
import { authService } from '~/service/auth/auth.service';

/**
 * Verifies the user's access token / refresh token.
 * Attaches `req.user` (UserPayloadDAO) on success.
 * Returns 401 Unauthorized on failure.
 *
 * Usage:
 *   router.get('/protected', authMiddleware, handler);
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) =>
  authService.authenticate(req, res, next);
