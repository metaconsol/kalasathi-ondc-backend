import type { NextFunction, Request, Response } from 'express';
import * as ticketService from '~/service/ticket.service';
import { ApiResponse } from '~/lib/response';

const allowedStatus = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'REJECTED'];

export const createTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number((req as any).user?.id);
    // console.log(userId)

    const {
      order_id,
      order_item_id,
      order_seller_unit_id,
      reason_code,
      reason_text,
      comment,
      priority,
    } = req.body;

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!order_id || !reason_code || !comment) {
      return ApiResponse.badRequest(res, 'order_id, reason_code and comment are required');
    }

    const data = await ticketService.createTicket({
      userId,
      orderId: Number(order_id),
      orderItemId: order_item_id ? Number(order_item_id) : null,
      orderSellerUnitId: order_seller_unit_id ? Number(order_seller_unit_id) : null,
      reasonCode: reason_code,
      reasonText: reason_text || null,
      comment,
      priority: priority || 'MEDIUM',
    });

    return ApiResponse.created(res, 'Ticket created successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getTicketById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);

    const data = await ticketService.getTicketById(id);

    if (!data) {
      return ApiResponse.notFound(res, 'Ticket not found');
    }

    return ApiResponse.success(res, 'Ticket fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getMyTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number((req as any).user?.id);

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const data = await ticketService.getMyTickets(userId);

    return ApiResponse.success(res, 'My tickets fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getSellerTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerUserId = Number((req as any).user?.id);

    if (!sellerUserId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const data = await ticketService.getSellerTickets(sellerUserId);

    return ApiResponse.success(res, 'Seller tickets fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getAllTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await ticketService.getAllTickets();

    return ApiResponse.success(res, 'All tickets fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const addTicketMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = Number(req.params.id);
    const senderUserId = Number((req as any).user?.id);
    const senderRole = (req as any).user?.role || 'USER';
    const { message } = req.body;

    if (!senderUserId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!message) {
      return ApiResponse.badRequest(res, 'Message is required');
    }

    const data = await ticketService.addTicketMessage({
      ticketId,
      senderUserId,
      senderRole,
      message,
    });

    return ApiResponse.created(res, 'Message added successfully', data);
  } catch (error) {
    next(error);
  }
};

export const updateTicketStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = Number(req.params.id);
    const changedByUserId = Number((req as any).user?.id);
    const { status, note } = req.body;

    if (!changedByUserId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!allowedStatus.includes(status)) {
      return ApiResponse.badRequest(res, 'Invalid ticket status');
    }

    const data = await ticketService.updateTicketStatus({
      ticketId,
      status,
      changedByUserId,
      note: note || null,
    });

    return ApiResponse.success(res, 'Ticket status updated successfully', data);
  } catch (error) {
    next(error);
  }
};

export const resolveTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = Number(req.params.id);
    const sellerUserId = Number((req as any).user?.id);
    const { resolution_note } = req.body;

    if (!sellerUserId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!resolution_note) {
      return ApiResponse.badRequest(res, 'Resolution note is required');
    }

    const data = await ticketService.resolveTicket(ticketId, sellerUserId, resolution_note);

    return ApiResponse.success(res, 'Ticket resolved successfully', data);
  } catch (error) {
    next(error);
  }
};

export const rejectTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = Number(req.params.id);
    const sellerUserId = Number((req as any).user?.id);
    const { resolution_note } = req.body;

    if (!sellerUserId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!resolution_note) {
      return ApiResponse.badRequest(res, 'Reject reason is required');
    }

    const data = await ticketService.rejectTicket(ticketId, sellerUserId, resolution_note);

    return ApiResponse.success(res, 'Ticket rejected successfully', data);
  } catch (error) {
    next(error);
  }
};

export const closeTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = Number(req.params.id);
    const userId = Number((req as any).user?.id);
    const { note } = req.body;

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const data = await ticketService.closeTicket(ticketId, userId, note || null);

    return ApiResponse.success(res, 'Ticket closed successfully', data);
  } catch (error) {
    next(error);
  }
};
