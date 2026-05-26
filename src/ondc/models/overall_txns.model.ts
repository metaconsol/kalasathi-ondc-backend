/** overall_txns — funnel tracker: one row per transaction_id. */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export interface OverallTxnRow {
  id: number;
  txn_id: string;
  provider_id: string | null;
  on_search: number | null;
  on_select: number | null;
  product_id: string | null;
  product_name: string | null;
  item_count: number | null;
  on_init: number | null;
  on_confirm: number | null;
  order_amount: string | null;
  payment_status: string | null;
  payment_method: string | null;
  on_status: number | null;
  on_track: number | null;
  track_link: string | null;
  order_status: string | null;
  is_archived: number;
  created_at: Date;
  updated_at: Date;
}

export const overallTxnsModel = {
  /** Create or update a row; called once per transaction_id */
  async upsert(txnId: string, providerId?: string | null): Promise<void> {
    await ondcExec(
      `INSERT INTO overall_txns (txn_id, provider_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE provider_id = COALESCE(VALUES(provider_id), provider_id), updated_at = NOW()`,
      [txnId, providerId ?? null],
    );
  },

  /** Patch specific boolean flags / metadata on an existing row */
  async patch(
    txnId: string,
    fields: Partial<Omit<OverallTxnRow, 'id' | 'txn_id' | 'created_at' | 'updated_at'>>,
  ): Promise<void> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    const params = entries.map(([, v]) => v);
    await ondcExec(`UPDATE overall_txns SET ${sets}, updated_at = NOW() WHERE txn_id = ?`, [
      ...params,
      txnId,
    ]);
  },

  async findByTxnId(txnId: string): Promise<OverallTxnRow | null> {
    const rows = await ondcQuery<OverallTxnRow>(
      `SELECT * FROM overall_txns WHERE txn_id = ? LIMIT 1`,
      [txnId],
    );
    return rows[0] ?? null;
  },

  async list(
    filters: { limit?: number; offset?: number; archived?: boolean } = {},
  ): Promise<OverallTxnRow[]> {
    const archived = filters.archived ? 1 : 0;
    return ondcQuery<OverallTxnRow>(
      `SELECT * FROM overall_txns WHERE is_archived = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [archived, filters.limit ?? 50, filters.offset ?? 0],
    );
  },
};
