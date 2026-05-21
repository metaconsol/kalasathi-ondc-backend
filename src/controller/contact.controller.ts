import type { Request, Response, NextFunction } from 'express';
import * as contactService from '~/service/contact.service';
import { ApiResponse } from '~/lib/response';
import { sqlExec, sqlQuery } from '~/lib/sql';
import {
  ContactMessage_topic as Topic,
  ContactMessage_status as MessageStatus,
} from '~/generated/prisma/enums';

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
