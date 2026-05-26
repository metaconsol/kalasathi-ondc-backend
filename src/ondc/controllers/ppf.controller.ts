/**
 * PPF (Payment Protection Framework) Controllers.
 *
 * Beckn endpoint:
 *   POST /api/v1/ondc/on_receiver_recon  — BAP → BPP settlement callback
 *
 * Admin endpoints:
 *   GET  /api/v1/ondc/admin/ppf          — list PPF recon records
 *   POST /api/v1/ondc/admin/ppf/trigger  — manually trigger recon for an order
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { ppfService } from '~/ondc/services/ppf.service';
import { ppfModel } from '~/ondc/models/ppf.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { buildAck } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

/** POST /api/v1/ondc/on_receiver_recon — Beckn callback from BAP */
export async function handleOnReceiverRecon(req: Request, res: Response): Promise<void> {
  const ctx = (req.body as { context?: BecknContext })?.context;
  res.status(200).json(buildAck(ctx ?? ({} as BecknContext)));

  setImmediate(async () => {
    try {
      await txnLogModel.insert({
        transaction_id: ctx?.transaction_id ?? '',
        message_id: ctx?.message_id ?? '',
        action: 'on_receiver_recon',
        direction: 'inbound',
        bap_id: ctx?.bap_id ?? '',
        bpp_id: ctx?.bpp_id ?? null,
        domain: ctx?.domain ?? 'ONDC:NTS10',
        http_status: null,
        ack_status: 'ACK',
        payload_json: JSON.stringify(req.body),
        error_message: null,
      });
      await ppfService.processOnRecon(req.body);
    } catch (err) {
      ondcLogger.error('on_receiver_recon async error', { err });
    }
  });
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
  ApiResponse.success(res, 'PPF recon records', rows);
}

/** GET /api/v1/ondc/admin/ppf/:orderId — recon records for one order */
export async function getPpfReconByOrder(req: Request, res: Response): Promise<void> {
  const rows = await ppfModel.findByOrderId(req.params['orderId'] as string);
  ApiResponse.success(res, 'PPF recon for order', rows);
}

/** POST /api/v1/ondc/admin/ppf/trigger — manually send recon to BAP */
export async function triggerPpfRecon(req: Request, res: Response): Promise<void> {
  const { ondc_order_id } = req.body as { ondc_order_id: string };
  if (!ondc_order_id) {
    res.status(400).json({ error: 'ondc_order_id required' });
    return;
  }
  const rowId = await ppfService.sendRecon(ondc_order_id);
  ApiResponse.success(res, 'PPF recon triggered', { ppf_recon_id: rowId });
}
