/**
 * PPF (Payment Protection Framework) / RSF Controllers.
 *
 * Beckn endpoints (ONDC:NTS10 v2.0.0):
 *   POST /api/v1/ondc/recon              — BAP/collector → BPP/receiver
 *   POST /api/v1/ondc/on_recon           — BAP response to BPP-initiated recon
 *   POST /api/v1/ondc/on_receiver_recon   — legacy alias → on_recon
 *
 * Admin endpoints:
 *   GET  /api/v1/ondc/admin/ppf
 *   GET  /api/v1/ondc/admin/ppf/order/:orderId
 *   POST /api/v1/ondc/admin/ppf/trigger
 */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { ppfService } from '~/ondc/services/ppf.service';
import { ppfModel } from '~/ondc/models/ppf.model';
import { buildNtsAck } from '~/ondc/utils/ppf.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { orderModel } from '~/ondc/models/order.model';
import { assertOrderVisible } from '~/ondc/controllers/admin/orders.controller';

function parsePpfRow(row: Awaited<ReturnType<typeof ppfModel.findByOrderId>>[number]) {
  const safeParse = (json: string | null) => {
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  };
  return {
    ...row,
    quote: safeParse(row.quote_json ?? null),
    settlements: safeParse(row.settlements_json),
    inbound_recon: safeParse(row.inbound_recon_payload ?? null),
    on_recon_received: safeParse(row.on_recon_payload ?? null),
    on_recon_sent: safeParse(row.outbound_on_recon_payload ?? null),
  };
}

/** POST /api/v1/ondc/recon — collector sends recon to receiver (us as BPP) */
export async function handleRecon(req: Request, res: Response): Promise<void> {
  res.status(200).json(buildNtsAck(req.body as Record<string, unknown>));

  setImmediate(async () => {
    try {
      await ppfService.handleInboundRecon(req.body);
    } catch (err) {
      ondcLogger.error('recon async error', { err });
    }
  });
}

/** POST /api/v1/ondc/on_recon — BAP responds to our recon */
export async function handleOnRecon(req: Request, res: Response): Promise<void> {
  res.status(200).json(buildNtsAck(req.body as Record<string, unknown>));

  setImmediate(async () => {
    try {
      await ppfService.processOnRecon(req.body);
    } catch (err) {
      ondcLogger.error('on_recon async error', { err });
    }
  });
}

/** POST /api/v1/ondc/on_receiver_recon — legacy alias */
export async function handleOnReceiverRecon(req: Request, res: Response): Promise<void> {
  return handleOnRecon(req, res);
}

/** GET /api/v1/ondc/admin/ppf — list PPF recon records */
export async function listPpfRecon(req: Request, res: Response): Promise<void> {
  const { status, limit = '50', offset = '0' } = req.query as Record<string, string>;
  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? req.user?.id : undefined;
  const rows = await ppfModel.list({
    ...(status ? { status } : {}),
    ...(sellerId !== undefined ? { sellerId } : {}),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
  ApiResponse.success(res, 'PPF recon records', rows.map(parsePpfRow));
}

/** GET /api/v1/ondc/admin/ppf/order/:orderId — recon history for one order */
export async function getPpfReconByOrder(req: Request, res: Response): Promise<void> {
  const orderId = req.params['orderId'] as string;
  // Recon rows carry financial settlement data and have no seller_id of
  // their own — ownership is the underlying order's, same guard as every
  // other per-order endpoint (orders/logistics).
  const order = await orderModel.findByOndcOrderId(orderId);
  if (!order) throw new AppError('Order not found', 404);
  assertOrderVisible(req, order);
  const rows = await ppfModel.findByOrderId(orderId);
  ApiResponse.success(res, 'PPF recon for order', rows.map(parsePpfRow));
}

/** POST /api/v1/ondc/admin/ppf/trigger — manually send recon to BAP */
export async function triggerPpfRecon(req: Request, res: Response): Promise<void> {
  const body = req.body as { ondc_order_id?: string; order_id?: string };
  const ondc_order_id = body.ondc_order_id ?? body.order_id;
  if (!ondc_order_id) {
    res.status(400).json({ error: 'ondc_order_id required' });
    return;
  }
  const order = await orderModel.findByOndcOrderId(ondc_order_id);
  if (!order) {
    res.status(404).json({ error: 'Order not found or recon failed — check server logs' });
    return;
  }
  // A seller must not be able to trigger recon actions on another seller's
  // order (probing existence, or sending unwanted BAP recon messages).
  assertOrderVisible(req, order);
  const rowId = await ppfService.sendRecon(ondc_order_id);
  if (rowId == null) {
    res.status(404).json({ error: 'Order not found or recon failed — check server logs' });
    return;
  }
  ApiResponse.success(res, 'PPF recon triggered', { ppf_recon_id: rowId });
}
