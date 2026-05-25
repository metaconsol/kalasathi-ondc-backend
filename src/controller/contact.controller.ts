import type { Request, Response, NextFunction } from 'express';
import * as contactService from '~/service/contact.service';
import { ApiResponse } from '~/lib/response';
import { sqlExec, sqlQuery } from '~/lib/sql';
import {
  ContactMessage_topic as Topic,
  ContactMessage_status as MessageStatus,
} from '~/generated/prisma/enums';

import { resolveStoredToSignedUrl } from '~/lib/s3';

/**
 * Handle public contact form submission
 */
export const createContact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, orderNumber, topic, message } = req.body;

    if (!fullName || !email || !topic || !message) {
      return ApiResponse.badRequest(res, 'Missing required fields');
    }

    const data = await contactService.createMessage({
      fullName,
      email,
      orderNumber,
      topic: topic as Topic,
      message,
    });

    return ApiResponse.created(res, 'Message sent successfully', data);
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Get all messages
 */
export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const messages = await contactService.getMessages(status as MessageStatus);
    return ApiResponse.success(res, 'Messages retrieved successfully', messages);
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Update message status/notes
 */
export const updateMessageStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { status, adminNotes } = req.body;

    // In a real app, resolvedBy would come from req.user.id
    const resolvedBy = (req as any).user?.id || 1;

    const updated = await contactService.updateMessageStatus(id, {
      status: status as MessageStatus,
      adminNotes,
      resolvedBy,
    });

    return ApiResponse.success(res, 'Message updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Get seller requests
 */
export const getSellerRequests = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellers = await sqlQuery<any>(
      `SELECT 
        sp.*,
        u.name,
        u.email,
        u.phoneNumber
       FROM seller_profiles sp
       JOIN user u ON u.id = sp.user_id
       ORDER BY sp.created_at DESC`,
    );

    return ApiResponse.success(res, 'Seller requests', sellers);
  } catch (error) {
    next(error);
  }
};

/**
 * APPROVE
 */
export const approveSeller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number(req.params.userId);

    if (!userId) {
      return ApiResponse.badRequest(res, 'Invalid seller user id');
    }

    await sqlExec(
      `UPDATE seller_profiles
       SET approval_status = 'APPROVED'
       WHERE user_id = ?`,
      [userId],
    );

    return ApiResponse.success(res, 'Seller approved successfully');
  } catch (e) {
    next(e);
  }
};

/**
 * REJECT
 */
export const rejectSeller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number(req.params.userId);
    const { reject_note } = req.body;

    if (!userId) {
      return ApiResponse.badRequest(res, 'Invalid seller user id');
    }

    if (!reject_note || !reject_note.trim()) {
      return ApiResponse.badRequest(res, 'Reject note is required');
    }

    await sqlExec(
      `UPDATE seller_profiles
       SET approval_status = 'REJECTED',
           reject_note = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE user_id = ?`,
      [reject_note.trim(), userId],
    );

    return ApiResponse.success(res, 'Seller rejected successfully');
  } catch (e) {
    next(e);
  }
};

export const getDistrictSellerRequests = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const adminId = req.user?.id;
    const role = req.user?.role;

    // ✅ PAGINATION
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM seller_profiles sp
      JOIN User u ON u.id = sp.user_id
    `;

    const params: any[] = [];

    // ✅ DISTRICT FILTER FOR NORMAL ADMIN
    if (role !== 'SUPER_ADMIN') {
      baseQuery += `
        JOIN admin_district_assignments ada
          ON LOWER(TRIM(ada.district_name)) = LOWER(TRIM(sp.district))
         AND ada.admin_id = ?
      `;

      params.push(adminId);
    }

    // ✅ TOTAL COUNT QUERY
    const totalQuery = `
      SELECT COUNT(*) as total
      ${baseQuery}
    `;

    const totalResult = await sqlQuery<any>(totalQuery, params);
    const total = totalResult[0]?.total || 0;

    // ✅ MAIN DATA QUERY WITH LIMIT
    const dataQuery = `
      SELECT 
        sp.*,
        u.name,
        u.email,
        u.phoneNumber
      ${baseQuery}
      ORDER BY sp.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const sellers = await sqlQuery<any>(dataQuery, [...params, limit, offset]);

    // ✅ IMAGE URL RESOLVE
    const sellersWithImages = await Promise.all(
      sellers.map(async (seller: any) => ({
        ...seller,
        gst_image: await resolveStoredToSignedUrl(seller.gst_image),
        aadhar_image: await resolveStoredToSignedUrl(seller.aadhar_image),
        pan_image: await resolveStoredToSignedUrl(seller.pan_image),
        bank_image: await resolveStoredToSignedUrl(seller.bank_image),
      })),
    );

    // ✅ RESPONSE WITH PAGINATION
    return ApiResponse.success(res, 'District seller requests', {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: sellersWithImages,
    });
  } catch (error) {
    next(error);
  }
};
export const approveDistrictSeller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const role = req.user?.role;
    const { userId } = req.params;

    let query = `
      SELECT sp.user_id
      FROM seller_profiles sp
    `;

    const params: any[] = [];

    if (role !== 'SUPER_ADMIN') {
      query += `
        JOIN admin_district_assignments ada
          ON LOWER(TRIM(ada.district_name)) = LOWER(TRIM(sp.district))
         AND ada.admin_id = ?
      `;
      params.push(adminId);
    }

    query += `
      WHERE sp.user_id = ?
      LIMIT 1
    `;

    params.push(userId);

    const allowed = await sqlQuery<any>(query, params);

    if (!allowed.length) {
      return ApiResponse.forbidden(res, 'You can approve only sellers from your assigned district');
    }

    await sqlExec(
      `
      UPDATE seller_profiles
      SET approval_status = 'APPROVED',
          reject_note = NULL
      WHERE user_id = ?
      `,
      [userId],
    );

    return ApiResponse.success(res, 'Seller approved successfully');
  } catch (error) {
    next(error);
  }
};

export const rejectDistrictSeller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const role = req.user?.role;
    const { userId } = req.params;
    const { reject_note } = req.body;

    let query = `
      SELECT sp.user_id
      FROM seller_profiles sp
    `;

    const params: any[] = [];

    if (role !== 'SUPER_ADMIN') {
      query += `
        JOIN admin_district_assignments ada
          ON LOWER(TRIM(ada.district_name)) = LOWER(TRIM(sp.district))
         AND ada.admin_id = ?
      `;
      params.push(adminId);
    }

    query += `
      WHERE sp.user_id = ?
      LIMIT 1
    `;

    params.push(userId);

    const allowed = await sqlQuery<any>(query, params);

    if (!allowed.length) {
      return ApiResponse.forbidden(res, 'You can reject only sellers from your assigned district');
    }

    await sqlExec(
      `
      UPDATE seller_profiles
      SET approval_status = 'REJECTED',
          reject_note = ?
      WHERE user_id = ?
      `,
      [reject_note || null, userId],
    );

    return ApiResponse.success(res, 'Seller rejected successfully');
  } catch (error) {
    next(error);
  }
};

export const underReviewDistrictSeller = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const adminId = req.user?.id;
    const role = req.user?.role;
    const { userId } = req.params;
    const { reject_note } = req.body;

    let query = `
      SELECT sp.user_id
      FROM seller_profiles sp
    `;

    const params: any[] = [];

    if (role !== 'SUPER_ADMIN') {
      query += `
        JOIN admin_district_assignments ada
          ON LOWER(TRIM(ada.district_name)) = LOWER(TRIM(sp.district))
         AND ada.admin_id = ?
      `;

      params.push(adminId);
    }

    query += `
      WHERE sp.user_id = ?
      LIMIT 1
    `;

    params.push(userId);

    const allowed = await sqlQuery<any>(query, params);

    if (!allowed.length) {
      return ApiResponse.forbidden(res, 'You can update only sellers from your assigned district');
    }

    await sqlExec(
      `
      UPDATE seller_profiles
      SET approval_status = 'UNDER_REVIEW',
          reject_note = ?
      WHERE user_id = ?
      `,
      [reject_note || null, userId],
    );

    return ApiResponse.success(res, 'Seller moved to under review successfully');
  } catch (error) {
    next(error);
  }
};
