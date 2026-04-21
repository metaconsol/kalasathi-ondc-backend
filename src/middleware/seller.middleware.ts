import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '~/generated/prisma/enums';
import { ApiResponse } from '~/lib/response';
import { authService } from '~/service/auth/auth.service';

/**
 * One step for seller routes: valid session + role SELLER.
 * (Replaces chaining `authMiddleware` then `requireSeller`.)
 */
export const sellerAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  authService.authenticate(req, res, () => {
    if (!req.user) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }
    if (req.user.role !== UserRole.SELLER) {
      return ApiResponse.forbidden(res, 'Seller access required');
    }
    return next();
  });
};
