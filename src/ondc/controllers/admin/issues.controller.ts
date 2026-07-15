/** Admin IGM Issues/Tickets Controller — backed by ondc_customer_ticket. */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { customerTicketModel } from '~/ondc/models/customer_ticket.model';
import { igmService } from '~/ondc/services/igm.service';

/**
 * Sellers may only see/act on their own tickets (admins see all). Responds
 * 404 rather than 403 so ticket ids of other sellers can't be probed —
 * mirrors assertOrderVisible in orders.controller.ts.
 */
function assertTicketVisible(req: Request, ticket: { seller_id?: number | null }): void {
  if (req.user?.role === 'SELLER' && Number(ticket.seller_id) !== Number(req.user.id)) {
    throw new AppError('Ticket not found', 404);
  }
}

async function loadOwnedTicket(
  req: Request,
): Promise<NonNullable<Awaited<ReturnType<typeof customerTicketModel.getById>>>> {
  const id = parseInt(req.params['id'] as string, 10);
  const row = await customerTicketModel.getById(id);
  if (!row) throw new AppError('Ticket not found', 404);
  assertTicketVisible(req, row);
  return row;
}

/** GET /api/v1/ondc/admin/issues — list tickets for the Tickets page. */
export async function listOndcIssues(req: Request, res: Response): Promise<void> {
  const { status, limit = '50', offset = '0' } = req.query as Record<string, string>;
  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? req.user?.id : undefined;
  const rows = await customerTicketModel.list({
    ...(status ? { status } : {}),
    ...(sellerId !== undefined ? { sellerId } : {}),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
  ApiResponse.success(res, 'ONDC tickets', rows);
}

/** GET /api/v1/ondc/admin/issues/:id — ticket + chat transcript + IGM descriptor. */
export async function getOndcIssue(req: Request, res: Response): Promise<void> {
  const row = await loadOwnedTicket(req);
  const messages = customerTicketModel.parseMessages(row);
  let descriptor: Record<string, unknown> | null = null;
  let resolutions: unknown[] = [];
  try {
    descriptor = row.descriptor_json ? JSON.parse(row.descriptor_json) : null;
  } catch {
    descriptor = null;
  }
  try {
    resolutions = row.resolutions_json ? JSON.parse(row.resolutions_json) : [];
  } catch {
    resolutions = [];
  }
  ApiResponse.success(res, 'ONDC ticket', { ...row, messages, descriptor, resolutions });
}

/** POST /api/v1/ondc/admin/issues/:id/message — seller message / info request / resolution options. */
export async function addOndcIssueMessage(req: Request, res: Response): Promise<void> {
  const row = await loadOwnedTicket(req);
  const { message, type, refund_amount } = req.body as {
    message: string;
    type?: 'message' | 'info_request' | 'resolution_options';
    refund_amount?: string;
  };
  await igmService.sellerAction(row.id, type ?? 'message', {
    message,
    ...(refund_amount !== undefined ? { refund_amount } : {}),
  });
  ApiResponse.success(res, 'Message sent');
}

/** PATCH /api/v1/ondc/admin/issues/:id/status — IN_PROGRESS / RESOLVED / CLOSED. */
export async function updateOndcIssueStatus(req: Request, res: Response): Promise<void> {
  const row = await loadOwnedTicket(req);
  const { status, note } = req.body as { status: string; note?: string | null };
  const s = String(status || '').toUpperCase();
  const kind = s === 'RESOLVED' ? 'resolve' : s === 'CLOSED' ? 'close' : 'processing';
  await igmService.sellerAction(row.id, kind, note ? { note } : {});
  ApiResponse.success(res, 'Status updated');
}

/** PATCH /api/v1/ondc/admin/issues/:id/resolve — resolve the issue. */
export async function resolveOndcIssue(req: Request, res: Response): Promise<void> {
  const row = await loadOwnedTicket(req);
  const { resolution_note } = req.body as { resolution_note: string };
  await igmService.sellerAction(row.id, 'resolve', { resolution_note });
  ApiResponse.success(res, 'Issue resolved');
}

/** PATCH /api/v1/ondc/admin/issues/:id/close — close the issue. */
export async function closeOndcIssue(req: Request, res: Response): Promise<void> {
  const row = await loadOwnedTicket(req);
  const { note } = req.body as { note?: string | null };
  await igmService.sellerAction(row.id, 'close', note ? { note } : {});
  ApiResponse.success(res, 'Issue closed');
}
