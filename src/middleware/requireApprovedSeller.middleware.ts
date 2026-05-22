import type { Request, Response, NextFunction } from 'express';

import { sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';
import { UserRole } from '~/generated/prisma/enums';

export const requireApprovedSeller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId) {
      return ApiResponse.badRequest(res, 'User not authenticated');
    }

    // ✅ Admin can access
    if (role === UserRole.ADMIN) {
      return next();
    }

    const rows = await sqlQuery<any>(
      `SELECT approval_status, reject_note
       FROM seller_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [userId],
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
};
