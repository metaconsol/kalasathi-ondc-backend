/**
 * Order Adapter — transforms ONDC /confirm payload into internal order structure
 * and rebuilds OndcOrder from stored rows for callbacks.
 *
 * Key rule: We READ from main DB; we WRITE to ondc DB. If mirroring to main DB
 * is needed, do it via a dedicated service call, not directly here.
 */

import type { OndcOrder, OndcOrderStatus as BecknOrderStatus } from '~/ondc/types/order.types';
import type { OndcOrderRow, OndcOrderStatus as DbOrderStatus } from '~/ondc/models/order.model';
import type { BecknContext } from '~/ondc/types/beckn.types';
import { generateOndcOrderId } from '~/ondc/utils/helpers';
import { safeJsonParse } from '~/ondc/utils/payload.builder';

export interface ConfirmMessage {
  order: OndcOrder;
}

function addStr(a: string, b: string): string {
  return (parseFloat(a || '0') + parseFloat(b || '0')).toFixed(2);
}

function mapDbStatusToBeckn(status: DbOrderStatus): BecknOrderStatus {
  const map: Record<DbOrderStatus, BecknOrderStatus> = {
    CREATED: 'Created',
    CONFIRMED: 'Accepted',
    PACKED: 'In-progress',
    AGENT_ASSIGNED: 'In-progress',
    ORDER_PICKED_UP: 'In-progress',
    OUT_FOR_DELIVERY: 'In-progress',
    DELIVERED: 'Completed',
    RETURNED: 'Returned',
    CANCELLED: 'Cancelled',
  };
  return map[status] ?? 'In-progress';
}

/** Extract a storable OndcOrderRow from an incoming /confirm payload */
export function adaptConfirmToOrderRow(
  context: BecknContext,
  message: ConfirmMessage,
  sellerId: number,
  storeId: number | null = null,
): Omit<OndcOrderRow, 'id' | 'created_at' | 'updated_at' | 'status_updated_at'> {
  const { order } = message;
  const quote = order.quote;
  const payment = order.payment;
  const billing = order.billing;

  let itemTotal = '0',
    deliveryCharges = '0',
    packingCharges = '0',
    taxTotal = '0',
    convenienceFee = '0',
    discountTotal = '0';
  const orderTotal = quote?.price?.value ?? '0';
  const currency = quote?.price?.currency ?? 'INR';

  for (const entry of quote?.breakup ?? []) {
    const val = entry.price?.value ?? '0';
    switch (entry['@ondc/org/title_type']) {
      case 'item':
        itemTotal = addStr(itemTotal, val);
        break;
      case 'delivery':
        deliveryCharges = addStr(deliveryCharges, val);
        break;
      case 'packing':
        packingCharges = addStr(packingCharges, val);
        break;
      case 'tax':
        taxTotal = addStr(taxTotal, val);
        break;
      case 'misc':
        convenienceFee = addStr(convenienceFee, val);
        break;
      case 'discount':
        discountTotal = addStr(discountTotal, val);
        break;
    }
  }

  const paymentMethod: 'COD' | 'PREPAID' | null =
    payment?.type === 'ON-FULFILLMENT'
      ? 'COD'
      : payment?.type === 'PRE-FULFILLMENT'
        ? 'PREPAID'
        : payment?.type === 'ON-ORDER'
          ? 'PREPAID'
          : null;

  const paymentStatus: 'NOT_PAID' | 'PAID' | 'FAILED' | 'REFUNDED' | null =
    payment?.status === 'PAID' ? 'PAID' : 'NOT_PAID';

  return {
    ondc_order_id: order.id || generateOndcOrderId(),
    transaction_id: context.transaction_id,
    message_id: context.message_id,
    bap_id: context.bap_id,
    bap_uri: context.bap_uri,
    bpp_id: context.bpp_id ?? null,
    status: 'CONFIRMED',
    domain: context.domain,
    city: context.city,
    country: context.country,
    core_version: context.core_version,
    provider_id: order.provider.id,
    seller_id: sellerId,
    store_id: storeId,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    payment_transaction_ref: null,
    payment_json: payment ? JSON.stringify(payment) : null,
    item_total: itemTotal,
    delivery_charges: deliveryCharges,
    packing_charges: packingCharges,
    tax_total: taxTotal,
    convenience_fee: convenienceFee,
    discount_total: discountTotal,
    order_total: orderTotal,
    currency,
    item_count: order.items?.length ?? null,
    customer_name: billing?.name ?? null,
    customer_phone: billing?.phone ?? null,
    customer_email: billing?.email ?? null,
    billing_json: billing ? JSON.stringify(billing) : null,
    tracking_number: null,
    tracking_link: null,
    logistics_provider: null,
    cancel_reason_id: null,
    return_reason_id: null,
    raw_confirm_payload: JSON.stringify({ context, message }),
  };
}

/** Build an OndcOrder object from a stored OndcOrderRow (for sending in callbacks) */
export function adaptOrderRowToOndcOrder(row: OndcOrderRow): OndcOrder {
  let items: OndcOrder['items'] = [];
  let fulfillments: OndcOrder['fulfillments'] = [];
  let quote: OndcOrder['quote'] = undefined;
  let payment: OndcOrder['payment'] = {} as OndcOrder['payment'];
  let billing: OndcOrder['billing'] = { name: '', address: {}, phone: '' };

  if (row.raw_confirm_payload) {
    const raw = safeJsonParse<{ message?: { order?: Partial<OndcOrder> } }>(
      row.raw_confirm_payload,
      {},
    );
    const orig = raw?.message?.order ?? {};
    items = orig.items ?? [];
    fulfillments = orig.fulfillments ?? [];
    quote = orig.quote;
    payment = orig.payment ?? payment;
    billing = orig.billing ?? billing;
  }

  if (row.billing_json) {
    billing = safeJsonParse(row.billing_json, billing);
  }
  if (row.payment_json) {
    payment = safeJsonParse(row.payment_json, payment);
  }

  return {
    id: row.ondc_order_id,
    state: mapDbStatusToBeckn(row.status),
    provider: { id: row.provider_id },
    items,
    billing,
    fulfillments,
    ...(quote !== undefined ? { quote } : {}),
    payment,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
