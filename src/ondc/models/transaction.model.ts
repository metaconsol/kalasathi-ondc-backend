/**
 * ONDC transaction metadata — one row per Beckn transaction_id.
 * Tracks the phase of a transaction (search → select → init → confirm).
 *
 * NOTE: Schema column is `status` (ENUM) — matches PHP reference DB.
 * Raw payloads per phase live in ondc_txn_logs (not duplicated here).
 * Order linkage is reverse-keyed via ondc_orders.transaction_id.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

// Unreachable once its logs are gone — the only reader is the drill-down opened from a log row.
const NO_LOGS = `NOT EXISTS (SELECT 1 FROM ondc_txn_logs l WHERE l.transaction_id = t.transaction_id)`;
// A transaction that produced a real order keeps its row whatever happens to the logs.
const NO_ORDER = `NOT EXISTS (SELECT 1 FROM ondc_orders o WHERE o.transaction_id = t.transaction_id)`;
const PURGEABLE = `${NO_LOGS} AND ${NO_ORDER}`;

export type TxnPhase = 'SEARCH' | 'SELECT' | 'INIT' | 'CONFIRM' | 'COMPLETED' | 'CANCELLED';

export interface OndcTransactionRow {
  id: number;
  transaction_id: string;
  bap_id: string | null;
  bpp_id: string | null;
  domain: string | null;
  city: string | null;
  country: string | null;
  core_version: string | null;
  status: TxnPhase | null;
  created_at: Date;
  updated_at: Date;
}

export interface TxnUpsertInput {
  transaction_id: string;
  bap_id?: string | null;
  bpp_id?: string | null;
  domain?: string | null;
  city?: string | null;
  country?: string | null;
  core_version?: string | null;
  status: TxnPhase;
}

export const transactionModel = {
  async upsert(data: TxnUpsertInput): Promise<void> {
    await ondcExec(
      `INSERT INTO ondc_transactions
         (transaction_id, bap_id, bpp_id, domain, city, country, core_version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bap_id       = COALESCE(VALUES(bap_id), bap_id),
         bpp_id       = COALESCE(VALUES(bpp_id), bpp_id),
         domain       = COALESCE(VALUES(domain), domain),
         city         = COALESCE(VALUES(city), city),
         country      = COALESCE(VALUES(country), country),
         core_version = COALESCE(VALUES(core_version), core_version),
         status       = VALUES(status),
         updated_at   = NOW()`,
      [
        data.transaction_id,
        data.bap_id ?? null,
        data.bpp_id ?? null,
        data.domain ?? null,
        data.city ?? null,
        data.country ?? null,
        data.core_version ?? null,
        data.status,
      ],
    );
  },

  async setStatus(transactionId: string, status: TxnPhase): Promise<void> {
    await ondcExec(
      `UPDATE ondc_transactions SET status = ?, updated_at = NOW() WHERE transaction_id = ?`,
      [status, transactionId],
    );
  },

  async findById(transactionId: string): Promise<OndcTransactionRow | null> {
    const rows = await ondcQuery<OndcTransactionRow>(
      `SELECT * FROM ondc_transactions WHERE transaction_id = ? LIMIT 1`,
      [transactionId],
    );
    return rows[0] ?? null;
  },

  /** Total rows and how many are purgeable, for the Request Monitor cleanup control. */
  async stats(): Promise<{ total: number; purgeable: number }> {
    const rows = await ondcQuery<{ total: number; purgeable: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(${PURGEABLE}), 0) AS purgeable
       FROM ondc_transactions t`,
    );
    return { total: Number(rows[0]?.total ?? 0), purgeable: Number(rows[0]?.purgeable ?? 0) };
  },

  /** Drops rows a log delete left behind. Never touches a transaction that produced an order. */
  async deleteOrphans(transactionIds?: string[]): Promise<number> {
    const scoped = transactionIds?.length
      ? ` AND t.transaction_id IN (${transactionIds.map(() => '?').join(',')})`
      : '';
    const result = await ondcExec(
      `DELETE t FROM ondc_transactions t WHERE ${PURGEABLE}${scoped}`,
      transactionIds?.length ? transactionIds : [],
    );
    return result.affectedRows;
  },
};
