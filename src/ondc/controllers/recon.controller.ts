/**
 * RSF Recon Controller — handles /recon and /on_receiver_recon endpoints.
 * TODO: Implement full RSF reconciliation flow.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { settlementService } from '~/ondc/services/settlement.service';
import { ondcLogger } from '~/ondc/utils/logger.util';

/** POST /api/v1/ondc/on_receiver_recon */
export async function handleOnReceiverRecon(req: Request, res: Response): Promise<void> {
  ondcLogger.info('Received on_receiver_recon', { body: req.body });
  await settlementService.processReceiverRecon(req.body);
  ApiResponse.success(res, 'Recon received');
}

/** GET /api/v1/ondc/admin/recon/report */
export async function getReconReport(req: Request, res: Response): Promise<void> {
  const { from, to } = req.query as { from: string; to: string };
  const report = await settlementService.generateReconReport(new Date(from), new Date(to));
  ApiResponse.success(res, 'Recon report', report);
}
