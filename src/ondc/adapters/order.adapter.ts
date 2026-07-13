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
import { SELLER_PROFILE } from '~/ondc/config/constants';

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
const nonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const s = String(value ?? '').trim();
    if (s) return s;
  }
  return 'NA';
};

const DEFAULT_ITEM_TAGS = [
  {
    code: 'quote',
    list: [{ code: 'type', value: 'item' }],
  },
];

function itemParentId(itemId: unknown, item: Record<string, any> = {}): string {
  return nonEmpty(item['parent_item_id'], itemId, 'item');
}

function normalizeOrderItem(item: any): Record<string, any> {
  const normalized = { ...(item && typeof item === 'object' ? item : {}) };
  normalized.id = nonEmpty(normalized.id, 'item');
  normalized.parent_item_id = itemParentId(normalized.id, normalized);
  normalized.quantity =
    normalized.quantity && typeof normalized.quantity === 'object'
      ? { count: Number(normalized.quantity.count ?? 1) || 1 }
      : { count: 1 };
  normalized.tags =
    Array.isArray(normalized.tags) && normalized.tags.length ? normalized.tags : DEFAULT_ITEM_TAGS;
  return normalized;
}

function fallbackGpsForCity(city?: unknown): string {
  const normalized = String(city ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'bhopal') return '23.259933,77.412613';
  if (normalized === 'indore') return '22.719568,75.857727';
  if (normalized === 'jabalpur') return '23.181467,79.986407';
  if (normalized === 'gwalior') return '26.218287,78.182831';
  return '23.259933,77.412613';
}

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
  const providerName = nonEmpty(store?.name, SELLER_PROFILE.BRAND_NAME, 'ODOP Provider');

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

    const trackingUrl = live?.tracking_url ?? row.tracking_link ?? null;
    const tracking = !!trackingUrl || !!orig.tracking;
    const endSrc = orig.end ?? {};
    const pickupCity = nonEmpty(
      orig.start?.location?.address?.city,
      startLoc?.city,
      SELLER_PROFILE.CITY,
      'Bhopal',
    );
    const pickupState = nonEmpty(
      orig.start?.location?.address?.state,
      startLoc?.state,
      SELLER_PROFILE.STATE,
      'Madhya Pradesh',
    );
    const pickupAreaCode = nonEmpty(
      orig.start?.location?.address?.area_code,
      startLoc?.pincode,
      SELLER_PROFILE.AREA_CODE,
      '462001',
    );
    const dropAddress = {
      name: nonEmpty(
        endSrc.location?.address?.name,
        billingAddr['name'],
        billing['name'],
        'Customer',
      ),
      building: nonEmpty(endSrc.location?.address?.building, billingAddr['building'], 'NA'),
      locality: nonEmpty(
        endSrc.location?.address?.locality,
        billingAddr['locality'],
        billingAddr['street'],
        'NA',
      ),
      city: nonEmpty(endSrc.location?.address?.city, billingAddr['city'], pickupCity),
      state: nonEmpty(endSrc.location?.address?.state, billingAddr['state'], pickupState),
      country: nonEmpty(endSrc.location?.address?.country, billingAddr['country'], 'IND'),
      area_code: nonEmpty(
        endSrc.location?.address?.area_code,
        billingAddr['area_code'],
        pickupAreaCode,
      ),
    };

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
          name: providerName,
          building: nonEmpty(
            orig.start?.location?.address?.building,
            startLoc?.address_line1,
            'NA',
          ),
          locality: nonEmpty(
            orig.start?.location?.address?.locality,
            startLoc?.address_line2,
            startLoc?.address_line1,
            'NA',
          ),
          city: pickupCity,
          area_code: pickupAreaCode,
          state: pickupState,
          country: nonEmpty(orig.start?.location?.address?.country, startLoc?.country, 'IND'),
        },
      },
      time: { range: { start: createdIso, end: updatedIso }, timestamp: createdIso },
      contact: {
        phone: nonEmpty(store?.phone, SELLER_PROFILE.SUPPORT_PHONE, '9886098860'),
        email: nonEmpty(store?.email, SELLER_PROFILE.SUPPORT_EMAIL, 'support@odopmartmp.com'),
      },
    };

    // Drop (end): from the buyer order / billing.
    const end = {
      location: {
        gps: nonEmpty(endSrc.location?.gps, fallbackGpsForCity(dropAddress.city)),
        address: dropAddress,
      },
      time: endSrc.time ?? { range: { start: createdIso, end: updatedIso }, timestamp: updatedIso },
      person: { name: nonEmpty(endSrc.person?.name, billing['name'], 'Customer') },
      contact: {
        phone: nonEmpty(endSrc.contact?.phone, billing['phone'], row.customer_phone, '9886098860'),
        email: nonEmpty(
          endSrc.contact?.email,
          billing['email'],
          row.customer_email,
          SELLER_PROFILE.SUPPORT_EMAIL,
          'support@odopmartmp.com',
        ),
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
  const fulfillmentTemplate = fulfillments.find(
    (f: any) => f?.type !== 'Cancel' && f?.type !== 'RTO',
  );
  const completeFulfillments = fulfillments.map((f: any) => {
    if (f?.type !== 'Cancel' && f?.type !== 'RTO') return f;
    return {
      ...fulfillmentTemplate,
      ...f,
      '@ondc/org/provider_name': nonEmpty(
        f?.['@ondc/org/provider_name'],
        fulfillmentTemplate?.['@ondc/org/provider_name'],
        providerName,
      ),
      tracking:
        typeof f?.tracking === 'boolean'
          ? f.tracking
          : typeof fulfillmentTemplate?.tracking === 'boolean'
            ? fulfillmentTemplate.tracking
            : false,
      '@ondc/org/TAT': nonEmpty(
        f?.['@ondc/org/TAT'],
        fulfillmentTemplate?.['@ondc/org/TAT'],
        'PT60M',
      ),
      start: f?.start && typeof f.start === 'object' ? f.start : fulfillmentTemplate?.start,
      end: f?.end && typeof f.end === 'object' ? f.end : fulfillmentTemplate?.end,
      tags: Array.isArray(f?.tags) && f.tags.length ? f.tags : (fulfillmentTemplate?.tags ?? []),
    };
  });

  const order: Record<string, any> = {
    ...base,
    provider: {
      id: row.provider_id,
      locations: origOrder.provider?.locations ?? [{ id: String(startLoc?.id ?? 'L1') }],
    },
    fulfillments: completeFulfillments,
    updated_at: isoZero(new Date()),
  };
  order['items'] = Array.isArray(order['items'])
    ? order['items'].map((item: any) => normalizeOrderItem(item))
    : [];

  const itemById = new Map<string, any>(
    (order['items'] as any[]).map((item: any) => [String(item.id), item]),
  );

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
    quote['breakup'] = quote['breakup']
      .map((b: any) => ({
        ...b,
        title: b.title ?? titleByType[String(b['@ondc/org/title_type'] ?? '')] ?? 'Charge',
      }))
      .map((b: any) => {
        const itemId = nonEmpty(
          b['@ondc/org/item_id'],
          b.item?.id,
          (order['items'] as any[])[0]?.id,
        );
        const orderItem = itemById.get(itemId) ?? (order['items'] as any[])[0] ?? {};
        const count =
          Number(b['@ondc/org/item_quantity']?.count ?? orderItem.quantity?.count ?? 1) || 1;
        const price = b.item?.price ??
          b.price ?? { currency: row.currency ?? 'INR', value: '0.00' };
        return {
          ...b,
          '@ondc/org/item_id': itemId,
          '@ondc/org/item_quantity': { count },
          item: {
            ...(b.item && typeof b.item === 'object' ? b.item : {}),
            id: nonEmpty(b.item?.id, itemId),
            parent_item_id: itemParentId(itemId, b.item),
            price: {
              currency: nonEmpty(price.currency, b.price?.currency, row.currency, 'INR'),
              value: nonEmpty(price.value, b.price?.value, '0.00'),
            },
            tags:
              Array.isArray(b.item?.tags) && b.item.tags.length ? b.item.tags : DEFAULT_ITEM_TAGS,
          },
        };
      });
  }

  // payment.params is schema-required; the buyer's confirm often omits it.
  const payment = (order['payment'] ?? {}) as Record<string, any>;
  payment['uri'] = nonEmpty(
    payment['uri'],
    payment['url'],
    `${row.bap_uri}/payment/${row.ondc_order_id}`,
  );
  payment['tl_method'] = nonEmpty(payment['tl_method'], 'http/get');
  if (!payment['params']) {
    payment['params'] = {
      currency: row.currency ?? 'INR',
      transaction_id: row.payment_transaction_ref ?? row.transaction_id,
      amount: row.order_total ?? '0.00',
    };
  }
  payment['params'] = {
    ...(payment['params'] && typeof payment['params'] === 'object' ? payment['params'] : {}),
    currency: nonEmpty(payment['params']?.currency, row.currency, 'INR'),
    transaction_id: nonEmpty(
      payment['params']?.transaction_id,
      row.payment_transaction_ref,
      row.transaction_id,
    ),
    amount: nonEmpty(payment['params']?.amount, row.order_total, '0.00'),
  };
  // Seller settlement details (the buyer's confirm doesn't carry these).
  if (
    !Array.isArray(payment['@ondc/org/settlement_details']) ||
    payment['@ondc/org/settlement_details'].length === 0
  ) {
    payment['@ondc/org/settlement_details'] = [
      {
        settlement_counterparty: 'seller-app',
        settlement_phase: 'sale-amount',
        settlement_type: 'neft',
        beneficiary_name: nonEmpty(
          sellerProfile?.business_name,
          store?.name,
          SELLER_PROFILE.COMPANY_NAME,
          'ODOP Seller',
        ),
        upi_address: nonEmpty(sellerProfile?.upi_id, 'seller@upi'),
        settlement_bank_account_no: nonEmpty(sellerProfile?.bank_account_no, '0000000000'),
        settlement_ifsc_code: nonEmpty(sellerProfile?.bank_ifsc, 'SBIN0000001'),
        bank_name: nonEmpty(sellerProfile?.bank_name, 'State Bank of India'),
        branch_name: nonEmpty(sellerProfile?.branch_name, startLoc?.city, 'Bhopal'),
      },
    ];
  }
  payment['@ondc/org/settlement_details'] = (
    Array.isArray(payment['@ondc/org/settlement_details'])
      ? payment['@ondc/org/settlement_details']
      : []
  ).map((detail: any) => ({
    ...(detail && typeof detail === 'object' ? detail : {}),
    settlement_counterparty: nonEmpty(detail?.settlement_counterparty, 'seller-app'),
    settlement_phase: nonEmpty(detail?.settlement_phase, 'sale-amount'),
    settlement_type: nonEmpty(detail?.settlement_type, 'neft'),
    beneficiary_name: nonEmpty(
      detail?.beneficiary_name,
      sellerProfile?.business_name,
      store?.name,
      SELLER_PROFILE.COMPANY_NAME,
      'ODOP Seller',
    ),
    upi_address: nonEmpty(detail?.upi_address, sellerProfile?.upi_id, 'seller@upi'),
    settlement_bank_account_no: nonEmpty(
      detail?.settlement_bank_account_no,
      sellerProfile?.bank_account_no,
      '0000000000',
    ),
    settlement_ifsc_code: nonEmpty(
      detail?.settlement_ifsc_code,
      sellerProfile?.bank_ifsc,
      'SBIN0000001',
    ),
    bank_name: nonEmpty(detail?.bank_name, sellerProfile?.bank_name, 'State Bank of India'),
    branch_name: nonEmpty(
      detail?.branch_name,
      sellerProfile?.branch_name,
      startLoc?.city,
      'Bhopal',
    ),
    settlement_reference: nonEmpty(
      detail?.settlement_reference,
      row.payment_transaction_ref,
      row.transaction_id,
    ),
    settlement_status: nonEmpty(detail?.settlement_status, 'PAID'),
    settlement_timestamp: nonEmpty(detail?.settlement_timestamp, updatedIso),
  }));
  order['payment'] = payment;

  // documents (invoice) is required on /on_status.
  const invoiceBase = row.bpp_id ? `https://${row.bpp_id}` : 'https://ondc.odopmartmp.com';
  order['documents'] = origOrder.documents ?? [
    { url: `${invoiceBase}/invoice/${row.ondc_order_id}`, label: 'Invoice' },
  ];

  return order;
}
