/**
 * Admin Logs Controller — view ONDC transaction logs.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { txnLogModel } from '~/ondc/models/log.model';

/** GET /api/v1/ondc/admin/logs */
export async function listLogs(req: Request, res: Response): Promise<void> {
  const { limit = '100', offset = '0', q, action } = req.query as Record<string, string>;
  const limitNum = parseInt(limit, 10);
  const offsetNum = parseInt(offset, 10);
  const [logs, total] = await Promise.all([
    txnLogModel.listFiltered({
      limit: limitNum,
      offset: offsetNum,
      ...(q ? { q } : {}),
      ...(action ? { action } : {}),
    }),
    txnLogModel.countFiltered({
      ...(q ? { q } : {}),
      ...(action ? { action } : {}),
    }),
  ]);
  ApiResponse.success(res, 'Transaction logs', logs, {
    total,
    page: Math.floor(offsetNum / limitNum) + 1,
    limit: limitNum,
    totalPages: Math.max(1, Math.ceil(total / limitNum)),
  });
}

/** GET /api/v1/ondc/admin/logs/:transactionId */
export async function getLogsByTransaction(req: Request, res: Response): Promise<void> {
  const logs = await txnLogModel.findByTransactionId(req.params['transactionId'] as string);
  ApiResponse.success(res, 'Logs for transaction', logs);
}
