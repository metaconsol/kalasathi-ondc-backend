/**
 * Order Adapter — transforms ONDC /confirm payload into internal order structure
 * and rebuilds OndcOrder from stored rows for callbacks.
 *
 * Key rule: We READ from main DB; we WRITE to ondc DB. If mirroring to main DB
 * is needed, do it via a dedicated service call, not directly here.
 */

import type { OndcOrder, OndcOrderStatus as BecknOrderStatus } from '~/ondc/types/order.types';
import type {
  OndcOrderRow,
  OndcFulfillmentRow,
  OndcOrderStatus as DbOrderStatus,
} from '~/ondc/models/order.model';
import type { BecknContext } from '~/ondc/types/beckn.types';
import { generateOndcOrderId } from '~/ondc/utils/helpers';
import { safeJsonParse } from '~/ondc/utils/payload.builder';
import {
  fetchStoreById,
  fetchStoreLocations,
  fetchSellerProfileByStoreId,
} from '~/ondc/adapters/seller.adapter';

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
    RETURNED: 'Completed', // ONDC Flow 4A expects Order State 'Completed' during return lifecycle
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
): Omit<
  OndcOrderRow,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'status_updated_at'
  // Delhivery columns are only written by the logistics flow, never at confirm.
  | 'delhivery_upload_wbn'
  | 'delhivery_pickup_id'
  | 'delhivery_shipment_status'
  | 'delhivery_last_scan_at'
  | 'delhivery_last_response'
> {
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

const isoZero = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, '.000Z');

/**
 * Build a COMPLETE ONDC /on_status order from the stored order + LIVE fulfillment
 * rows. Inherits items/billing/payment/quote from the confirm-time order (so values
 * never drift from on_confirm) and builds a contract-complete Delivery fulfillment:
 *   - pickup `start` (location/contact) is built DYNAMICALLY from the store + its
 *     location (the buyer's confirm only carries `end`/the drop address);
 *   - `end` (drop) comes from the buyer order / billing, with `person`;
 *   - start.time / end.time carry a `range` (required by the on_status schema);
 *   - `agent`, `tags` (routing P2P + tracking), `@ondc/org/provider_name`,
 *     `@ondc/org/TAT`, live `state` (+updated_at) and `tracking` are filled in;
 *   - the invoice `documents` block is added once delivered.
 * order.state is mapped to the ONDC enum (never the internal "CONFIRMED").
 */
export async function buildOnStatusOrder(
  row: OndcOrderRow,
  liveFulfillments: OndcFulfillmentRow[],
): Promise<Record<string, unknown>> {
  const base = adaptOrderRowToOndcOrder(row) as unknown as Record<string, any>;

  const raw = row.raw_confirm_payload
    ? safeJsonParse<{ message?: { order?: any } }>(row.raw_confirm_payload, {})
    : {};
  const origOrder = raw?.message?.order ?? {};
  const origFulfById = new Map<string, any>(
    (origOrder.fulfillments ?? []).map((f: any) => [String(f.id), f]),
  );
  const liveById = new Map(liveFulfillments.map((f) => [f.fulfillment_id, f]));

  // provider_id == String(stores.id), so the store id is directly derivable.
  const storeId = row.store_id ?? (Number.parseInt(row.provider_id, 10) || null);
  const [store, storeLocations, sellerProfile] = await Promise.all([
    storeId ? fetchStoreById(storeId) : Promise.resolve(null),
    storeId ? fetchStoreLocations(storeId) : Promise.resolve([]),
    storeId ? fetchSellerProfileByStoreId(storeId) : Promise.resolve(null),
  ]);
  // Prefer a location row that actually has coordinates — a store can have
  // multiple rows (e.g. RETURN without gps) and [0] may lack lat/lng, which
  // used to make on_status advertise a wrong default gps.
  const startLoc =
    storeLocations.find((l) => l.latitude != null && l.longitude != null) ?? storeLocations[0];
  const providerName = store?.name ?? 'ODOP Provider';

  // ONDC /on_status requires fulfillment start.time and end.time, each with a
  // `range` ({start,end} rfc3339). Synthesize a window from the order timestamps.
  const createdIso = isoZero(row.created_at ?? new Date());
  const updatedIso = isoZero(row.updated_at ?? new Date());

  const billing = (base['billing'] ?? {}) as Record<string, any>;
  const billingAddr = (billing['address'] ?? {}) as Record<string, any>;

  const sourceFulfs: any[] =
    Array.isArray(base['fulfillments']) && base['fulfillments'].length
      ? (base['fulfillments'] as any[])
      : liveFulfillments.map((f) => ({ id: f.fulfillment_id, type: f.fulfillment_type }));

  const fulfillments = sourceFulfs.map((f: any) => {
    const live = liveById.get(String(f.id));
    const orig = origFulfById.get(String(f.id)) ?? {};
    const code = live?.state ?? f?.state?.descriptor?.code ?? 'Pending';
    const updatedAt = isoZero(live?.updated_at ?? row.updated_at ?? new Date());
    const type = String(f.type ?? orig.type ?? live?.fulfillment_type ?? 'Delivery');

    // Non-delivery fulfillments (Cancel / RTO) keep their own structure.
    if (type === 'Cancel' || type === 'RTO') {
      return {
        ...orig,
        ...f,
        id: f.id,
        type,
        state: { descriptor: { code }, updated_at: updatedAt },
      };
    }

    const trackingUrl = live?.tracking_url ?? null;
    const tracking = !!trackingUrl || !!orig.tracking;

    // Pickup (start): built dynamically from the store location.
    const start = {
      location: {
        id: String(startLoc?.id ?? orig.start?.location?.id ?? 'L1'),
        descriptor: { name: providerName },
        gps:
          orig.start?.location?.gps ??
          (startLoc?.latitude != null && startLoc?.longitude != null
            ? `${startLoc.latitude},${startLoc.longitude}`
            : // Bhopal HQ — must match the catalog's provider-location fallback,
              // never a foreign city (was Bengaluru ⇒ on_search/on_status mismatch).
              '23.259933,77.412613'),
        address: {
          locality:
            orig.start?.location?.address?.locality ??
            startLoc?.address_line2 ??
            startLoc?.address_line1 ??
            'NA',
          city: orig.start?.location?.address?.city ?? startLoc?.city ?? 'Bhopal',
          area_code: orig.start?.location?.address?.area_code ?? startLoc?.pincode ?? '462001',
          state: orig.start?.location?.address?.state ?? startLoc?.state ?? 'Madhya Pradesh',
        },
      },
      time: { range: { start: createdIso, end: updatedIso }, timestamp: createdIso },
      contact: {
        phone: String(store?.phone ?? '9886098860'),
        email: String(store?.email ?? 'support@odopmartmp.com'),
      },
    };

    // Drop (end): from the buyer order / billing.
    const endSrc = orig.end ?? {};
    const end = {
      location: {
        gps: endSrc.location?.gps ?? '12.9716,77.5946',
        address: endSrc.location?.address ?? billingAddr,
      },
      time: endSrc.time ?? { range: { start: createdIso, end: updatedIso }, timestamp: updatedIso },
      person: { name: String(endSrc.person?.name ?? billing['name'] ?? 'Customer') },
      contact: {
        phone: String(endSrc.contact?.phone ?? billing['phone'] ?? '9886098860'),
        ...(endSrc.contact?.email || billing['email']
          ? { email: String(endSrc.contact?.email ?? billing['email']) }
          : {}),
      },
    };

    const merged: Record<string, any> = {
      id: f.id,
      '@ondc/org/provider_name': providerName,
      type,
      '@ondc/org/TAT': orig['@ondc/org/TAT'] ?? 'PT60M',
      tracking,
      state: { descriptor: { code }, updated_at: updatedAt },
      start,
      end,
      tags: [
        { code: 'routing', list: [{ code: 'type', value: 'P2P' }] },
        {
          code: 'tracking',
          list: [
            { code: 'gps_enabled', value: tracking ? 'yes' : 'no' },
            { code: 'url_enabled', value: trackingUrl ? 'yes' : 'no' },
            ...(trackingUrl ? [{ code: 'url', value: trackingUrl }] : []),
          ],
        },
      ],
    };

    const agent = live?.agent_name
      ? { name: live.agent_name, ...(live.agent_phone ? { phone: live.agent_phone } : {}) }
      : orig.agent;
    if (agent) merged['agent'] = agent;

    return merged;
  });

  const order: Record<string, any> = {
    ...base,
    provider: {
      id: row.provider_id,
      locations: origOrder.provider?.locations ?? [{ id: String(startLoc?.id ?? 'L1') }],
    },
    fulfillments,
    updated_at: isoZero(new Date()),
  };

  // quote.breakup entries must each carry a `title` (schema-required).
  const titleByType: Record<string, string> = {
    item: 'Item',
    delivery: 'Delivery charges',
    tax: 'Tax',
    packing: 'Packing charges',
    discount: 'Discount',
    misc: 'Convenience Fee',
    refund: 'Refund',
  };
  const quote = order['quote'] as Record<string, any> | undefined;
  if (quote && Array.isArray(quote['breakup'])) {
    quote['breakup'] = quote['breakup'].map((b: any) => ({
      ...b,
      title: b.title ?? titleByType[String(b['@ondc/org/title_type'] ?? '')] ?? 'Charge',
    }));
  }

  // payment.params is schema-required; the buyer's confirm often omits it.
  // Never invent a payment uri — keep uri/tl_method only when a real one exists.
  const payment = (order['payment'] ?? {}) as Record<string, any>;
  if (payment['uri']) {
    payment['tl_method'] = payment['tl_method'] ?? 'http/get';
  } else {
    delete payment['uri'];
    delete payment['tl_method'];
  }
  if (!payment['params']) {
    payment['params'] = {
      currency: row.currency ?? 'INR',
      transaction_id: row.payment_transaction_ref ?? row.transaction_id,
      amount: row.order_total ?? '0.00',
    };
  }
  // Seller settlement details (the buyer's confirm doesn't carry these).
  if (!payment['@ondc/org/settlement_details']) {
    payment['@ondc/org/settlement_details'] = [
      {
        settlement_counterparty: 'seller-app',
        settlement_phase: 'sale-amount',
        settlement_type: 'neft',
        beneficiary_name: String(sellerProfile?.business_name ?? store?.name ?? ''),
        upi_address: String(sellerProfile?.upi_id ?? ''),
        settlement_bank_account_no: String(sellerProfile?.bank_account_no ?? ''),
        settlement_ifsc_code: String(sellerProfile?.bank_ifsc ?? ''),
        bank_name: String(sellerProfile?.bank_name ?? ''),
        branch_name: String(sellerProfile?.branch_name ?? ''),
      },
    ];
  }
  order['payment'] = payment;

  // documents (invoice) is required on /on_status.
  const invoiceBase = row.bpp_id ? `https://${row.bpp_id}` : '';
  order['documents'] = origOrder.documents ?? [
    { url: `${invoiceBase}/invoice/${row.ondc_order_id}`, label: 'Invoice' },
  ];

  return order;
}
