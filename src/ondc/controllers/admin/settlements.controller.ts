/**
 * Admin Settlements Controller — view and manage RSF settlements.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { settlementModel } from '~/ondc/models/settlement.model';
import { settlementService } from '~/ondc/services/settlement.service';
import type { SettlementStatus } from '~/ondc/models/settlement.model';

/** GET /api/v1/ondc/admin/settlements */
export async function listSettlements(req: Request, res: Response): Promise<void> {
  const { status, limit = '50', offset = '0' } = req.query as Record<string, string>;
  const settlements = await settlementModel.list({
    ...(status ? { status: status as SettlementStatus } : {}),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
  ApiResponse.success(res, 'Settlements', settlements);
}

/** POST /api/v1/ondc/admin/settlements/generate */
export async function generateSettlement(req: Request, res: Response): Promise<void> {
  const { ondc_order_id } = req.body as { ondc_order_id: string };
  const settlementId = await settlementService.createForOrder(ondc_order_id);
  ApiResponse.success(res, 'Settlement created', { settlement_id: settlementId });
}
