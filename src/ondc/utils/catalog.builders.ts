/**
 * Domain-aware ONDC payload builders for /on_search, /on_select, /on_init, /on_confirm.
 * Builds payloads matching the ONDC retail API contract v1.2.5 exactly.
 */

import { ondcEnv } from '~/config/ondc.config';
import { SELLER_PROFILE } from '~/ondc/config/constants';
import { getDomainConfig, type OndcRetailDomain } from '~/ondc/config/domain.config';

/**
 * ONDC timestamps are millisecond-zeroed ISO-8601 (e.g. 2025-01-08T07:00:30.000Z).
 * new Date().toISOString() yields real millis (…507Z) which some validators reject.
 */
export function ondcTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

/** Hardcoded brand logo used for provider descriptor symbol/images (for now). */
const ODOP_LOGO_URL = 'https://test.odopmartmp.com/assets/ODOP%20LOGO-DmZ6QXZC.jpeg';

/**
 * Default provider rating shown in on_search.
 * ONDC: aggregate 1-5 scale, up to 1 decimal, maintained by the SNP.
 * TODO: source from real review aggregate once provider ratings are tracked.
 */
const DEFAULT_PROVIDER_RATING = '4';
/** Minimal provider info needed to build a bpp/providers entry */
export interface ProviderBuildInfo {
  provider_id: string;
  name: string;
  short_desc?: string | null;
  long_desc?: string | null;
  logo_url?: string | null;
  fssai_license?: string | null;
  updated_at?: Date | string | null;
  support_phone?: string | null;
  support_email?: string | null;
  /** Aggregate SNP rating 1-5, 1 decimal digit. Defaults if not set. */
  rating?: string | null;
}

const DEFAULT_PROVIDER_SHORT_DESC = 'ODOP store on ONDC';
const DEFAULT_PROVIDER_LONG_DESC =
  'ODOP seller storefront with products available for discovery and fulfillment on ONDC.';
/** Must match ONDC workbench `^[0-9]{10}$` (no +91 / spaces). */
const DEFAULT_CONTACT_PHONE = '9201838159';
const DEFAULT_CONTACT_EMAIL = 'info@odopmartmp.com';
const DEFAULT_LOCALITY = 'Bhopal';

function nonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function resolveProviderShortDesc(value: unknown, providerName?: unknown): string {
  return (
    nonEmptyString(value, providerName && `${String(providerName).trim()} store on ONDC`) ??
    DEFAULT_PROVIDER_SHORT_DESC
  );
}

export function resolveProviderLongDesc(value: unknown, providerName?: unknown): string {
  return (
    nonEmptyString(
      value,
      providerName && `${String(providerName).trim()} storefront for ONDC retail orders.`,
    ) ?? DEFAULT_PROVIDER_LONG_DESC
  );
}

/**
 * Normalize to a 10-digit Indian mobile for ONDC contact.phone fields
 * (FULFILLMENTS_CONTACT_PHONE: ^[0-9]{10}$).
 */
export function resolveOndcPhone(value: unknown): string {
  const candidates = [value, SELLER_PROFILE.SUPPORT_PHONE, DEFAULT_CONTACT_PHONE];
  for (const candidate of candidates) {
    const digits = String(candidate ?? '').replace(/\D/g, '');
    let ten = '';
    if (digits.length === 10) ten = digits;
    else if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1);
    else if (digits.length > 10) ten = digits.slice(-10);
    if (/^\d{10}$/.test(ten)) return ten;
  }
  return DEFAULT_CONTACT_PHONE;
}

export function resolveOndcEmail(value: unknown): string {
  return nonEmptyString(value, SELLER_PROFILE.SUPPORT_EMAIL) ?? DEFAULT_CONTACT_EMAIL;
}

export function resolveOndcLocality(...values: Array<unknown>): string {
  return nonEmptyString(...values, SELLER_PROFILE.LOCALITY) ?? DEFAULT_LOCALITY;
}

// ─── Provider tags ─────────────────────────────────────────────────────────

/** A timing entry helper for provider tags. */
function timingTag(
  type: string,
  locationId: string,
  timeFrom: string,
  timeTo: string,
): { code: string; list: Array<{ code: string; value: string }> } {
  return {
    code: 'timing',
    list: [
      { code: 'type', value: type },
      { code: 'location', value: locationId },
      { code: 'day_from', value: '1' },
      { code: 'day_to', value: '7' },
      { code: 'time_from', value: timeFrom },
      { code: 'time_to', value: timeTo },
    ],
  };
}

/**
 * Build provider-level tags for on_search (ONDC 1.2.5).
 * Emits timing (Order / Self-Pickup / Delivery) + serviceability (pan-India).
 * Store accepts Orders 24/7 (0000-2359); Self-Pickup & Delivery have service windows.
 * No bpp_terms here — those live in bpp/descriptor.
 */
export function buildProviderTags(
  _providerRow: ProviderBuildInfo,
  domain: OndcRetailDomain,
  locationId: string,
  categoryIds: string[],
): object[] {
  const tags: object[] = [
    // Orders accepted 24/7
    timingTag('Order', locationId, '0000', '2359'),
    // Self-Pickup service window
    timingTag('Self-Pickup', locationId, '1100', '2000'),
    // Delivery service window
    timingTag('Delivery', locationId, '1100', '2200'),
    // Serviceability — one construct per category served from this location
    // (contract requires per-category serviceability, and the workbench NACKs
    // on_search when a serviceability category doesn't match one of the
    // provider's item category_ids: "category in serviceability construct
    // should be a valid category id in bpp/providers[0]", code 20006).
    // Pan-India (type 12), val=IND, unit=country.
    ...categoryIds.map((categoryId) => ({
      code: 'serviceability',
      list: [
        { code: 'location', value: locationId },
        { code: 'category', value: categoryId },
        { code: 'type', value: '12' }, // 10=hyperlocal, 11=intercity, 12=pan-India
        { code: 'val', value: 'IND' },
        { code: 'unit', value: 'country' },
      ],
    })),
  ];

  // FSSAI license tag — RET10 grocery only
  const cfg = getDomainConfig(domain);
  if (cfg.requiresFssai && _providerRow.fssai_license) {
    tags.push({
      code: '@ondc/org/fssai_license_no',
      list: [{ code: 'fssai_license_no', value: _providerRow.fssai_license }],
    });
  }

  return tags;
}

// ─── Item tags ─────────────────────────────────────────────────────────────

export interface ItemTagInputs {
  domain: OndcRetailDomain;
  brand?: string | undefined;
  colour?: string | undefined;
  size?: string | undefined;
  gender?: string | undefined;
  material?: string | undefined;
  /** For RET10 grocery only */
  isVeg?: boolean | undefined;
  /** Image type variants (front_view, back_view, side_view, etc.) */
  imageType?: string | undefined;
  /** Origin country code (defaults to IND) */
  originCountry?: string | undefined;
  /** Statutory: packaged commodities (g2) */
  packagedCommodity?:
    | {
        manufacturerOrPackerName?: string | undefined;
        manufacturerOrPackerAddress?: string | undefined;
        commonOrGenericNameOfCommodity?: string | undefined;
        monthYearOfManufacture?: string | undefined;
        importedProductCountryOfOrigin?: string | undefined;
      }
    | undefined;
  /** Statutory: prepackaged food (g3) — RET10 only */
  prepackagedFood?:
    | {
        nutritionalInfo?: string | undefined;
        additivesInfo?: string | undefined;
        brandOwnerName?: string | undefined;
        brandOwnerFssaiLicense?: string | undefined;
        importerName?: string | undefined;
        importerFssaiLicense?: string | undefined;
        netQuantity?: string | undefined;
      }
    | undefined;
}

/** Build item-level tags per ONDC contract */
export function buildItemTags(inp: ItemTagInputs): object[] {
  const tags: object[] = [];
  const cfg = getDomainConfig(inp.domain);

  // origin
  tags.push({
    code: 'origin',
    list: [{ code: 'country', value: inp.originCountry ?? 'IND' }],
  });

  // image (variant)
  if (inp.imageType) {
    tags.push({
      code: 'image',
      list: [{ code: 'type', value: inp.imageType }],
    });
  }

  // veg_nonveg — mandatory for RET10 grocery
  if (cfg.requiresVegNonveg) {
    tags.push({
      code: 'veg_nonveg',
      list: [{ code: inp.isVeg ? 'veg' : 'non_veg', value: 'yes' }],
    });
  }

  // attribute — domain-specific
  const attrs: Array<{ code: string; value: string }> = [];
  if (inp.brand) attrs.push({ code: 'brand', value: inp.brand });
  if (inp.colour) attrs.push({ code: 'colour', value: inp.colour });
  if (inp.size) attrs.push({ code: 'size', value: inp.size });
  if (inp.gender) attrs.push({ code: 'gender', value: inp.gender });
  if (inp.material) attrs.push({ code: 'material', value: inp.material });
  if (attrs.length) {
    tags.push({ code: 'attribute', list: attrs });
  }

  // NOTE: packaged-commodities statutory info is emitted as the top-level
  // item field `@ondc/org/statutory_reqs_packaged_commodities` (see buildOndcItem),
  // NOT as a "g2" item tag — per ONDC 1.2.5.

  // g3 — statutory_reqs_prepackaged_food (RET10 mandatory if applicable)
  if (cfg.requiresFoodStatutory && inp.prepackagedFood) {
    const pf = inp.prepackagedFood;
    const g3: Array<{ code: string; value: string }> = [];
    if (pf.nutritionalInfo) g3.push({ code: 'nutritional_info', value: pf.nutritionalInfo });
    if (pf.additivesInfo) g3.push({ code: 'additives_info', value: pf.additivesInfo });
    if (pf.brandOwnerName) g3.push({ code: 'brand_owner_name', value: pf.brandOwnerName });
    if (pf.brandOwnerFssaiLicense)
      g3.push({ code: 'brand_owner_FSSAI_license', value: pf.brandOwnerFssaiLicense });
    if (pf.importerName) g3.push({ code: 'importer_name', value: pf.importerName });
    if (pf.importerFssaiLicense)
      g3.push({ code: 'importer_FSSAI_license', value: pf.importerFssaiLicense });
    if (pf.netQuantity) g3.push({ code: 'net_quantity', value: pf.netQuantity });
    if (g3.length) tags.push({ code: 'g3', list: g3 });
  }

  return tags;
}

// ─── Provider location ─────────────────────────────────────────────────────

export interface ProviderLocation {
  id: string;
  gps: string; // "lat,lng"
  address: {
    locality: string;
    street: string;
    city: string;
    area_code: string;
    state: string;
  };
  circle?: {
    gps: string;
    radius: { unit: string; value: string };
  };
  time: {
    label: string;
    timestamp: string;
    days: string;
    schedule: { holidays: string[]; frequency: string; times: string[] };
    range: { start: string; end: string };
  };
}

export function buildProviderLocation(
  locationId: string,
  gps: string,
  address: ProviderLocation['address'],
  serviceRadiusKm: number = 10,
  timeFrom: string = '0000',
  timeTo: string = '2359',
  days: string = '1,2,3,4,5,6,7',
): ProviderLocation {
  return {
    id: locationId,
    gps,
    address,
    circle: {
      gps,
      // ONDC 1.2.5: radius is { unit, value } only — no "type".
      radius: { unit: 'km', value: String(serviceRadiusKm) },
    },
    time: {
      label: 'enable',
      timestamp: ondcTimestamp(),
      days,
      schedule: { holidays: [], frequency: 'PT4H', times: ['0000', '2359'] },
      range: { start: timeFrom, end: timeTo },
    },
  };
}

// ─── BPP catalog descriptor ────────────────────────────────────────────────

export function buildBppDescriptor() {
  return {
    name: SELLER_PROFILE.BRAND_NAME || 'ODOP Mart',
    symbol: `${ondcEnv.baseUri}/logo.png`,
    short_desc: 'ODOP Products Marketplace',
    long_desc: 'One District One Product e-commerce platform powered by ONDC',
    images: [`${ondcEnv.baseUri}/logo.png`],
    tags: [
      {
        code: 'bpp_terms',
        list: [
          { code: 'np_type', value: 'MSN' },
          { code: 'accept_bap_terms', value: 'Y' },
        ],
      },
    ],
  };
}

// ─── BPP fulfillments + payments ───────────────────────────────────────────

/**
 * Top-level bpp/fulfillments — per ONDC 1.2.5 this is just {id, type}.
 * No @ondc/org/category, @ondc/org/TAT or contact at catalog level.
 */
export function buildBppFulfillments() {
  return [
    { id: '1', type: 'Delivery' },
    { id: '2', type: 'Self-Pickup' },
  ];
}

/**
 * Provider-level fulfillments for bpp/providers[*].fulfillments.
 * Per ONDC 1.2.5: only id, type, contact — no @ondc/org/category or @ondc/org/TAT.
 * Those fields belong only in the top-level bpp/fulfillments array.
 */
export function buildProviderFulfillments(providerRow?: ProviderBuildInfo): object[] {
  const phone = resolveOndcPhone(providerRow?.support_phone);
  const email = resolveOndcEmail(providerRow?.support_email);
  return [
    {
      id: '1',
      type: 'Delivery',
      contact: { phone, email },
    },
    {
      id: '2',
      type: 'Self-Pickup',
      contact: { phone, email },
    },
  ];
}

/** @deprecated - bpp/payments is no longer emitted at catalog level in ONDC 1.2.5.
 * Payment terms now live inside each provider as @ondc/org/payments. */
export function buildBppPayments() {
  return [
    {
      '@ondc/org/buyer_app_finder_fee_type': 'percent',
      '@ondc/org/buyer_app_finder_fee_amount': ondcEnv.buyerFinderFeeDefault,
    },
  ];
}

// ─── ONDC item builder (used by adapter) ───────────────────────────────────

export interface BuildOndcItemInput {
  productId: number;
  ondcItemId: string;
  name: string;
  shortDesc: string;
  longDesc: string;
  images: string[];
  price: number;
  mrp: number;
  stock: number;
  categoryCode: string;
  domain: OndcRetailDomain;
  fulfillmentId: string;
  locationId: string;
  /** ONDC compliance flags */
  returnable: boolean;
  cancellable: boolean;
  returnWindow: string;
  timeToShip: string;
  sellerPickupReturn: boolean;
  availableOnCod: boolean;
  consumerCareContact: string;
  /** Domain-specific attributes (passed to buildItemTags) */
  attributes?: Omit<ItemTagInputs, 'domain'> | undefined;
  /** Optional unit-of-measure */
  unit?: { unit: string; value: string } | undefined;
  /** descriptor.code in "type:code" form (1-EAN, 2-ISBN, 3-GTIN, 4-HSN, 5-other). */
  idCode?: string | undefined;
  /** Manual out-of-stock override (products.force_out_of_stock). */
  outOfStock?: boolean | undefined;
  /** Item rating on ONDC's 1-5 integer scale. */
  rating?: string | undefined;
}

export function buildOndcItem(inp: BuildOndcItemInput): object {
  // In-stock unless manually flagged OOS or stock depleted.
  const inStock = !inp.outOfStock && inp.stock > 0;
  // available.count is the ONDC sentinel: "99" when available, "0" when out of stock.
  const availableCount = inStock ? '99' : '0';
  // maximum.count = the actual stock count, taken directly from products.stock.
  const maximumCount = String(inp.stock);

  return {
    id: inp.ondcItemId,
    time: { label: 'enable', timestamp: ondcTimestamp() },
    rating: inp.rating ?? '4',
    descriptor: {
      name: inp.name,
      ...(inp.idCode ? { code: inp.idCode } : {}),
      symbol: inp.images[0],
      short_desc: inp.shortDesc.slice(0, 200),
      long_desc: inp.longDesc,
      images: inp.images,
    },
    quantity: {
      ...(inp.unit ? { unitized: { measure: inp.unit } } : {}),
      available: { count: availableCount },
      maximum: { count: maximumCount },
    },
    price: {
      currency: 'INR',
      value: inp.price.toFixed(2),
      maximum_value: inp.mrp.toFixed(2),
    },
    category_id: inp.categoryCode,
    fulfillment_id: inp.fulfillmentId,
    location_id: inp.locationId,

    '@ondc/org/returnable': inp.returnable,
    '@ondc/org/cancellable': inp.cancellable,
    '@ondc/org/return_window': inp.returnWindow,
    '@ondc/org/seller_pickup_return': inp.sellerPickupReturn,
    '@ondc/org/time_to_ship': inp.timeToShip,
    '@ondc/org/available_on_cod': inp.availableOnCod,
    '@ondc/org/contact_details_consumer_care': inp.consumerCareContact,

    // Top-level statutory object (ONDC 1.2.5) — replaces the old "g2" item tag.
    '@ondc/org/statutory_reqs_packaged_commodities': {
      manufacturer_or_packer_name:
        inp.attributes?.packagedCommodity?.manufacturerOrPackerName ?? '',
      manufacturer_or_packer_address:
        inp.attributes?.packagedCommodity?.manufacturerOrPackerAddress ?? '',
      common_or_generic_name_of_commodity:
        inp.attributes?.packagedCommodity?.commonOrGenericNameOfCommodity ?? '',
      month_year_of_manufacture_packing_import:
        inp.attributes?.packagedCommodity?.monthYearOfManufacture ?? '',
    },

    tags: buildItemTags({ domain: inp.domain, ...(inp.attributes ?? {}) }),
  };
}

// ─── Cancellation terms (per ONDC contract — all 7 phases required) ────────

export const COMPLETE_CANCELLATION_TERMS = [
  {
    fulfillment_state: {
      descriptor: { code: 'Pending', short_desc: '001,002,005,009,010,011,012,013,014,015' },
    },
    reason_required: false,
    cancellation_fee: { percentage: '0.0', amount: { currency: 'INR', value: '0.0' } },
  },
  {
    fulfillment_state: { descriptor: { code: 'Packed', short_desc: '001,003,004,010,014,016' } },
    reason_required: true,
    cancellation_fee: { percentage: '0.0', amount: { currency: 'INR', value: '0.0' } },
  },
  {
    fulfillment_state: {
      descriptor: { code: 'Agent-assigned', short_desc: '001,003,004,010,014,016' },
    },
    reason_required: true,
    cancellation_fee: { percentage: '0.0', amount: { currency: 'INR', value: '0.0' } },
  },
  {
    fulfillment_state: {
      descriptor: { code: 'Order-picked-up', short_desc: '001,003,004,010,014,016,018' },
    },
    reason_required: true,
    cancellation_fee: { percentage: '10.0', amount: { currency: 'INR', value: '10.0' } },
  },
  {
    fulfillment_state: {
      descriptor: { code: 'Out-for-delivery', short_desc: '003,004,010,014,016,018' },
    },
    reason_required: true,
    cancellation_fee: { percentage: '10.0', amount: { currency: 'INR', value: '10.0' } },
  },
];

// ─── Quote breakup builder (per-item, with delivery, packing, tax) ─────────

export interface QuoteLineInput {
  itemId: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
  stockAvailable: number;
  stockMaximum: number;
  taxPercent?: number;
}

export interface QuoteBuildOutput {
  price: { currency: string; value: string };
  breakup: object[];
  ttl: string;
}

export interface QuoteBuildOptions {
  includeZeroBreakups?: boolean;
}

/**
 * Quote breakup = per-item prices + a single delivery (shipping) line only.
 * Tax, packing and convenience-fee lines are intentionally NOT emitted — the
 * network quotes product amount + shipping and nothing else.
 * @param includeZeroBreakups keep the delivery line even when the charge is 0.
 */
export function buildQuote(
  lines: QuoteLineInput[],
  fulfillmentId: string = 'F1',
  deliveryCharge: number = 0,
  options: QuoteBuildOptions = {},
): QuoteBuildOutput {
  const { includeZeroBreakups = false } = options;
  const breakup: object[] = [];
  let total = 0;

  for (const l of lines) {
    const lineTotal = l.unitPrice * l.quantity;
    total += lineTotal;

    breakup.push({
      '@ondc/org/item_id': l.itemId,
      '@ondc/org/item_quantity': { count: l.quantity },
      title: l.itemName,
      '@ondc/org/title_type': 'item',
      price: { currency: 'INR', value: lineTotal.toFixed(2) },
      item: {
        quantity: {
          available: { count: String(Math.min(99, l.stockAvailable)) },
          maximum: { count: String(l.stockMaximum) },
        },
        price: { currency: 'INR', value: l.unitPrice.toFixed(2) },
      },
    });
  }

  if (deliveryCharge > 0 || includeZeroBreakups) {
    breakup.push({
      '@ondc/org/item_id': fulfillmentId,
      title: 'Delivery charges',
      '@ondc/org/title_type': 'delivery',
      price: { currency: 'INR', value: deliveryCharge.toFixed(2) },
    });
    total += deliveryCharge;
  }

  return {
    price: { currency: 'INR', value: total.toFixed(2) },
    breakup,
    ttl: 'PT30M',
  };
}

// ─── On_init payment with settlement_details ───────────────────────────────

export interface SettlementDetails {
  upiAddress?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  beneficiaryName?: string;
  bankName?: string;
  branchName?: string;
}

export function buildOnInitPayment(total: number, settlement?: SettlementDetails): object {
  return {
    type: 'ON-ORDER',
    collected_by: 'BAP',
    status: 'NOT-PAID',
    params: {
      amount: total.toFixed(2),
      currency: 'INR',
    },
    '@ondc/org/buyer_app_finder_fee_type': 'percent',
    '@ondc/org/buyer_app_finder_fee_amount': ondcEnv.buyerFinderFeeDefault,
    '@ondc/org/settlement_basis': 'delivery',
    '@ondc/org/settlement_window': 'P1D',
    '@ondc/org/withholding_amount': '0.00',
    '@ondc/org/settlement_details': [
      (() => {
        const obj: any = {
          settlement_counterparty: 'seller-app',
          settlement_phase: 'sale-amount',
          settlement_type: 'upi',
          upi_address: settlement?.upiAddress ?? '',
          settlement_bank_account_no: settlement?.bankAccountNo ?? '',
          settlement_ifsc_code: settlement?.ifscCode ?? '',
          beneficiary_name: settlement?.beneficiaryName ?? SELLER_PROFILE.COMPANY_NAME,
        };
        const rawBank = String(settlement?.bankName ?? '').trim();
        if (rawBank) obj.bank_name = rawBank;
        const rawBranch = String(settlement?.branchName ?? '').trim();
        if (rawBranch) obj.branch_name = rawBranch;
        return obj;
      })(),
    ],
  };
}

// ─── Build full bpp/providers entry from a row + items ─────────────────────

export function buildProviderEntry(
  providerRow: ProviderBuildInfo,
  items: object[],
  domain: OndcRetailDomain,
  locations: ProviderLocation[] = [],
  variantCategories: VariantCategory[] = [],
): object {
  const cfg = getDomainConfig(domain);

  // Use first location id for tags; fallback 'L1' if no locations
  const firstLocId = locations[0]?.id ?? 'L1';

  // Build a default fallback location if none provided
  const resolvedLocations: ProviderLocation[] =
    locations.length > 0
      ? locations
      : [
          buildProviderLocation('L1', '23.259933,77.412613', {
            locality: resolveOndcLocality(),
            street: '',
            city: SELLER_PROFILE.CITY,
            area_code: SELLER_PROFILE.AREA_CODE,
            state: SELLER_PROFILE.STATE,
          }),
        ];

  // Provider `categories` carries ONLY variant groups (ONDC 1.2.5). The standard
  // retail category lives on each item's `category_id`, not here — so when a
  // provider has no variant groups, `categories` is omitted entirely.
  const providerTimestamp = providerRow.updated_at
    ? ondcTimestamp(new Date(providerRow.updated_at))
    : ondcTimestamp();

  const entry: Record<string, unknown> = {
    id: providerRow.provider_id,
    time: { label: 'enable', timestamp: providerTimestamp },
    // SNP-maintained aggregate rating, 1-5 scale, 1 decimal digit.
    rating: providerRow.rating ?? DEFAULT_PROVIDER_RATING,
    // Provider-level fulfillments: id/type/contact ONLY (no @ondc/org/TAT or category).
    fulfillments: buildProviderFulfillments(providerRow),
    descriptor: {
      name: providerRow.name,
      symbol: ODOP_LOGO_URL,
      short_desc: resolveProviderShortDesc(providerRow.short_desc, providerRow.name),
      long_desc: resolveProviderLongDesc(providerRow.long_desc, providerRow.name),
      images: [ODOP_LOGO_URL],
    },
    ttl: 'PT24H',
    locations: resolvedLocations,
    items,
    tags: buildProviderTags(
      providerRow,
      domain,
      firstLocId,
      // Serviceability must cover the categories the items actually use —
      // the workbench cross-checks each serviceability category against the
      // item category_ids (and expects every item category to have a
      // serviceability construct, so a single category is not enough for
      // multi-category providers). Fall back to the domain default only for
      // an (unexpected) provider whose items carry no category_id.
      (() => {
        const ids = [
          ...new Set(
            items
              .map((i) => (i as { category_id?: unknown }).category_id)
              .filter((c): c is string => typeof c === 'string' && c.length > 0),
          ),
        ];
        return ids.length > 0 ? ids : [cfg.defaultCategoryCode];
      })(),
    ),
    // `categories` (variant groups) is OPTIONAL per contract v1.2.5
    // (footnote [54]: "custom menu / customization group / variant
    // definitions for provider (optional)"; the doc's own Home & Kitchen
    // example provider has no categories key at all). Emit it only when the
    // provider actually has variant groups — an empty [] adds noise and no
    // provider in the contract's examples carries one.
    // NOTE: an earlier workbench run NACK'd a categories-less provider with
    // 30000 "categories[*].id must be present in the payload"; if that exact
    // NACK reappears after this change, the workbench deviates from the
    // contract and this must revert to always emitting `categories`.
    ...(variantCategories.length > 0 ? { categories: variantCategories } : {}),
  };

  // FSSAI only for RET10 (grocery)
  if (cfg.requiresFssai) {
    entry['@ondc/org/fssai_license_no'] = providerRow.fssai_license ?? '';
  }

  return entry;
}

// ─── Variant grouping ──────────────────────────────────────────────────────

/**
 * Sets parent_item_id on variant siblings and emits the variant_group categories.
 * Mirrors PHP _ensure_variant_support + _add_variant_catalog_data:
 *   - items with a variant group get parent_item_id
 *   - standalone items omit parent_item_id entirely
 *   - each group contributes a category {id, descriptor, tags: [type=variant_group, attr...]}
 *   - attr tags reference item.tags.attribute.<code> based on which attributes vary
 *
 * Input items must carry _variantGroupId (consumed and stripped).
 */
export interface ItemWithVariantMeta {
  // Mutable OndcItem fields
  id: string;
  parent_item_id?: string;
  tags?: Array<{ code: string; list: Array<{ code: string; value: string }> }>;
  [k: string]: unknown;
  // Internal grouping key, stripped before output
  _variantGroupId?: string;
}

export interface VariantCategory {
  id: string;
  descriptor: { name: string };
  tags: Array<{ code: string; list: Array<{ code: string; value: string }> }>;
}

const VARIANT_ATTR_PRIORITY: Record<string, number> = {
  colour: 1,
  size: 2,
  measure: 3,
  material: 4,
  fabric: 5,
  weight: 6,
  length: 7,
  breadth: 8,
  height: 9,
};

export function applyVariantGrouping(items: ItemWithVariantMeta[]): {
  items: ItemWithVariantMeta[];
  categories: VariantCategory[];
} {
  const groups = new Map<string, number[]>();
  items.forEach((it, idx) => {
    const gid = it._variantGroupId ?? '';
    if (!gid) return;
    const arr = groups.get(gid) ?? [];
    arr.push(idx);
    groups.set(gid, arr);
  });

  const categories: VariantCategory[] = [];

  for (const [groupId, idxs] of groups.entries()) {
    // A variant-group category only makes sense when at least two visible
    // siblings survive domain filtering. A lone visible variant must behave
    // like a standalone item, otherwise buyers receive parent_item_id values
    // that point to no category entry and some UIs render a blank catalog.
    if (idxs.length < 2) continue;

    for (const idx of idxs) {
      items[idx]!.parent_item_id = groupId;
    }

    // Collect which attribute codes vary across siblings
    const valuesByCode = new Map<string, Set<string>>();
    const orderedCodes: string[] = [];

    for (const idx of idxs) {
      const it = items[idx]!;
      for (const tag of it.tags ?? []) {
        if (tag.code.toLowerCase() !== 'attribute') continue;
        for (const entry of tag.list ?? []) {
          const codeRaw = (entry.code ?? '').toLowerCase().trim();
          const code = codeRaw === 'color' ? 'colour' : codeRaw;
          if (!code || code === 'colour_name' || code === 'color_name') continue;
          const value = (entry.value ?? '').trim();
          if (!value) continue;
          if (!valuesByCode.has(code)) {
            valuesByCode.set(code, new Set());
            orderedCodes.push(code);
          }
          valuesByCode.get(code)!.add(value);
        }
      }
    }

    const varyingCodes = orderedCodes.filter((c) => (valuesByCode.get(c)?.size ?? 0) > 1);
    if (varyingCodes.length === 0) continue;

    varyingCodes.sort((a, b) => {
      const pa = VARIANT_ATTR_PRIORITY[a] ?? 999;
      const pb = VARIANT_ATTR_PRIORITY[b] ?? 999;
      return pa === pb ? a.localeCompare(b) : pa - pb;
    });

    const catTags: VariantCategory['tags'] = [
      { code: 'type', list: [{ code: 'type', value: 'variant_group' }] },
    ];
    varyingCodes.forEach((code, i) => {
      catTags.push({
        code: 'attr',
        list: [
          { code: 'name', value: `item.tags.attribute.${code}` },
          { code: 'seq', value: String(i + 1) },
        ],
      });
    });

    categories.push({
      id: groupId,
      descriptor: { name: `Variant Group ${groupId}` },
      tags: catTags,
    });
  }

  // Strip internal field from all items
  const cleaned = items.map(({ _variantGroupId, ...rest }) => rest as ItemWithVariantMeta);

  return { items: cleaned, categories };
}
