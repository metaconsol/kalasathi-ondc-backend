import type { OndcBilling, OndcQuote, OndcTagGroup } from './ondc.types';
import type { BecknFulfillment, BecknPayment } from './beckn.types';

export type OndcOrderStatus =
  | 'Created'
  | 'Accepted'
  | 'In-progress'
  | 'Completed'
  | 'Cancelled'
  | 'Returned';

export type OndcFulfillmentState =
  | 'Pending'
  | 'Packed'
  | 'Agent-assigned'
  | 'Order-picked-up'
  | 'Out-for-delivery'
  | 'Order-delivered'
  | 'RTO-Initiated'
  | 'RTO-Delivered'
  | 'RTO-Disposed'
  | 'Cancelled'
  | 'Return_Initiated'
  | 'Return_Approved'
  | 'Return_Picked'
  | 'Return_Delivered'
  | 'Liquidated'
  | 'Return_Rejected';

export interface OndcOrderItem {
  id: string;
  quantity: { count: number };
  fulfillment_id?: string;
  category_id?: string;
  tags?: OndcTagGroup[];
}

export interface OndcOrder {
  id: string;
  state: OndcOrderStatus;
  provider: {
    id: string;
    locations?: Array<{ id: string }>;
    rateable?: boolean;
  };
  items: OndcOrderItem[];
  billing: OndcBilling;
  fulfillments: BecknFulfillment[];
  quote?: OndcQuote;
  payment: BecknPayment;
  created_at?: string;
  updated_at?: string;
  tags?: OndcTagGroup[];
  cancellation?: {
    cancelled_by?: string;
    reasons?: { id: string };
    selected_reason?: { id: string };
    additional_description?: { short_desc?: string; images?: string[] };
  };
}

export interface OndcCancellationReason {
  id: string;
  descriptor: { name: string; code?: string };
}

export interface OndcReturnRequest {
  item_id: string;
  item_quantity: { count: number };
  descriptor: { short_desc?: string; images?: string[] };
  reason: { id: string };
  images?: string[];
}

// DB row shape — mirrors ondc_orders in ondc_odop_db (post-migration schema).
// items_json / fulfillments_json / quote_json removed; use ondc_order_items & ondc_fulfillments instead.
// Re-exported here for consumers that import from types; canonical definition is models/order.model.ts
export type { OndcOrderRow, OndcOrderStatus as DbOrderStatus } from '~/ondc/models/order.model';

export interface OndcOrderStatusHistoryRow {
  id: number;
  ondc_order_id: string;
  from_status: OndcOrderStatus | null;
  to_status: OndcOrderStatus;
  fulfillment_state: OndcFulfillmentState | null;
  triggered_by: string; // 'seller' | 'buyer' | 'system'
  payload_json: string | null;
  created_at: Date;
}
