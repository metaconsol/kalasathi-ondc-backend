/**
 * Admin Logs Controller — view ONDC transaction logs.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { txnLogModel } from '~/ondc/models/log.model';
import { transactionModel } from '~/ondc/models/transaction.model';

/** GET /api/v1/ondc/admin/logs */
export async function listLogs(req: Request, res: Response): Promise<void> {
  const {
    limit = '100',
    offset,
    page,
    q,
    action,
    direction,
    domain,
  } = req.query as Record<string, string>;
  const limitNum = Math.max(1, parseInt(limit, 10) || 100);
  // Prefer the `page` convention (what the UI sends); fall back to an explicit
  // `offset` for older callers. Without this, every page returned OFFSET 0.
  const pageNum = Math.max(1, parseInt(page ?? '', 10) || 1);
  const offsetNum =
    offset !== undefined ? Math.max(0, parseInt(offset, 10) || 0) : (pageNum - 1) * limitNum;
  const dir = direction === 'inbound' || direction === 'outbound' ? direction : undefined;
  const filter = {
    ...(q ? { q } : {}),
    ...(action ? { action } : {}),
    ...(dir ? { direction: dir } : {}),
    ...(domain ? { domain } : {}),
  };
  const [logs, total] = await Promise.all([
    txnLogModel.listFiltered({ limit: limitNum, offset: offsetNum, ...filter }),
    txnLogModel.countFiltered(filter),
  ]);
  ApiResponse.success(res, 'Transaction logs', logs, {
    total,
    page: Math.floor(offsetNum / limitNum) + 1,
    limit: limitNum,
    totalPages: Math.max(1, Math.ceil(total / limitNum)),
  });
}

/**
 * DELETE /api/v1/ondc/admin/logs
 * Deletes logs from ondc_txn_logs. Selectors (all ANDed) come from the body:
 *   ids[]             — specific ondc_txn_logs.id rows
 *   transaction_ids[] — every log belonging to these transactions
 *   action            — e.g. 'search', 'on_search'
 *   actions[]         — delete rows matching any of these actions (e.g. ['search','on_search'])
 *   direction         — 'inbound' | 'outbound'
 *   domain            — e.g. 'ONDC:RET16'
 *   q                 — transaction_id LIKE match
 * At least one selector is required, otherwise 400 (guards against wiping the table).
 */
export async function deleteLogs(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as {
    ids?: unknown;
    transaction_ids?: unknown;
    action?: unknown;
    actions?: unknown;
    direction?: unknown;
    domain?: unknown;
    q?: unknown;
    bap_id?: unknown;
    days?: unknown;
  };

  const ids = Array.isArray(body.ids)
    ? body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const transactionIds = Array.isArray(body.transaction_ids)
    ? body.transaction_ids.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const action = body.action ? String(body.action).trim() : undefined;
  const actions = Array.isArray(body.actions)
    ? body.actions.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const direction =
    body.direction === 'inbound' || body.direction === 'outbound'
      ? (body.direction as string)
      : undefined;
  const domain = body.domain ? String(body.domain).trim() : undefined;
  const q = body.q ? String(body.q).trim() : undefined;
  const bapId = body.bap_id ? String(body.bap_id).trim() : undefined;
  const days = body.days ? Number(body.days) : undefined;

  const hasSelector =
    ids.length > 0 ||
    transactionIds.length > 0 ||
    !!action ||
    actions.length > 0 ||
    !!direction ||
    !!domain ||
    !!q ||
    !!bapId ||
    (days !== undefined && !Number.isNaN(days) && days > 0);
  if (!hasSelector) {
    ApiResponse.badRequest(res, 'Provide at least one filter or selection to delete logs');
    return;
  }

  const deleted = await txnLogModel.deleteFiltered({
    ...(ids.length ? { ids } : {}),
    ...(transactionIds.length ? { transactionIds } : {}),
    ...(actions.length ? { actions } : {}),
    ...(action && !actions.length ? { action } : {}),
    ...(direction ? { direction } : {}),
    ...(domain ? { domain } : {}),
    ...(q ? { q } : {}),
    ...(bapId ? { bapId } : {}),
    ...(days ? { days } : {}),
  });

  // ondc_transactions summarises these logs and is unreachable without them, so it follows.
  const transactionsDeleted = await transactionModel.deleteOrphans(
    transactionIds.length ? transactionIds : undefined,
  );

  ApiResponse.success(res, `Deleted ${deleted} log${deleted === 1 ? '' : 's'}`, {
    deleted,
    transactions_deleted: transactionsDeleted,
  });
}

/** GET /api/v1/ondc/admin/logs/:transactionId */
export async function getLogsByTransaction(req: Request, res: Response): Promise<void> {
  const logs = await txnLogModel.findByTransactionId(req.params['transactionId'] as string);
  ApiResponse.success(res, 'Logs for transaction', logs);
}
