/** Admin Customer Tickets Controller */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import {
  customerTicketModel,
  type OndcCustomerTicketRow,
} from '~/ondc/models/customerTicket.model';

interface AttachmentData {
  images?: Array<{ url: string; size_type?: string }>;
  media?: Array<{ url: string }>;
  additional_desc?: {
    url: string;
    content_type?: string;
  };
}

const parseAttachments = (json: string | null): AttachmentData | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as AttachmentData;
  } catch {
    return null;
  }
};

const presentTicket = (ticket: OndcCustomerTicketRow) => {
  const attachments = parseAttachments(ticket.descriptor_attachments_json);

  return {
    id: ticket.id,
    ticket_id: ticket.ticket_id,
    txn_id: ticket.txn_id,
    order_id: ticket.order_id,
    provider_id: ticket.provider_id,
    seller_id: ticket.seller_id,
    domain: ticket.domain,
    issue_level: ticket.issue_level,
    display_status: ticket.display_status,
    priority: ticket.priority,
    customer_name: ticket.customer_name,
    customer_phone: ticket.customer_phone,
    customer_email: ticket.customer_email,
    reason_short_desc: ticket.reason_short_desc,
    reason_long_desc: ticket.reason_long_desc,
    source_id: ticket.source_id,
    complainant_id: ticket.complainant_id,
    respondent_ids: ticket.respondent_ids_json ? JSON.parse(ticket.respondent_ids_json) : [],
    attachments: attachments || { images: [], media: [] },
    actions_count: ticket.actions_json ? JSON.parse(ticket.actions_json).length : 0,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
};

export async function listCustomerTickets(req: Request, res: Response): Promise<void> {
  try {
    const { limit = 100, offset = 0, provider_id, status } = req.query;

    let tickets: OndcCustomerTicketRow[];

    if (provider_id && typeof provider_id === 'string') {
      tickets = await customerTicketModel.listByProvider(
        provider_id,
        Number(limit),
        Number(offset),
      );
    } else if (status && typeof status === 'string') {
      tickets = await customerTicketModel.listByStatus(status, Number(limit), Number(offset));
    } else {
      tickets = await customerTicketModel.listAll(Number(limit), Number(offset));
    }

    const presented = tickets.map(presentTicket);

    res.json(
      ApiResponse.success(presented, {
        count: presented.length,
        limit: Number(limit),
        offset: Number(offset),
      }),
    );
  } catch (error) {
    res
      .status(500)
      .json(ApiResponse.error(error instanceof Error ? error.message : 'Unknown error'));
  }
}

export async function getCustomerTicket(req: Request, res: Response): Promise<void> {
  try {
    const { ticketId } = req.params;

    const ticket = await customerTicketModel.findByTicketId(ticketId);
    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    res.json(ApiResponse.success(presentTicket(ticket)));
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    res
      .status(statusCode)
      .json(ApiResponse.error(error instanceof Error ? error.message : 'Unknown error'));
  }
}

export async function getTicketAttachments(req: Request, res: Response): Promise<void> {
  try {
    const { ticketId } = req.params;

    const ticket = await customerTicketModel.findByTicketId(ticketId);
    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    const attachments = parseAttachments(ticket.descriptor_attachments_json) || {
      images: [],
      media: [],
    };

    res.json(
      ApiResponse.success({
        ticket_id: ticketId,
        attachments,
      }),
    );
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    res
      .status(statusCode)
      .json(ApiResponse.error(error instanceof Error ? error.message : 'Unknown error'));
  }
}
