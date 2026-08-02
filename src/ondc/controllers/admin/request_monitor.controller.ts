/**
 * Request Monitor Controller
 *
 * Mirrors PHP request_monitor.php:
 *   - Tab counts per action (select, init, confirm, status, track, cancel, update, issue…)
 *   - Paginated list of transactions for a given action, cross-joined with outbound ack status
 *   - Per-transaction detail: full event timeline from ondc_txn_logs
 *
 * Source table: ondc_txn_logs (replaces PHP's ondc_messages).
 * Columns used: transaction_id, message_id, action, direction, bap_id, domain,
 *               http_status, ack_status, error_message, payload_json, created_at
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcQuery } from '~/lib/ondcSql';
import { transactionModel } from '~/ondc/models/transaction.model';

const ACTIONS = [
  'search',
  'select',
  'init',
  'confirm',
  'status',
  'track',
  'cancel',
  'update',
  'issue',
  'issue_status',
  'issue_close',
  'catalog_rejection',
] as const;
type BecknAction = (typeof ACTIONS)[number];

/** GET /api/v1/ondc/admin/request-monitor/counts
 *  Returns how many distinct transaction_ids exist per inbound action.
 */
export async function getActionCounts(req: Request, res: Response): Promise<void> {
  const days = Math.min(365, Math.max(0, parseInt(String(req.query['days'] ?? '7'), 10) || 7));
  const since = days > 0 ? `AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)` : '';
  const domain = String(req.query['domain'] ?? '').trim();
  const domainCond = domain ? 'AND domain = ?' : '';
  const rows = await ondcQuery<{ action: string; cnt: number }>(
    `SELECT action, COUNT(DISTINCT transaction_id) AS cnt
     FROM ondc_txn_logs
     WHERE direction = 'inbound' ${since} ${domainCond}
     GROUP BY action`,
    domain ? [domain] : [],
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = Number(r.cnt);
  ApiResponse.success(res, 'Action counts', counts);
}

/** GET /api/v1/ondc/admin/request-monitor
 *  Paginated list of transactions for one action, with outbound callback ack.
 *
 *  Query params:
 *    action   — one of the ACTIONS list (default: select)
 *    days     — 0=all, default 7
 *    q        — transaction_id substring search
 *    bap_id   — exact bap_id match (buyer app filter)
 *    ack      — '' | 'ACK' | 'NACK'  (buyer response filter)
 *    page     — default 1
 *    limit    — default 25, max 100
 */
export async function listByAction(req: Request, res: Response): Promise<void> {
  const rawAction = String(req.query['action'] ?? 'select').toLowerCase() as BecknAction;
  const action = ACTIONS.includes(rawAction) ? rawAction : 'select';
  const outAction = action === 'catalog_rejection' ? null : `on_${action}`;

  const days = Math.min(365, Math.max(0, parseInt(String(req.query['days'] ?? '7'), 10) || 7));
  const q = String(req.query['q'] ?? '').trim();
  const bapId = String(req.query['bap_id'] ?? '').trim();
  const domain = String(req.query['domain'] ?? '').trim();
  const ack = String(req.query['ack'] ?? '').toUpperCase();
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '25'), 10) || 25));
  const offset = (page - 1) * limit;

  // WHERE-clause params (used for COUNT and for the WHERE part of list queries)
  const whereParams: (string | number)[] = [action];
  let where = `direction = 'inbound' AND action = ?`;
  if (days > 0) where += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
  if (q) {
    where += ' AND transaction_id LIKE ?';
    whereParams.push(`%${q}%`);
  }
  if (bapId) {
    where += ' AND bap_id = ?';
    whereParams.push(bapId);
  }
  if (domain) {
    where += ' AND domain = ?';
    whereParams.push(domain);
  }

  // Correlated subqueries for outbound ack — each binds ONE outAction param
  const ackSub = outAction
    ? `(SELECT ack_status FROM ondc_txn_logs ob
       WHERE ob.transaction_id = l.transaction_id
         AND ob.action = ? AND ob.direction = 'outbound'
       ORDER BY ob.id DESC LIMIT 1)`
    : 'NULL';
  const httpSub = outAction
    ? `(SELECT http_status FROM ondc_txn_logs oh
       WHERE oh.transaction_id = l.transaction_id
         AND oh.action = ? AND oh.direction = 'outbound'
       ORDER BY oh.id DESC LIMIT 1)`
    : 'NULL';
  const errSub = outAction
    ? `(SELECT error_message FROM ondc_txn_logs oe
       WHERE oe.transaction_id = l.transaction_id
         AND oe.action = ? AND oe.direction = 'outbound'
       ORDER BY oe.id DESC LIMIT 1)`
    : 'NULL';

  // IMPORTANT: subquery ?s appear BEFORE the WHERE ?s in the SQL,
  // so subquery params must come first in the array.
  const subParams: (string | number)[] = outAction ? [outAction, outAction, outAction] : [];
  const listParams = [...subParams, ...whereParams]; // for list queries

  // Count (no subqueries in SELECT → only whereParams)
  const countRows = await ondcQuery<{ total: number }>(
    `SELECT COUNT(DISTINCT transaction_id) AS total FROM ondc_txn_logs l WHERE ${where}`,
    whereParams,
  );
  let total = Number(countRows[0]?.total ?? 0);

  // ACK filter — wraps query in subquery
  let rows: any[];
  if (ack === 'ACK' || ack === 'NACK') {
    rows = await ondcQuery<any>(
      `SELECT * FROM (
        SELECT
          l.transaction_id,
          MIN(l.created_at)   AS received_at,
          MAX(l.bap_id)       AS bap_id,
          MAX(l.domain)       AS domain,
          ${ackSub}           AS buyer_ack,
          ${httpSub}          AS http_status,
          ${errSub}           AS buyer_err
        FROM ondc_txn_logs l
        WHERE ${where}
        GROUP BY l.transaction_id
      ) AS grouped
      WHERE buyer_ack = ?
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?`,
      [...listParams, ack, limit, offset],
    );
    // Re-count for ack-filtered (ackSub binds 1 param)
    const ackSubParams = outAction ? [outAction] : [];
    const countFiltered = await ondcQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM (
        SELECT l.transaction_id, ${ackSub} AS buyer_ack
        FROM ondc_txn_logs l
        WHERE ${where}
        GROUP BY l.transaction_id
      ) AS grouped WHERE buyer_ack = ?`,
      [...ackSubParams, ...whereParams, ack],
    );
    total = Number(countFiltered[0]?.total ?? 0);
  } else {
    rows = await ondcQuery<any>(
      `SELECT
         l.transaction_id,
         MIN(l.created_at)   AS received_at,
         MAX(l.bap_id)       AS bap_id,
         MAX(l.domain)       AS domain,
         ${ackSub}           AS buyer_ack,
         ${httpSub}          AS http_status,
         ${errSub}           AS buyer_err
       FROM ondc_txn_logs l
       WHERE ${where}
       GROUP BY l.transaction_id
       ORDER BY received_at DESC
       LIMIT ? OFFSET ?`,
      [...listParams, limit, offset],
    );
  }

  ApiResponse.success(res, `Requests for ${action}`, rows, {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

/** GET /api/v1/ondc/admin/request-monitor/:transactionId
 *  Full event timeline for one transaction (all inbound + outbound logs).
 *  Strips payload_json from list (too large) — UI fetches via getLogs/:txnId for payload.
 */
export async function getTimeline(req: Request, res: Response): Promise<void> {
  const txnId = req.params['transactionId'] as string;

  const [txn, logs] = await Promise.all([
    ondcQuery<any>(`SELECT * FROM ondc_transactions WHERE transaction_id = ? LIMIT 1`, [txnId]),
    ondcQuery<any>(
      `SELECT id, transaction_id, message_id, action, direction,
              bap_id, domain, http_status, ack_status, error_message,
              LEFT(payload_json, 8000) AS payload_preview, created_at
       FROM ondc_txn_logs
       WHERE transaction_id = ?
       ORDER BY id ASC`,
      [txnId],
    ),
  ]);

  ApiResponse.success(res, 'Transaction timeline', {
    transaction: txn[0] ?? null,
    logs,
  });
}

/** GET /api/v1/ondc/admin/buyer-apps
 *  Distinct buyer apps (bap_id) that have ever sent us an inbound request,
 *  with per-app request count, first/last seen, and the domains they used.
 *
 *  Query params:
 *    days — 0=all (default), else last N days
 *    q    — bap_id substring search
 */
export async function listBuyerApps(req: Request, res: Response): Promise<void> {
  const days = Math.min(365, Math.max(0, parseInt(String(req.query['days'] ?? '0'), 10) || 0));
  const q = String(req.query['q'] ?? '').trim();

  const params: (string | number)[] = [];
  let where = `direction = 'inbound' AND bap_id IS NOT NULL AND bap_id <> ''`;
  if (days > 0) where += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
  if (q) {
    where += ' AND bap_id LIKE ?';
    params.push(`%${q}%`);
  }

  const rows = await ondcQuery<{
    bap_id: string;
    request_count: number;
    first_seen: string | null;
    last_seen: string | null;
    domains: string | null;
  }>(
    `SELECT bap_id,
            COUNT(*)                          AS request_count,
            MIN(created_at)                   AS first_seen,
            MAX(created_at)                   AS last_seen,
            GROUP_CONCAT(DISTINCT domain ORDER BY domain SEPARATOR ', ') AS domains
     FROM ondc_txn_logs
     WHERE ${where}
     GROUP BY bap_id
     ORDER BY last_seen DESC`,
    params,
  );

  ApiResponse.success(
    res,
    'Buyer apps',
    rows.map((r) => ({ ...r, request_count: Number(r.request_count) })),
    { total: rows.length },
  );
}

/** GET /api/v1/ondc/admin/request-monitor/transaction-records
 *  Size of ondc_transactions and how much of it is safe to purge.
 */
export async function getTransactionRecordStats(_req: Request, res: Response): Promise<void> {
  ApiResponse.success(res, 'Transaction records', await transactionModel.stats());
}

/** DELETE /api/v1/ondc/admin/request-monitor/transaction-records
 *  Purges rows whose logs are already gone. Order-bearing transactions are kept.
 */
export async function purgeTransactionRecords(_req: Request, res: Response): Promise<void> {
  const deleted = await transactionModel.deleteOrphans();
  ApiResponse.success(res, `Purged ${deleted} transaction record${deleted === 1 ? '' : 's'}`, {
    deleted,
  });
}
