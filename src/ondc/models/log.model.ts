/**
 * ondc_txn_logs — persists every inbound/outbound ONDC network call.
 * Used for debugging, auditing, and observability.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import type { OndcTxnLog } from '~/ondc/types/api.types';

type InsertPayload = Omit<OndcTxnLog, 'id' | 'created_at'>;

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
  }): Promise<OndcTxnLog[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.action) {
      conds.push('action = ?');
      params.push(filters.action);
    }
    if (filters.q) {
      conds.push('transaction_id LIKE ?');
      params.push(`%${filters.q}%`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return ondcQuery<OndcTxnLog>(
      `SELECT * FROM ondc_txn_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 100, filters.offset ?? 0],
    );
  },

  async countFiltered(filters: { q?: string; action?: string }): Promise<number> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.action) {
      conds.push('action = ?');
      params.push(filters.action);
    }
    if (filters.q) {
      conds.push('transaction_id LIKE ?');
      params.push(`%${filters.q}%`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await ondcQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ondc_txn_logs ${where}`,
      params,
    );
    return rows[0]?.total ?? 0;
  },

  async countAll(): Promise<number> {
    const rows = await ondcQuery<{ total: number }>(`SELECT COUNT(*) AS total FROM ondc_txn_logs`);
    return rows[0]?.total ?? 0;
  },
};
