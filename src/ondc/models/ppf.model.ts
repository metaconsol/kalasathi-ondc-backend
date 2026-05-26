/**
 * PPF (Payment Protection Framework) model.
 * Replaces legacy RSF. Uses ONDC:NTS10 domain, v2.0.0.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export type PpfSettlementStatus = 'TO_BE_INITIATED' | 'PENDING' | 'SETTLED' | 'REFUNDED';

export interface PpfSettlementItem {
  id: string;
  payment_id: string;
  status: PpfSettlementStatus;
  amount: { currency: string; value: string };
  commission: { currency: string; value: string };
  withholding_amount: { currency: string; value: string };
  tcs: { currency: string; value: string };
  tds: { currency: string; value: string };
  updated_at: string;
  settlement_ref_no?: string;
}

export interface PpfReconRow {
  id: number;
  ondc_order_id: string;
  transaction_id: string;
  bap_id: string;
  bap_uri: string;
  message_id: string;
  currency: string;
  total_amount: string;
  settlements_json: string;
  recon_accord: number | null;
  on_recon_payload: string | null;
  http_status: number | null;
  status: 'INITIATED' | 'ACKED' | 'ACCORD' | 'DISPUTE' | 'FAILED';
  created_at: Date;
  updated_at: Date;
}

export const ppfModel = {
  async create(data: {
    ondc_order_id: string;
    transaction_id: string;
    bap_id: string;
    bap_uri: string;
    message_id: string;
    currency: string;
    total_amount: string;
    settlements_json: string;
    http_status: number | null;
    status: PpfReconRow['status'];
  }): Promise<number> {
    const result = await ondcExec(
      `INSERT INTO ondc_ppf_recon
         (ondc_order_id, transaction_id, bap_id, bap_uri, message_id,
          currency, total_amount, settlements_json, http_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.ondc_order_id,
        data.transaction_id,
        data.bap_id,
        data.bap_uri,
        data.message_id,
        data.currency,
        data.total_amount,
        data.settlements_json,
        data.http_status,
        data.status,
      ],
    );
    return result.insertId;
  },

  async updateOnRecon(
    ondcOrderId: string,
    recon_accord: boolean,
    on_recon_payload: string,
  ): Promise<void> {
    await ondcExec(
      `UPDATE ondc_ppf_recon
       SET recon_accord = ?, on_recon_payload = ?,
           status = ?, updated_at = NOW()
       WHERE ondc_order_id = ?
       ORDER BY id DESC LIMIT 1`,
      [recon_accord ? 1 : 0, on_recon_payload, recon_accord ? 'ACCORD' : 'DISPUTE', ondcOrderId],
    );
  },

  async list(
    filters: { status?: string; sellerId?: number; limit?: number; offset?: number } = {},
  ): Promise<PpfReconRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      conditions.push('r.status = ?');
      params.push(filters.status);
    }
    if (filters.sellerId) {
      conditions.push(
        'EXISTS (SELECT 1 FROM ondc_orders o WHERE o.ondc_order_id = r.ondc_order_id AND o.seller_id = ?)',
      );
      params.push(filters.sellerId);
    }
    const alias = filters.sellerId ? 'ondc_ppf_recon r' : 'ondc_ppf_recon';
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return ondcQuery<PpfReconRow>(
      `SELECT ${filters.sellerId ? 'r.*' : '*'} FROM ${alias} ${where} ORDER BY ${filters.sellerId ? 'r.' : ''}created_at DESC LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 50, filters.offset ?? 0],
    );
  },

  async findByOrderId(ondcOrderId: string): Promise<PpfReconRow[]> {
    return ondcQuery<PpfReconRow>(
      `SELECT * FROM ondc_ppf_recon WHERE ondc_order_id = ? ORDER BY id DESC`,
      [ondcOrderId],
    );
  },
};
