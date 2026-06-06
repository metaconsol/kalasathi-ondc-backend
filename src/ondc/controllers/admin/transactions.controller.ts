/**
 * Admin Transactions Controller — funnel rows from overall_txns.
 * Used by the Search Monitor UI page to track every Beckn lifecycle.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcQuery, ondcExec } from '~/lib/ondcSql';

// Funnel-stage columns that may be used as filters/selectors. Whitelisted to
// prevent SQL injection via column names — only these keys ever reach the query.
const STAGE_COLUMNS = [
  'on_search',
  'on_select',
  'on_init',
  'on_confirm',
  'on_status',
  'on_track',
] as const;

/**
 * Build the shared WHERE clause for stage + provider selectors.
 * Stage flags become `AND <col> = 1` (transaction reached that stage);
 * provider_id becomes `AND provider_id = ?`. Returns the SQL fragment and
 * the ordered positional params.
 */
function buildSelectors(src: Record<string, unknown>): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const col of STAGE_COLUMNS) {
    // Truthy flag (1, '1', true) → require that stage
    const v = src[col];
    if (v === 1 || v === '1' || v === true || v === 'true') {
      clauses.push(`${col} = 1`);
    }
  }

  const providerId = src['provider_id'] ? String(src['provider_id']).trim() : '';
  if (providerId) {
    clauses.push('provider_id = ?');
    params.push(providerId);
  }

  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}

/** GET /api/v1/ondc/admin/transactions */
export async function listTransactions(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '25'), 10) || 25));
  const offset = (page - 1) * limit;

  const { sql: selectorSql, params: selectorParams } = buildSelectors(
    req.query as Record<string, unknown>,
  );

  const [rows, countRows] = await Promise.all([
    ondcQuery<any>(
      `SELECT id, txn_id, provider_id, on_search, on_select, on_init, on_confirm,
              on_status, on_track, product_id, product_name, item_count,
              order_amount, payment_status, payment_method, order_status,
              track_link, is_archived, created_at, updated_at
       FROM overall_txns
       WHERE is_archived = 0${selectorSql}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [...selectorParams, limit, offset],
    ),
    ondcQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM overall_txns WHERE is_archived = 0${selectorSql}`,
      [...selectorParams],
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

/**
 * DELETE /api/v1/ondc/admin/transactions
 * Permanently removes rows from overall_txns. Selectors (all ANDed) from body:
 *   txn_ids[]    — specific overall_txns.txn_id rows
 *   provider_id  — every transaction for this provider
 *   on_search…on_track — funnel-stage flags (transaction reached that stage)
 * At least one selector is required, otherwise 400 (guards against wiping the table).
 */
export async function deleteTransactions(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const txnIds = Array.isArray(body['txn_ids'])
    ? (body['txn_ids'] as unknown[]).map((t) => String(t).trim()).filter(Boolean)
    : [];

  const { sql: selectorSql, params: selectorParams } = buildSelectors(body);

  const hasSelector = txnIds.length > 0 || selectorSql.length > 0;
  if (!hasSelector) {
    ApiResponse.badRequest(res, 'Provide at least one filter or selection to delete transactions');
    return;
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (txnIds.length) {
    clauses.push(`txn_id IN (${txnIds.map(() => '?').join(',')})`);
    params.push(...txnIds);
  }
  if (selectorSql) {
    // selectorSql is prefixed with ' AND '; strip it for standalone use
    clauses.push(selectorSql.replace(/^ AND /, ''));
    params.push(...selectorParams);
  }

  const result = await ondcExec(`DELETE FROM overall_txns WHERE ${clauses.join(' AND ')}`, params);
  const deleted = result.affectedRows ?? 0;

  ApiResponse.success(res, `Deleted ${deleted} transaction${deleted === 1 ? '' : 's'}`, {
    deleted,
  });
}
