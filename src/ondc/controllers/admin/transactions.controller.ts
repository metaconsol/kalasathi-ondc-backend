/**
 * Admin Transactions Controller — funnel rows from overall_txns.
 * Used by the Search Monitor UI page to track every Beckn lifecycle.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcQuery } from '~/lib/ondcSql';

/** GET /api/v1/ondc/admin/transactions */
export async function listTransactions(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '25'), 10) || 25));
  const offset = (page - 1) * limit;

  const [rows, countRows] = await Promise.all([
    ondcQuery<any>(
      `SELECT id, txn_id, provider_id, on_search, on_select, on_init, on_confirm,
              on_status, on_track, product_id, product_name, item_count,
              order_amount, payment_status, payment_method, order_status,
              track_link, is_archived, created_at, updated_at
       FROM overall_txns
       WHERE is_archived = 0
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    ),
    ondcQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM overall_txns WHERE is_archived = 0`,
    ),
  ]);

  const total = countRows[0]?.total ?? 0;
  ApiResponse.success(res, 'Transactions', rows, {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}
