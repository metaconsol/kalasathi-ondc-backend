import { ondcEnv } from '~/config/ondc.config';
import { resolveOndcCatalogRow } from '~/ondc/adapters/product.adapter';
import {
  fetchSellerProfileByStoreId,
  fetchStoreById,
  fetchStoreLocations,
} from '~/ondc/adapters/seller.adapter';
import type { OndcFulfillmentRow, OndcOrderItemRow, OndcOrderRow } from '~/ondc/models/order.model';
import { ondcQuery } from '~/lib/ondcSql';
import { buildQuote, type QuoteLineInput } from '~/ondc/utils/catalog.builders';
import { nowIso, safeJsonParse } from '~/ondc/utils/payload.builder';
import type { OndcOrderStatus as DbOrderStatus } from '~/ondc/models/order.model';

type LooseObject = Record<string, any>;

interface FallbackCatalogRow {
  store_id: number;
  name: string;
  price: number;
  stock: number;
  gst_percent: number;
  time_to_ship_value: number | null;
  time_to_ship_unit: string | null;
}

async function resolveFallbackCatalogRow(
  itemId: string,
  providerId?: string,
): Promise<FallbackCatalogRow | null> {
  const rows = await ondcQuery<any>(
    `SELECT
       p.store_id,
       p.product_name AS name,
       COALESCE(p.default_price, p.mrp, 0) AS price,
       COALESCE(p.stock, 0) AS stock,
       COALESCE(p.gst_percent, 0) AS gst_percent,
       p.time_to_ship_value,
       p.time_to_ship_unit
     FROM ondc_catalog_items oci
     INNER JOIN products p ON p.id = oci.main_db_product_id
     WHERE oci.ondc_item_id = ?
       AND oci.sync_status = 'synced'
       AND (? = '' OR oci.provider_id = ?)
     ORDER BY oci.updated_at DESC
     LIMIT 1`,
    [itemId, providerId ?? '', providerId ?? ''],
  );

  if (!rows[0]) return null;
  return {
    store_id: Number(rows[0].store_id),
    name: String(rows[0].name ?? ''),
    price: Number(rows[0].price ?? 0),
    stock: Number(rows[0].stock ?? 0),
    gst_percent: Number(rows[0].gst_percent ?? 0),
    time_to_ship_value:
      rows[0].time_to_ship_value != null ? Number(rows[0].time_to_ship_value) : null,
    time_to_ship_unit: rows[0].time_to_ship_unit ?? null,
  };
}

function normalizeAddress(address: LooseObject = {}, includeEmpty = true): LooseObject {
  const normalized = {
    name: String(address?.name ?? address?.door ?? ''),
    building: String(address?.building ?? ''),
    locality: String(address?.locality ?? address?.street ?? ''),
    city: String(address?.city ?? ''),
    state: String(address?.state ?? ''),
    country: String(address?.country ?? ''),
    area_code: String(address?.area_code ?? ''),
  };

  if (includeEmpty) return normalized;
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ''));
}

function normalizeBilling(billing: LooseObject = {}, includeEmpty = true): LooseObject {
  const normalized = {
    name: String(billing?.name ?? ''),
    address: normalizeAddress(billing?.address ?? {}, includeEmpty),
    email: String(billing?.email ?? ''),
    phone: String(billing?.phone ?? ''),
    created_at: String(billing?.created_at ?? ''),
    updated_at: String(billing?.updated_at ?? ''),
  };

  if (includeEmpty) return normalized;

  return {
    ...Object.fromEntries(
      Object.entries(normalized).filter(([key, value]) => key === 'address' || value !== ''),
    ),
    address: normalized.address,
  };
}

function buildTimeToShip(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (!value || !unit) return 'P1D';
  switch (String(unit).toUpperCase()) {
    case 'MINUTES':
      return `PT${value}M`;
    case 'HOURS':
      return `PT${value}H`;
    case 'DAYS':
      return `P${value}D`;
    default:
      return 'P1D';
  }
}

function sanitizeQuoteBreakup(breakup: any[]): any[] {
  return breakup.map((entry: any) => {
    const item = entry?.item;
    if (!item || typeof item !== 'object') return entry;

    const sanitizedItem = { ...item };
    delete sanitizedItem.quantity;
    return { ...entry, item: sanitizedItem };
  });
}

function maybeString(value: unknown): string {
  return value == null ? '' : String(value);
}

function normalizeDocument(document: LooseObject): LooseObject {
  return {
    url: maybeString(document?.url),
    label: maybeString(document?.label),
  };
}

function buildTrackingTags(rawTags: unknown, trackingUrl: string, hasGps: boolean): LooseObject[] {
  if (Array.isArray(rawTags) && rawTags.length > 0) return rawTags as LooseObject[];

  return [
    {
      code: 'routing',
      list: [{ code: 'type', value: 'P2P' }],
    },
    {
      code: 'tracking',
      list: [
        { code: 'gps_enabled', value: hasGps ? 'yes' : 'no' },
        { code: 'url_enabled', value: trackingUrl ? 'yes' : 'no' },
        { code: 'url', value: trackingUrl },
      ],
    },
  ];
}

function paymentStatusFromDb(status: OndcOrderRow['payment_status']): string {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'FAILED':
      return 'FAILED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'NOT_PAID':
    default:
      return 'NOT-PAID';
  }
}

function mapDbStatusToOnStatusState(status: DbOrderStatus): string {
  const map: Record<DbOrderStatus, string> = {
    CREATED: 'Created',
    CONFIRMED: 'Accepted',
    PACKED: 'In-progress',
    AGENT_ASSIGNED: 'In-progress',
    ORDER_PICKED_UP: 'In-progress',
    OUT_FOR_DELIVERY: 'In-progress',
    DELIVERED: 'Completed',
    RETURNED: 'Cancelled',
    CANCELLED: 'Cancelled',
  };
  return map[status] ?? 'In-progress';
}

function mapDbStatusToFulfillmentCode(status: DbOrderStatus): string {
  const map: Record<DbOrderStatus, string> = {
    CREATED: 'Pending',
    CONFIRMED: 'Pending',
    PACKED: 'Packed',
    AGENT_ASSIGNED: 'Agent-assigned',
    ORDER_PICKED_UP: 'Order-picked-up',
    OUT_FOR_DELIVERY: 'Out-for-delivery',
    DELIVERED: 'Order-delivered',
    RETURNED: 'Return_Delivered',
    CANCELLED: 'Cancelled',
  };
  return map[status] ?? 'Pending';
}

export async function buildDbBackedOnStatusOrder(
  order: OndcOrderRow,
  items: OndcOrderItemRow[],
  fulfillments: OndcFulfillmentRow[],
  fulfillmentStateOverride?: string | null,
): Promise<Record<string, unknown>> {
  const normalizedOrderState = mapDbStatusToOnStatusState(order.status);
  const normalizedFulfillmentCode =
    fulfillmentStateOverride ?? mapDbStatusToFulfillmentCode(order.status);
  const rawConfirm = safeJsonParse<{ message?: { order?: LooseObject } }>(
    order.raw_confirm_payload,
    {},
  );
  const rawOrder = rawConfirm?.message?.order ?? {};
  const rawPayment = safeJsonParse<LooseObject>(order.payment_json, rawOrder.payment ?? {});
  const rawBilling = safeJsonParse<LooseObject>(order.billing_json, rawOrder.billing ?? {});
  const rawQuote = rawOrder.quote && typeof rawOrder.quote === 'object' ? rawOrder.quote : {};
  const rawFulfillments = Array.isArray(rawOrder.fulfillments) ? rawOrder.fulfillments : [];

  let resolvedStoreId =
    order.store_id ?? (Number.parseInt(String(order.provider_id ?? ''), 10) || null);

  const quoteLines: QuoteLineInput[] = [];
  const itemCatalogRows = await Promise.all(
    items.map(async (item) => {
      const catalogRow =
        (await resolveOndcCatalogRow(String(item.item_id))) ??
        (await resolveFallbackCatalogRow(String(item.item_id), String(order.provider_id ?? '')));
      return { item, catalogRow };
    }),
  );

  let fallbackFulfillmentId = String(
    items[0]?.fulfillment_id ?? fulfillments[0]?.fulfillment_id ?? 'F1',
  );
  let firstTat = 'P1D';

  for (const { item, catalogRow } of itemCatalogRows) {
    if (!catalogRow) continue;
    if (resolvedStoreId !== null && catalogRow.store_id !== resolvedStoreId) continue;
    resolvedStoreId = catalogRow.store_id;
    firstTat = buildTimeToShip(catalogRow.time_to_ship_value, catalogRow.time_to_ship_unit);
    quoteLines.push({
      itemId: String(item.item_id),
      itemName: catalogRow.name,
      unitPrice: Number(item.unit_price ?? catalogRow.price ?? 0),
      quantity: Number(item.quantity ?? 0),
      stockAvailable: catalogRow.stock > 0 ? 99 : 0,
      stockMaximum: catalogRow.stock > 0 ? 99 : 0,
      taxPercent: Number(item.tax_percent ?? catalogRow.gst_percent ?? 0),
    });
    if (item.fulfillment_id) fallbackFulfillmentId = String(item.fulfillment_id);
  }

  const computedQuote = buildQuote(
    quoteLines,
    fallbackFulfillmentId,
    Number(order.delivery_charges ?? 0),
    Number(order.packing_charges ?? 0),
    Number(order.convenience_fee ?? 0),
    {
      includeZeroBreakups: true,
      fulfillmentTax: Number(order.tax_total ?? 0),
    },
  );

  const quoteBreakup = (() => {
    if (!Array.isArray(rawQuote.breakup) || rawQuote.breakup.length === 0) {
      return sanitizeQuoteBreakup((computedQuote.breakup as any[]) ?? []);
    }

    const mergedBreakup = [...rawQuote.breakup];
    const seenKeys = new Set(
      rawQuote.breakup.map((entry: any) =>
        [
          String(entry?.['@ondc/org/item_id'] ?? ''),
          String(entry?.['@ondc/org/title_type'] ?? ''),
          String(entry?.title ?? ''),
        ].join('|'),
      ),
    );

    for (const entry of computedQuote.breakup as any[]) {
      const key = [
        String(entry?.['@ondc/org/item_id'] ?? ''),
        String(entry?.['@ondc/org/title_type'] ?? ''),
        String(entry?.title ?? ''),
      ].join('|');
      if (seenKeys.has(key)) continue;
      mergedBreakup.push(entry);
      seenKeys.add(key);
    }

    return sanitizeQuoteBreakup(mergedBreakup);
  })();

  const [store, storeLocations, sellerProfile] = await Promise.all([
    resolvedStoreId ? fetchStoreById(resolvedStoreId) : Promise.resolve(null),
    resolvedStoreId ? fetchStoreLocations(resolvedStoreId) : Promise.resolve([]),
    resolvedStoreId ? fetchSellerProfileByStoreId(resolvedStoreId) : Promise.resolve(null),
  ]);
  const providerName = maybeString(store?.name);
  const providerLocationIds = storeLocations.map((location) => ({
    id: maybeString(location.id),
  }));
  const startLocation = storeLocations[0] ?? null;
  const startGps =
    startLocation?.latitude != null && startLocation?.longitude != null
      ? `${startLocation.latitude},${startLocation.longitude}`
      : '';

  const normalizedItems = items.map((item) => ({
    id: String(item.item_id),
    fulfillment_id: String(item.fulfillment_id ?? fallbackFulfillmentId),
    quantity: {
      count: Number(item.quantity ?? 0),
    },
  }));

  const normalizedFulfillments = (
    fulfillments.length
      ? fulfillments
      : [
          {
            fulfillment_id: fallbackFulfillmentId,
            fulfillment_type: 'Delivery',
            state: fulfillmentStateOverride ?? 'Pending',
            tracking_url: null,
            meta_json: null,
            updated_at: order.updated_at,
            agent_name: null,
            agent_phone: null,
          } as Partial<OndcFulfillmentRow>,
        ]
  ).map((fulfillment) => {
    const rawMatch =
      safeJsonParse<LooseObject>(
        fulfillment.meta_json ?? null,
        rawFulfillments.find(
          (entry: LooseObject) =>
            String(entry?.id ?? '') === String(fulfillment.fulfillment_id ?? ''),
        ) ?? {},
      ) ?? {};
    const rawStart = rawMatch?.start ?? {};
    const rawEnd = rawMatch?.end ?? {};
    const rawAgent = rawMatch?.agent ?? {};
    const trackingUrl = maybeString(fulfillment.tracking_url ?? rawMatch?.tracking_url ?? '');
    const endGps = maybeString(rawEnd?.location?.gps);
    const hasGps = Boolean(startGps || endGps);
    const startTimestamp = maybeString(
      rawStart?.time?.timestamp ??
        (order.created_at instanceof Date ? order.created_at.toISOString() : nowIso()),
    );
    const endTimestamp = maybeString(
      rawEnd?.time?.timestamp ??
        (order.updated_at instanceof Date ? order.updated_at.toISOString() : nowIso()),
    );

    return {
      id: String(fulfillment.fulfillment_id ?? fallbackFulfillmentId),
      '@ondc/org/provider_name': maybeString(rawMatch?.['@ondc/org/provider_name'] ?? providerName),
      type: String(fulfillment.fulfillment_type ?? rawMatch.type ?? 'Delivery'),
      '@ondc/org/TAT': maybeString(rawMatch?.['@ondc/org/TAT'] ?? firstTat),
      tracking: Boolean(fulfillment.tracking_url),
      state: {
        descriptor: {
          code: normalizedFulfillmentCode,
        },
      },
      start: {
        location: {
          descriptor: {
            name: maybeString(rawStart?.location?.descriptor?.name ?? providerName),
          },
          gps: maybeString(rawStart?.location?.gps ?? startGps),
          address: {
            locality: maybeString(
              rawStart?.location?.address?.locality ??
                startLocation?.address_line2 ??
                startLocation?.address_line1,
            ),
            city: maybeString(rawStart?.location?.address?.city ?? startLocation?.city),
            area_code: maybeString(
              rawStart?.location?.address?.area_code ?? startLocation?.pincode,
            ),
            state: maybeString(rawStart?.location?.address?.state ?? startLocation?.state),
          },
        },
        time: {
          timestamp: startTimestamp,
        },
        contact: {
          phone: maybeString(rawStart?.contact?.phone ?? store?.phone),
          email: maybeString(rawStart?.contact?.email ?? store?.email),
        },
      },
      end: {
        location: {
          gps: endGps,
          address: normalizeAddress(rawEnd?.location?.address ?? rawBilling?.address ?? {}, true),
        },
        time: {
          timestamp: endTimestamp,
        },
        person: {
          name: maybeString(rawEnd?.person?.name ?? rawBilling?.name ?? order.customer_name),
        },
        contact: {
          phone: maybeString(rawEnd?.contact?.phone ?? rawBilling?.phone ?? order.customer_phone),
        },
      },
      agent: {
        name: maybeString(fulfillment.agent_name ?? rawAgent?.name),
        phone: maybeString(fulfillment.agent_phone ?? rawAgent?.phone),
      },
      tags: buildTrackingTags(rawMatch?.tags, trackingUrl, hasGps),
    };
  });

  const paymentSettlementDetails = Array.isArray(rawPayment['@ondc/org/settlement_details'])
    ? rawPayment['@ondc/org/settlement_details']
    : [];
  const normalizedSettlementDetails =
    paymentSettlementDetails.length > 0
      ? paymentSettlementDetails.map((detail: LooseObject) => ({
          settlement_counterparty: maybeString(detail?.settlement_counterparty),
          settlement_phase: maybeString(detail?.settlement_phase),
          beneficiary_name: maybeString(detail?.beneficiary_name),
          settlement_reference: maybeString(detail?.settlement_reference),
          settlement_status: maybeString(detail?.settlement_status),
          settlement_timestamp: maybeString(detail?.settlement_timestamp),
          settlement_type: maybeString(detail?.settlement_type),
          upi_address: maybeString(detail?.upi_address),
          settlement_bank_account_no: maybeString(detail?.settlement_bank_account_no),
          settlement_ifsc_code: maybeString(detail?.settlement_ifsc_code),
          bank_name: maybeString(detail?.bank_name),
          branch_name: maybeString(detail?.branch_name),
        }))
      : [
          {
            settlement_counterparty: 'seller-app',
            settlement_phase: 'sale-amount',
            beneficiary_name: String(sellerProfile?.business_name ?? store?.name ?? ''),
            settlement_reference: '',
            settlement_status: '',
            settlement_timestamp: '',
            settlement_type: 'neft',
            upi_address: String(sellerProfile?.upi_id ?? ''),
            settlement_bank_account_no: String(sellerProfile?.bank_account_no ?? ''),
            settlement_ifsc_code: String(sellerProfile?.bank_ifsc ?? ''),
            bank_name: '',
            branch_name: '',
          },
        ];

  return {
    id: String(order.ondc_order_id),
    state: normalizedOrderState,
    provider: {
      id: String(order.provider_id ?? ''),
      locations: providerLocationIds,
    },
    items: normalizedItems,
    billing: normalizeBilling(
      {
        ...rawBilling,
        name: rawBilling?.name ?? order.customer_name ?? '',
        email: rawBilling?.email ?? order.customer_email ?? '',
        phone: rawBilling?.phone ?? order.customer_phone ?? '',
        created_at:
          rawBilling?.created_at ??
          (order.created_at instanceof Date ? order.created_at.toISOString() : ''),
        updated_at:
          rawBilling?.updated_at ??
          (order.updated_at instanceof Date ? order.updated_at.toISOString() : ''),
      },
      true,
    ),
    fulfillments: normalizedFulfillments,
    quote: {
      price: {
        currency: String(rawQuote?.price?.currency ?? order.currency ?? 'INR'),
        value: String(rawQuote?.price?.value ?? Number(order.order_total ?? 0).toFixed(2)),
      },
      breakup: quoteBreakup,
      ttl: String(rawQuote?.ttl ?? 'P1D'),
    },
    payment: {
      uri: maybeString(rawPayment.uri ?? rawPayment.url),
      tl_method: maybeString(rawPayment.tl_method ?? 'http/get'),
      type: String(rawPayment.type ?? 'ON-ORDER'),
      collected_by: String(rawPayment.collected_by ?? 'BAP'),
      params: {
        amount: String(rawPayment?.params?.amount ?? Number(order.order_total ?? 0).toFixed(2)),
        currency: String(rawPayment?.params?.currency ?? order.currency ?? 'INR'),
        transaction_id: String(
          rawPayment?.params?.transaction_id ?? order.payment_transaction_ref ?? '',
        ),
      },
      status: String(rawPayment.status ?? paymentStatusFromDb(order.payment_status)),
      '@ondc/org/buyer_app_finder_fee_type': String(
        rawPayment['@ondc/org/buyer_app_finder_fee_type'] ?? 'percent',
      ),
      '@ondc/org/buyer_app_finder_fee_amount': String(
        rawPayment['@ondc/org/buyer_app_finder_fee_amount'] ?? ondcEnv.buyerFinderFeeDefault,
      ),
      '@ondc/org/settlement_window': String(rawPayment['@ondc/org/settlement_window'] ?? 'P1D'),
      '@ondc/org/settlement_basis': String(rawPayment['@ondc/org/settlement_basis'] ?? 'delivery'),
      '@ondc/org/withholding_amount': String(rawPayment['@ondc/org/withholding_amount'] ?? '0.00'),
      '@ondc/org/settlement_details': normalizedSettlementDetails,
    },
    documents: Array.isArray(rawOrder.documents)
      ? rawOrder.documents.map((document: LooseObject) => normalizeDocument(document))
      : [],
    created_at: order.created_at instanceof Date ? order.created_at.toISOString() : nowIso(),
    updated_at: order.updated_at instanceof Date ? order.updated_at.toISOString() : nowIso(),
  };
}
