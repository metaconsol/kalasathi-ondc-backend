/**
 * ondc_txn_logs — persists every inbound/outbound ONDC network call.
 * Used for debugging, auditing, and observability.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import type { OndcTxnLog } from '~/ondc/types/api.types';

type InsertPayload = Omit<OndcTxnLog, 'id' | 'created_at'>;

// /confirm re-reads its own on_select quote, so deleting a live one re-quotes delivery at zero.
const PROTECT_HOURS = Math.max(
  0,
  Math.trunc(Number(process.env['ONDC_LOG_PROTECT_HOURS'] ?? 48)) || 0,
);
const QUOTE_IN_USE = `action = 'on_select' AND direction = 'outbound'
     AND created_at >= DATE_SUB(NOW(), INTERVAL ${PROTECT_HOURS} HOUR)
     AND NOT EXISTS (SELECT 1 FROM ondc_orders o WHERE o.transaction_id = ondc_txn_logs.transaction_id)`;

/** Build the shared WHERE clause used by listFiltered / countFiltered. */
function buildLogFilter(filters: {
  q?: string;
  action?: string;
  direction?: string;
  domain?: string;
}): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.action) {
    conds.push('action = ?');
    params.push(filters.action);
  }
  if (filters.direction) {
    conds.push('direction = ?');
    params.push(filters.direction);
  }
  if (filters.domain) {
    conds.push('domain = ?');
    params.push(filters.domain);
  }
  if (filters.q) {
    conds.push('transaction_id LIKE ?');
    params.push(`%${filters.q}%`);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export const txnLogModel = {
  async insert(data: InsertPayload): Promise<number> {
    const result = await ondcExec(
      `INSERT INTO ondc_txn_logs
        (transaction_id, message_id, action, direction, bap_id, bpp_id,
         domain, http_status, ack_status, payload_json, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.transaction_id,
        data.message_id,
        data.action,
        data.direction,
        data.bap_id,
        data.bpp_id,
        data.domain,
        data.http_status,
        data.ack_status,
        data.payload_json,
        data.error_message,
      ],
    );
    return result.insertId;
  },

  async findByTransactionId(transactionId: string): Promise<OndcTxnLog[]> {
    return ondcQuery<OndcTxnLog>(
      `SELECT * FROM ondc_txn_logs WHERE transaction_id = ? ORDER BY created_at ASC`,
      [transactionId],
    );
  },

  async listRecent(limit = 100, offset = 0): Promise<OndcTxnLog[]> {
    return ondcQuery<OndcTxnLog>(
      `SELECT * FROM ondc_txn_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  },

  async listFiltered(filters: {
    limit?: number;
    offset?: number;
    q?: string;
    action?: string;
    direction?: string;
    domain?: string;
  }): Promise<OndcTxnLog[]> {
    const { where, params } = buildLogFilter(filters);
    return ondcQuery<OndcTxnLog>(
      `SELECT * FROM ondc_txn_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 100, filters.offset ?? 0],
    );
  },

  async countFiltered(filters: {
    q?: string;
    action?: string;
    direction?: string;
    domain?: string;
  }): Promise<number> {
    const { where, params } = buildLogFilter(filters);
    const rows = await ondcQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ondc_txn_logs ${where}`,
      params,
    );
    return rows[0]?.total ?? 0;
  },

  /**
   * Delete logs matching a set of selectors (all ANDed together).
   * Returns the number of rows removed. Returns 0 (no-op) when NO selector is
   * supplied — a guard so an empty payload can never wipe the whole table.
   * Quotes a /confirm may still re-read are always excluded (see QUOTE_IN_USE).
   */
  async deleteFiltered(filters: {
    ids?: number[];
    transactionIds?: string[];
    action?: string;
    actions?: string[];
    direction?: string;
    domain?: string;
    q?: string;
    bapId?: string;
    days?: number;
    /** Every row. Still honours the in-use quote guard below. */
    all?: boolean;
  }): Promise<number> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.ids && filters.ids.length) {
      conds.push(`id IN (${filters.ids.map(() => '?').join(',')})`);
      params.push(...filters.ids);
    }
    if (filters.transactionIds && filters.transactionIds.length) {
      conds.push(`transaction_id IN (${filters.transactionIds.map(() => '?').join(',')})`);
      params.push(...filters.transactionIds);
    }
    if (filters.actions && filters.actions.length) {
      conds.push(`action IN (${filters.actions.map(() => '?').join(',')})`);
      params.push(...filters.actions);
    } else if (filters.action) {
      conds.push('action = ?');
      params.push(filters.action);
    }
    if (filters.direction) {
      conds.push('direction = ?');
      params.push(filters.direction);
    }
    if (filters.domain) {
      conds.push('domain = ?');
      params.push(filters.domain);
    }
    if (filters.q) {
      conds.push('transaction_id LIKE ?');
      params.push(`%${filters.q}%`);
    }
    if (filters.bapId) {
      conds.push('bap_id = ?');
      params.push(filters.bapId);
    }
    if (filters.days && filters.days > 0) {
      conds.push('created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)');
      params.push(filters.days);
    }

    // Safety net: never run an unbounded DELETE unless it was asked for explicitly.
    if (filters.all && conds.length === 0) conds.push('1 = 1');
    if (conds.length === 0) return 0;
    if (PROTECT_HOURS > 0) conds.push(`NOT (${QUOTE_IN_USE})`);

    const result = await ondcExec(`DELETE FROM ondc_txn_logs WHERE ${conds.join(' AND ')}`, params);
    return result.affectedRows;
  },

  /**
   * transaction_ids currently visible for one action, including the ACK/NACK filter.
   *
   * buyer_ack is derived from the newest outbound on_<action> row, not stored on the
   * inbound row, so it cannot be expressed as a WHERE on the delete. Resolving the
   * ids here and deleting by them keeps "delete what I am looking at" exact instead
   * of quietly deleting more than the screen showed.
   */
  async transactionIdsForAction(filters: {
    action: string;
    days?: number;
    q?: string;
    bapId?: string;
    domain?: string;
    ack?: string;
  }): Promise<string[]> {
    const conds = [`direction = 'inbound'`, 'action = ?'];
    const params: unknown[] = [filters.action];
    if (filters.days && filters.days > 0) {
      conds.push('created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)');
      params.push(filters.days);
    }
    if (filters.q) {
      conds.push('transaction_id LIKE ?');
      params.push(`%${filters.q}%`);
    }
    if (filters.bapId) {
      conds.push('bap_id = ?');
      params.push(filters.bapId);
    }
    if (filters.domain) {
      conds.push('domain = ?');
      params.push(filters.domain);
    }

    const ack = String(filters.ack ?? '').toUpperCase();
    const wantAck = ack === 'ACK' || ack === 'NACK';
    const outAction = `on_${filters.action}`;
    const ackSub = `(SELECT ob.ack_status FROM ondc_txn_logs ob
         WHERE ob.transaction_id = l.transaction_id
           AND ob.action = ? AND ob.direction = 'outbound'
         ORDER BY ob.id DESC LIMIT 1)`;

    const sql = wantAck
      ? `SELECT transaction_id FROM (
           SELECT l.transaction_id, ${ackSub} AS buyer_ack
           FROM ondc_txn_logs l WHERE ${conds.join(' AND ')}
           GROUP BY l.transaction_id
         ) g WHERE buyer_ack = ?`
      : `SELECT DISTINCT l.transaction_id FROM ondc_txn_logs l WHERE ${conds.join(' AND ')}`;
    const args = wantAck ? [outAction, ...params, ack] : params;

    const rows = await ondcQuery<{ transaction_id: string }>(sql, args);
    return rows.map((r) => String(r.transaction_id));
  },

  async countAll(): Promise<number> {
    const rows = await ondcQuery<{ total: number }>(`SELECT COUNT(*) AS total FROM ondc_txn_logs`);
    return rows[0]?.total ?? 0;
  },
};
