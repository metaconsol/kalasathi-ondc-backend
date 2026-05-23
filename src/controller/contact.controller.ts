import type { Request, Response, NextFunction } from 'express';
import * as contactService from '~/service/contact.service';
import { ApiResponse } from '~/lib/response';
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
