// import type { NextFunction, Request, Response } from 'express';
// import { UserRole } from '~/generated/prisma/enums';
// import { ApiResponse } from '~/lib/response';
// import { authService } from '~/service/auth/auth.service';

// const SELLER_OR_ADMIN = new Set<string>([UserRole.SELLER, UserRole.ADMIN]);

// /**
//  * All `/seller/*` routes (except public onboarding handlers registered before this middleware)
//  * require a valid access token or refresh cookie, then **SELLER** or **ADMIN** role.
//  */
// export const sellerAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
//   authService.authenticate(req, res, () => {
//     if (!req.user) {
//       return ApiResponse.unauthorized(res, 'Unauthorized');
//     }
//     if (!SELLER_OR_ADMIN.has(req.user.role)) {
//       return ApiResponse.forbidden(res, 'Seller or admin access required');
//     }

//     return next();
//   });
// };
import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '~/generated/prisma/enums';
import { ApiResponse } from '~/lib/response';
import { authService } from '~/service/auth/auth.service';
import { sqlQuery } from '~/lib/sql'; // ✅ CHANGED

const SELLER_OR_ADMIN = new Set<string>([UserRole.SELLER, UserRole.ADMIN]);

export const sellerAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  authService.authenticate(req, res, async () => {
    try {
      if (!req.user) {
        return ApiResponse.unauthorized(res, 'Unauthorized');
      }

      if (!SELLER_OR_ADMIN.has(req.user.role)) {
        return ApiResponse.forbidden(res, 'Seller or admin access required');
      }

      // ✅ CHANGED: Admin can access seller routes
      if (req.user.role === UserRole.ADMIN) {
        return next();
      }

      // ✅ CHANGED: Check seller approval status
      const rows = await sqlQuery<any>(
        `SELECT approval_status, reject_note
         FROM seller_profiles
         WHERE user_id = ?
         LIMIT 1`,
        [req.user.id],
      );

      if (!rows.length) {
        return ApiResponse.forbidden(res, 'Seller profile not found');
      }

      const seller = rows[0];

      if (seller.approval_status === 'APPROVED') {
        return next();
      }

      if (seller.approval_status === 'REJECTED') {
        return ApiResponse.forbidden(
          res,
          seller.reject_note || 'Your seller profile has been rejected by admin',
        );
      }

      return ApiResponse.forbidden(res, 'Your seller account is pending admin approval');
    } catch (error) {
      next(error);
    }
  });
};
