import type { Request, Response, NextFunction } from 'express';
import { sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';

export const requireApprovedSeller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return ApiResponse.badRequest(res, 'User not authenticated');
    }

    const rows = await sqlQuery<any>(
      `SELECT approval_status
       FROM seller_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [userId],
    );

    if (!rows.length) {
      return ApiResponse.forbidden(res, 'Seller profile not found');
    }

    if (rows[0].approval_status !== 'APPROVED') {
      return ApiResponse.forbidden(res, 'Your seller account is pending admin approval');
    }

    next();
  } catch (error) {
    next(error);
  }
};
