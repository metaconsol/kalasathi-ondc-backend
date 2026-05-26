/**
 * ONDC transaction metadata — one row per Beckn transaction_id.
 * Tracks the phase of a transaction (search → select → init → confirm).
 *
 * NOTE: Schema column is `status` (ENUM) — matches PHP reference DB.
 * Raw payloads per phase live in ondc_txn_logs (not duplicated here).
 * Order linkage is reverse-keyed via ondc_orders.transaction_id.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

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
};
