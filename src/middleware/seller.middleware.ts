import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '~/generated/prisma/enums';
import { ApiResponse } from '~/lib/response';
import { authService } from '~/service/auth/auth.service';

const SELLER_OR_ADMIN = new Set<string>([UserRole.SELLER, UserRole.ADMIN, UserRole.SUPER_ADMIN]);

/**
 * All `/seller/*` routes (except public onboarding handlers registered before this middleware)
 * require a valid access token or refresh cookie, then **SELLER** or **ADMIN** role.
 */
export const sellerAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  authService.authenticate(req, res, () => {
    if (!req.user) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }
    if (!SELLER_OR_ADMIN.has(req.user.role)) {
      return ApiResponse.forbidden(res, 'Seller or admin access required');
    }
    return next();
  });
};
