/**
 * ONDC order persistence — ondc_orders table (post-migration schema).
 *
 * NOTE: Run 001_optimize_ondc_db.sql against ondc_odop_db before using this.
 * Dropped columns: items_json, fulfillments_json, quote_json
 * Use ondc_order_items and ondc_fulfillments tables instead.
 */

import { ondcExec, ondcQuery, withOndcTransaction, type OndcSqlTx } from '~/lib/ondcSql';

export type OndcOrderStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'PACKED'
  | 'AGENT_ASSIGNED'
  | 'ORDER_PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'RETURNED'
  | 'CANCELLED';

export interface OndcOrderRow {
  id: number;
  ondc_order_id: string;
  transaction_id: string;
  message_id: string;
  domain: string;
  city: string | null;
  country: string | null;
  core_version: string | null;
  bap_id: string;
  bap_uri: string;
  bpp_id: string | null;
  provider_id: string;
  seller_id: number;
  store_id: number | null;
  status: OndcOrderStatus;
  status_updated_at: Date | null;
  payment_method: 'COD' | 'PREPAID' | null;
  payment_status: 'NOT_PAID' | 'PAID' | 'FAILED' | 'REFUNDED' | null;
  payment_transaction_ref: string | null;
  payment_json: string | null;
  item_total: string;
  delivery_charges: string;
  packing_charges: string;
  tax_total: string;
  convenience_fee: string;
  discount_total: string;
  order_total: string;
  currency: string;
  item_count: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  billing_json: string | null;
  tracking_number: string | null;
  tracking_link: string | null;
  logistics_provider: string | null;
  cancel_reason_id: string | null;
  return_reason_id: string | null;
  raw_confirm_payload: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OndcOrderItemRow {
  id: number;
  ondc_order_id: string;
  transaction_id: string;
  item_id: string;
  product_id: number;
  variant_id: number | null;
  provider_id: string;
  seller_id: number;
  quantity: number;
  unit_price: string;
  tax_percent: string | null;
  line_amount: string;
  currency: string;
  fulfillment_id: string | null;
  raw_item_json: string | null;
  created_at: Date;
}

export interface OndcFulfillmentRow {
  id: number;
  ondc_order_id: string;
  transaction_id: string;
  fulfillment_id: string;
  fulfillment_type: string;
  fulfillment_role: string;
  state: string;
  contact_phone: string | null;
  contact_email: string | null;
  tracking_url: string | null;
  awb_number: string | null;
  courier_name: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  estimated_delivery: Date | null;
  actual_delivery: Date | null;
  meta_json: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OndcStatusHistoryRow {
  id: number;
  ondc_order_id: string;
  from_status: OndcOrderStatus | null;
  to_status: OndcOrderStatus;
  fulfillment_state: string | null;
  triggered_by: string;
  note: string | null;
  payload_json: string | null;
  created_at: Date;
}

type CreateOrderData = Omit<OndcOrderRow, 'id' | 'created_at' | 'updated_at' | 'status_updated_at'>;
type CreateItemData = Omit<OndcOrderItemRow, 'id' | 'created_at'>;
type CreateFulfData = Omit<OndcFulfillmentRow, 'id' | 'created_at' | 'updated_at'>;

export const orderModel = {
  async create(data: CreateOrderData, tx?: OndcSqlTx): Promise<number> {
    const result = await ondcExec(
      `INSERT INTO ondc_orders
         (ondc_order_id, transaction_id, message_id,
          domain, city, country, core_version,
          bap_id, bap_uri, bpp_id,
          provider_id, seller_id, store_id,
          status, payment_method, payment_status,
          payment_transaction_ref, payment_json,
          item_total, delivery_charges, packing_charges, tax_total,
          convenience_fee, discount_total, order_total, currency, item_count,
          customer_name, customer_phone, customer_email, billing_json,
          cancel_reason_id, return_reason_id, raw_confirm_payload)
       VALUES
         (?,?,?, ?,?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?)`,
      [
        data.ondc_order_id,
        data.transaction_id,
        data.message_id,
        data.domain,
        data.city,
        data.country,
        data.core_version,
        data.bap_id,
        data.bap_uri,
        data.bpp_id,
        data.provider_id,
        data.seller_id,
        data.store_id,
        data.status,
        data.payment_method,
        data.payment_status,
        data.payment_transaction_ref,
        data.payment_json,
        data.item_total,
        data.delivery_charges,
        data.packing_charges,
        data.tax_total,
        data.convenience_fee,
        data.discount_total,
        data.order_total,
        data.currency,
        data.item_count,
        data.customer_name,
        data.customer_phone,
        data.customer_email,
        data.billing_json,
        data.cancel_reason_id,
        data.return_reason_id,
        data.raw_confirm_payload,
      ],
      tx,
    );
    return result.insertId;
  },

  async insertItem(data: CreateItemData, tx?: OndcSqlTx): Promise<void> {
    await ondcExec(
      `INSERT INTO ondc_order_items
         (ondc_order_id, transaction_id, item_id, product_id, variant_id,
          provider_id, seller_id, quantity, unit_price, tax_percent,
          line_amount, currency, fulfillment_id, raw_item_json)
       VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?)`,
      [
        data.ondc_order_id,
        data.transaction_id,
        data.item_id,
        data.product_id,
        data.variant_id,
        data.provider_id,
        data.seller_id,
        data.quantity,
        data.unit_price,
        data.tax_percent,
        data.line_amount,
        data.currency,
        data.fulfillment_id,
        data.raw_item_json,
      ],
      tx,
    );
  },

  async upsertFulfillment(data: CreateFulfData, tx?: OndcSqlTx): Promise<void> {
    await ondcExec(
      `INSERT INTO ondc_fulfillments
         (ondc_order_id, transaction_id, fulfillment_id, fulfillment_type, fulfillment_role,
          state, contact_phone, contact_email, meta_json)
       VALUES (?,?,?,?,?, ?,?,?,?)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state),
         fulfillment_type = VALUES(fulfillment_type),
         contact_phone = VALUES(contact_phone),
         contact_email = VALUES(contact_email),
         meta_json = VALUES(meta_json),
         updated_at = NOW()`,
      [
        data.ondc_order_id,
        data.transaction_id,
        data.fulfillment_id,
        data.fulfillment_type,
        data.fulfillment_role,
        data.state,
        data.contact_phone,
        data.contact_email,
        data.meta_json,
      ],
      tx,
    );
  },

  async findByOndcOrderId(ondcOrderId: string): Promise<OndcOrderRow | null> {
    const rows = await ondcQuery<OndcOrderRow>(
      `SELECT * FROM ondc_orders WHERE ondc_order_id = ? LIMIT 1`,
      [ondcOrderId],
    );
    return rows[0] ?? null;
  },

  async findByTransactionId(txnId: string): Promise<OndcOrderRow | null> {
    const rows = await ondcQuery<OndcOrderRow>(
      `SELECT * FROM ondc_orders WHERE transaction_id = ? LIMIT 1`,
      [txnId],
    );
    return rows[0] ?? null;
  },

  async getItems(ondcOrderId: string): Promise<OndcOrderItemRow[]> {
    return ondcQuery<OndcOrderItemRow>(
      `SELECT oi.*, 
        COALESCE(
          (SELECT image_url 
           FROM variant_images 
           WHERE variant_id = CAST(SUBSTRING_INDEX(oi.item_id, 'var_', -1) AS UNSIGNED) 
           ORDER BY sort_order ASC 
           LIMIT 1),
          (SELECT image_url 
           FROM product_images 
           WHERE product_id = oi.product_id 
              OR product_id = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(oi.item_id, '_', 2), '_', -1) AS UNSIGNED)
           ORDER BY sort_order ASC 
           LIMIT 1)
        ) as db_product_image_url
       FROM ondc_order_items oi 
       WHERE oi.ondc_order_id = ? 
       ORDER BY oi.id ASC`,
      [ondcOrderId],
    );
  },

  async getFulfillments(ondcOrderId: string): Promise<OndcFulfillmentRow[]> {
    return ondcQuery<OndcFulfillmentRow>(
      `SELECT * FROM ondc_fulfillments WHERE ondc_order_id = ? ORDER BY id ASC`,
      [ondcOrderId],
    );
  },

  async updateStatus(
    ondcOrderId: string,
    status: OndcOrderStatus,
    extras?: Partial<
      Pick<
        OndcOrderRow,
        | 'tracking_number'
        | 'tracking_link'
        | 'logistics_provider'
        | 'cancel_reason_id'
        | 'return_reason_id'
        | 'payment_status'
        | 'payment_json'
      >
    >,
    tx?: OndcSqlTx,
  ): Promise<void> {
    const sets: string[] = ['status = ?', 'status_updated_at = NOW()', 'updated_at = NOW()'];
    const params: unknown[] = [status];
    for (const [k, v] of Object.entries(extras ?? {})) {
      if (v !== undefined) {
        sets.push(`${k} = ?`);
        params.push(v);
      }
    }
    params.push(ondcOrderId);
    await ondcExec(`UPDATE ondc_orders SET ${sets.join(', ')} WHERE ondc_order_id = ?`, params, tx);
  },

  async updateFulfillmentState(
    ondcOrderId: string,
    fulfillmentId: string,
    state: string,
    extras?: Partial<
      Pick<
        OndcFulfillmentRow,
        | 'tracking_url'
        | 'awb_number'
        | 'courier_name'
        | 'agent_name'
        | 'agent_phone'
        | 'actual_delivery'
      >
    >,
  ): Promise<void> {
    const sets: string[] = ['state = ?', 'updated_at = NOW()'];
    const params: unknown[] = [state];
    for (const [k, v] of Object.entries(extras ?? {})) {
      if (v !== undefined) {
        sets.push(`${k} = ?`);
        params.push(v);
      }
    }
    params.push(ondcOrderId, fulfillmentId);
    await ondcExec(
      `UPDATE ondc_fulfillments SET ${sets.join(', ')} WHERE ondc_order_id = ? AND fulfillment_id = ?`,
      params,
    );
  },

  async addStatusHistory(
    data: Omit<OndcStatusHistoryRow, 'id' | 'created_at'>,
    tx?: OndcSqlTx,
  ): Promise<void> {
    await ondcExec(
      `INSERT INTO ondc_order_status_history
         (ondc_order_id, from_status, to_status, fulfillment_state, triggered_by, note, payload_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        data.ondc_order_id,
        data.from_status,
        data.to_status,
        data.fulfillment_state,
        data.triggered_by,
        data.note,
        data.payload_json,
      ],
      tx,
    );
  },

  async transitionStatus(
    ondcOrderId: string,
    from: OndcOrderStatus | null,
    to: OndcOrderStatus,
    fulfillmentState: string | null,
    triggeredBy: string,
    note?: string | null,
    payloadJson?: string | null,
    extras?: Partial<
      Pick<
        OndcOrderRow,
        | 'tracking_number'
        | 'tracking_link'
        | 'logistics_provider'
        | 'cancel_reason_id'
        | 'return_reason_id'
        | 'payment_status'
        | 'payment_json'
      >
    >,
  ): Promise<void> {
    await withOndcTransaction(async (tx) => {
      await this.updateStatus(ondcOrderId, to, extras ?? {}, tx);
      await this.addStatusHistory(
        {
          ondc_order_id: ondcOrderId,
          from_status: from,
          to_status: to,
          fulfillment_state: fulfillmentState,
          triggered_by: triggeredBy,
          note: note ?? null,
          payload_json: payloadJson ?? null,
        },
        tx,
      );
    });
  },

  async list(filters: {
    status?: string;
    providerId?: string;
    sellerId?: number;
    limit?: number;
    offset?: number;
  }): Promise<OndcOrderRow[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      conds.push('status = ?');
      params.push(filters.status);
    }
    if (filters.providerId) {
      conds.push('provider_id = ?');
      params.push(filters.providerId);
    }
    if (filters.sellerId) {
      conds.push('seller_id = ?');
      params.push(filters.sellerId);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return ondcQuery<OndcOrderRow>(
      `SELECT * FROM ondc_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 50, filters.offset ?? 0],
    );
  },

  async countAll(
    filters: { status?: string; providerId?: string; sellerId?: number } = {},
  ): Promise<number> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      conds.push('status = ?');
      params.push(filters.status);
    }
    if (filters.providerId) {
      conds.push('provider_id = ?');
      params.push(filters.providerId);
    }
    if (filters.sellerId) {
      conds.push('seller_id = ?');
      params.push(filters.sellerId);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await ondcQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ondc_orders ${where}`,
      params,
    );
    return rows[0]?.total ?? 0;
  },

  async getStatusHistory(ondcOrderId: string): Promise<OndcStatusHistoryRow[]> {
    return ondcQuery<OndcStatusHistoryRow>(
      `SELECT * FROM ondc_order_status_history WHERE ondc_order_id = ? ORDER BY created_at ASC`,
      [ondcOrderId],
    );
  },
};
