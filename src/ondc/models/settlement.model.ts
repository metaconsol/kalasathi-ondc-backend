/**
 * RSF (Reconciliation & Settlement Framework) model.
 * TODO: Implement based on ondc_rsf.sql and ondc_settlements.sql from PHP project.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export type SettlementStatus = 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED';

export interface OndcSettlementRow {
  id: number;
  settlement_id: string;
  ondc_order_id: string;
  transaction_id: string;
  total_amount: string;
  settlement_amount: string;
  buyer_finder_fee: string;
  withholding_amount: string;
  status: SettlementStatus;
  settlement_reference: string | null;
  settlement_timestamp: Date | null;
  counterparty: string | null;
  utr: string | null;
  raw_json: string;
  created_at: Date;
  updated_at: Date;
}

export const settlementModel = {
  async create(data: Omit<OndcSettlementRow, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const result = await ondcExec(
      `INSERT INTO ondc_settlements
        (settlement_id, ondc_order_id, transaction_id, total_amount,
         settlement_amount, buyer_finder_fee, withholding_amount,
         status, settlement_reference, settlement_timestamp, counterparty, utr, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.settlement_id,
        data.ondc_order_id,
        data.transaction_id,
        data.total_amount,
        data.settlement_amount,
        data.buyer_finder_fee,
        data.withholding_amount,
        data.status,
        data.settlement_reference,
        data.settlement_timestamp,
        data.counterparty,
        data.utr,
        data.raw_json,
      ],
    );
    return result.insertId;
  },

  async findByOrderId(ondcOrderId: string): Promise<OndcSettlementRow[]> {
    return ondcQuery<OndcSettlementRow>(
      `SELECT * FROM ondc_settlements WHERE ondc_order_id = ? ORDER BY created_at DESC`,
      [ondcOrderId],
    );
  },

  async updateStatus(settlementId: string, status: SettlementStatus, utr?: string): Promise<void> {
    const sets = ['status = ?', 'updated_at = NOW()'];
    const params: unknown[] = [status];
    if (utr) {
      sets.push('utr = ?');
      params.push(utr);
    }
    if (status === 'SETTLED') {
      sets.push('settlement_timestamp = NOW()');
    }
    params.push(settlementId);
    await ondcExec(
      `UPDATE ondc_settlements SET ${sets.join(', ')} WHERE settlement_id = ?`,
      params,
    );
  },

  async listPending(limit = 50): Promise<OndcSettlementRow[]> {
    return ondcQuery<OndcSettlementRow>(
      `SELECT * FROM ondc_settlements WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );
  },

  async list(
    filters: { status?: SettlementStatus; limit?: number; offset?: number } = {},
  ): Promise<OndcSettlementRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return ondcQuery<OndcSettlementRow>(
      `SELECT * FROM ondc_settlements ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 50, filters.offset ?? 0],
    );
  },
};
