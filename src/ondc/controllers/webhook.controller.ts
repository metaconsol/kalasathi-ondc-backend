/**
 * Generic webhook controller for inbound ONDC callbacks.
 * Currently a pass-through; extend as needed.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { webhookService } from '~/ondc/services/webhook.service';

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const action = req.path.split('/').pop() ?? 'unknown';
  await webhookService.process(action, req.body);
  ApiResponse.success(res, 'Webhook received');
}
