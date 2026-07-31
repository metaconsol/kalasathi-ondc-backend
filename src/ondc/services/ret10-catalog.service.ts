/**
 * Catalog Service — RET10 (Grocery) specific.
 *
 * Builds /on_search live from ondc_odop_db and then normalizes the result to the
 * ONDC RET10 API contract v1.2.5 shape enforced by the workbench validations:
 *
 *   LOCATIONS_TIME_FREQUENCY_RANGE  locations[].time needs range.start/end
 *   RANGE_START_AND_END             range.start/end must be HHMM (0000-2359)
 *   LOCATIONS_GPS                   gps needs 2 integer digits + >= 4 decimals
 *   ITEMS_DESCRIPTOR_CODE           descriptor.code must start with "1:" or "5:"
 *   ITEMS_CATEGORY_ID               category_id must be a RET10 category name
 *   TAGS_BPP_ITEMS_VALID_TAGS       item tag codes limited to the RET10 set
 *
 * Everything is sourced from the database; each normalizer only falls back to a
 * hardcoded default when the database value is missing or unusable.
 * This file is RET10-only — no other domain flow reads it.
 */

import {
  fetchOndcCatalogRows,
  buildOndcItemFromRow,
  type OndcCatalogRow,
} from '~/ondc/adapters/product.adapter';
import {
  getActiveStores,
  fetchStoreLocations,
  mapStoreLocationToOndcLocation,
  type MainDbStoreLocation,
} from '~/ondc/adapters/seller.adapter';
import {
  buildBppDescriptor,
  buildBppFulfillments,
  buildProviderEntry,
  applyVariantGrouping,
  type ProviderBuildInfo,
  type ProviderLocation,
  type ItemWithVariantMeta,
} from '~/ondc/utils/catalog.builders';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { OndcRetailDomain } from '~/ondc/config/domain.config';
import type { OnSearchCatalog } from '~/ondc/utils/payload.builder';
import { PROVIDER_TIMING } from '~/ondc/config/constants';

const RET10_DOMAIN: OndcRetailDomain = 'ONDC:RET10';

// ─── RET10 contract constants ──────────────────────────────────────────────

/** ITEMS_CATEGORY_ID enum — items[].category_id must be one of these verbatim. */
const RET10_CATEGORY_IDS = [
  'Fruits and Vegetables',
  'Masala & Seasoning',
  'Oil & Ghee',
  'Eggs, Meat & Fish',
  'Cleaning & Household',
  'Bakery, Cakes & Dairy',
  'Pet Care',
  'Stationery',
  'Detergents and Dishwash',
  'Dairy and Cheese',
  'Snacks, Dry Fruits, Nuts',
  'Pasta, Soup and Noodles',
  'Cereals and Breakfast',
  'Sauces, Spreads and Dips',
  'Chocolates and Biscuits',
  'Cooking and Baking Needs',
  'Tinned and Processed Food',
  'Atta, Flours and Sooji',
  'Rice and Rice Products',
  'Dals and Pulses',
  'Salt, Sugar and Jaggery',
  'Energy and Soft Drinks',
  'Water',
  'Tea and Coffee',
  'Fruit Juices and Fruit Drinks',
  'Snacks and Namkeen',
  'Ready to Cook and Eat',
  'Pickles and Chutney',
  'Indian Sweets',
  'Frozen Vegetables',
  'Frozen Snacks',
  'Gift Voucher',
] as const;

const RET10_FALLBACK_CATEGORY_ID = 'Snacks and Namkeen';

/** TAGS_BPP_ITEMS_VALID_TAGS — every other item tag code is rejected. */
const RET10_ITEM_TAG_CODES = new Set(['origin', 'veg_nonveg', 'image', 'timing', 'np_fees']);

/** quantity.unitized.measure.unit enum. */
const RET10_MEASURE_UNITS = new Set(['unit', 'dozen', 'kilogram', 'tonne', 'litre', 'millilitre']);

/** Bhopal (ODOP HQ) — used only when a store location has no coordinates. */
const FALLBACK_GPS = '23.259933,77.412613';
const FALLBACK_TIME_FROM = '0000';
const FALLBACK_TIME_TO = '2359';

// ─── Category resolution ───────────────────────────────────────────────────

function categoryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const RET10_CATEGORY_BY_KEY = new Map<string, string>(
  RET10_CATEGORY_IDS.map((name) => [categoryKey(name), name]),
);

/**
 * Keyword fallbacks for category names that don't match the ONDC enum at all
 * (ODOP sellers use their own taxonomy, e.g. categories.name = "Gud").
 */
const RET10_CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/jaggery|\bgud\b|khand|sugar|\bsalt\b|shakkar|namak/, 'Salt, Sugar and Jaggery'],
  [/\batta\b|flour|sooji|suji|rava|maida|besan/, 'Atta, Flours and Sooji'],
  [/\brice\b|basmati|poha|chawal|murmura/, 'Rice and Rice Products'],
  [/\bdal\b|\bdaal\b|pulse|chana|moong|urad|masoor|rajma|lobia/, 'Dals and Pulses'],
  [/\btea\b|coffee|\bchai\b/, 'Tea and Coffee'],
  [
    /masala|spice|seasoning|haldi|turmeric|chilli|mirch|dhaniya|coriander|jeera|cumin/,
    'Masala & Seasoning',
  ],
  [/\boil\b|\bghee\b|mustard oil|coconut oil/, 'Oil & Ghee'],
  [/pickle|achar|chutney|murabba/, 'Pickles and Chutney'],
  [/sweet|mithai|laddu|ladoo|barfi|burfi|gajak|petha/, 'Indian Sweets'],
  [/honey|\bjam\b|sauce|spread|\bdip\b|ketchup/, 'Sauces, Spreads and Dips'],
  [/biscuit|cookie|chocolate|candy|toffee/, 'Chocolates and Biscuits'],
  [
    /\bnuts?\b|dry ?fruit|cashew|almond|kaju|badam|raisin|kishmish|makhana/,
    'Snacks, Dry Fruits, Nuts',
  ],
  [/namkeen|snack|chips|mixture|bhujia|sev\b/, 'Snacks and Namkeen'],
  [/juice|sharbat|sherbet|squash|thandai/, 'Fruit Juices and Fruit Drinks'],
  [/mineral water|packaged water|\bwater\b/, 'Water'],
  [/soft drink|energy drink|\bsoda\b|cola/, 'Energy and Soft Drinks'],
  [/\bmilk\b|dairy|cheese|paneer|curd|dahi|butter/, 'Dairy and Cheese'],
  [/bakery|cake|bread|rusk|toast/, 'Bakery, Cakes & Dairy'],
  [/noodle|pasta|soup|vermicelli|macaroni/, 'Pasta, Soup and Noodles'],
  [/cereal|breakfast|\boats\b|muesli|cornflakes/, 'Cereals and Breakfast'],
  [/detergent|dishwash|\bsoap\b|cleaner|cleaning|phenyl/, 'Detergents and Dishwash'],
  [/baking|cooking need|\byeast\b|baking soda/, 'Cooking and Baking Needs'],
  [/frozen veg/, 'Frozen Vegetables'],
  [/frozen/, 'Frozen Snacks'],
  [/\begg\b|\bmeat\b|\bfish\b|chicken|mutton/, 'Eggs, Meat & Fish'],
  [/fruit|vegetable|sabzi|\bsabji\b/, 'Fruits and Vegetables'],
  [/papad|ready to (cook|eat)|instant mix/, 'Ready to Cook and Eat'],
  [/tinned|canned|processed/, 'Tinned and Processed Food'],
  [/pet food|pet care/, 'Pet Care'],
  [/stationery|notebook/, 'Stationery'],
  [/gift ?voucher/, 'Gift Voucher'],
  [/household/, 'Cleaning & Household'],
];

/**
 * Map whatever the DB holds (ONDC name, slug like "salt-sugar-and-jaggery", or a
 * seller-defined category name) onto a valid RET10 category_id.
 * Candidates are tried in order of trustworthiness; the hardcoded fallback is
 * only used when none of the DB values can be resolved.
 */
function resolveRet10CategoryId(candidates: Array<string | null | undefined>): string {
  const usable = candidates.map((c) => String(c ?? '').trim()).filter((c) => c.length > 0);

  for (const candidate of usable) {
    const exact = RET10_CATEGORY_BY_KEY.get(categoryKey(candidate));
    if (exact) return exact;
  }

  for (const candidate of usable) {
    const haystack = candidate.toLowerCase();
    for (const [pattern, categoryId] of RET10_CATEGORY_KEYWORDS) {
      if (pattern.test(haystack)) return categoryId;
    }
  }

  return RET10_FALLBACK_CATEGORY_ID;
}

// ─── Item normalization ────────────────────────────────────────────────────

/**
 * descriptor.code must be "1:<EAN>" or "5:<other>" for RET10 (types 2/3/4 are
 * rejected). Prefers the variant GTIN/EAN, then SKU, then HSN.
 */
function resolveRet10ItemCode(row: OndcCatalogRow, itemId: string): string {
  const ean = String(row.gtin_ean ?? '').replace(/\D/g, '');
  if (ean.length === 8 || ean.length === 12 || ean.length === 13 || ean.length === 14) {
    return `1:${ean}`;
  }
  const other = String(row.sku ?? '').trim() || String(row.hsn_sac_code ?? '').trim() || itemId;
  return `5:${other}`;
}

/** Coerce quantity.unitized.measure onto the ONDC unit enum (grams → kilogram). */
function resolveRet10Measure(measure: unknown): { unit: string; value: string } {
  const raw = (measure ?? {}) as { unit?: unknown; value?: unknown };
  const unit = String(raw.unit ?? '')
    .trim()
    .toLowerCase();
  const numeric = Number.parseFloat(String(raw.value ?? ''));
  const value = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;

  if (RET10_MEASURE_UNITS.has(unit)) return { unit, value: String(value) };

  switch (unit) {
    case 'g':
    case 'gm':
    case 'gms':
    case 'gram':
    case 'grams':
      return { unit: 'kilogram', value: String(Number((value / 1000).toFixed(4))) };
    case 'kg':
    case 'kgs':
    case 'kilo':
    case 'kilos':
    case 'kilograms':
      return { unit: 'kilogram', value: String(value) };
    case 'mg':
      return { unit: 'kilogram', value: String(Number((value / 1_000_000).toFixed(6))) };
    case 'ml':
    case 'mls':
    case 'millilitres':
    case 'milliliter':
    case 'milliliters':
      return { unit: 'millilitre', value: String(value) };
    case 'l':
    case 'ltr':
    case 'ltrs':
    case 'liter':
    case 'liters':
    case 'litres':
      return { unit: 'litre', value: String(value) };
    case 'ton':
    case 'tons':
    case 'tonnes':
      return { unit: 'tonne', value: String(value) };
    case 'dozens':
      return { unit: 'dozen', value: String(value) };
    default:
      return { unit: 'unit', value: String(value) };
  }
}

/** Apply every RET10 item-level contract rule in place. */
function normalizeRet10Item(item: Record<string, any>, row: OndcCatalogRow): void {
  item['category_id'] = resolveRet10CategoryId([
    item['category_id'],
    row.ondc_subcategory,
    row.category_name,
    row.name,
  ]);

  const descriptor = (item['descriptor'] ?? {}) as Record<string, unknown>;
  descriptor['code'] = resolveRet10ItemCode(row, String(item['id'] ?? ''));
  item['descriptor'] = descriptor;

  const quantity = (item['quantity'] ?? {}) as Record<string, any>;
  quantity['unitized'] = { measure: resolveRet10Measure(quantity['unitized']?.measure) };
  // maximum.count is the per-order cap and must stay a positive integer even for
  // a store that hasn't recorded stock yet.
  const maxCount = Number.parseInt(String(quantity['maximum']?.count ?? ''), 10);
  quantity['maximum'] = { count: String(Number.isFinite(maxCount) && maxCount > 0 ? maxCount : 1) };
  item['quantity'] = quantity;

  const tags = Array.isArray(item['tags']) ? (item['tags'] as Array<{ code?: unknown }>) : [];
  item['tags'] = tags.filter((tag) => RET10_ITEM_TAG_CODES.has(String(tag?.code ?? '')));
}

// ─── Location normalization ────────────────────────────────────────────────

/** LOCATIONS_GPS: "^\d{2}\.\d{4,}\s*,\s*\d{2}\.\d{4,}$" — 2 integer digits, >= 4 decimals. */
function formatGpsCoord(value: number): string {
  const [intPart = '0', decPart = '0'] = Math.abs(value).toFixed(6).split('.');
  return `${intPart.padStart(2, '0')}.${decPart}`;
}

function normalizeGps(raw: unknown): string {
  const parts = String(raw ?? '').split(',');
  const lat = Number.parseFloat(String(parts[0] ?? ''));
  const lng = Number.parseFloat(String(parts[1] ?? ''));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return normalizeGps(FALLBACK_GPS);
  }
  return `${formatGpsCoord(lat)},${formatGpsCoord(lng)}`;
}

interface LocationWindow {
  start: string;
  end: string;
  days: string;
}

/** Operating window — one org-wide PROVIDER_TIMING setting, 24x7 as the fallback. */
function resolveLocationWindow(): LocationWindow {
  const start = PROVIDER_TIMING.TIME_FROM || FALLBACK_TIME_FROM;
  const end = PROVIDER_TIMING.TIME_TO || FALLBACK_TIME_TO;

  const dayFrom = Number.parseInt(PROVIDER_TIMING.DAY_FROM, 10) || 1;
  const dayTo = Number.parseInt(PROVIDER_TIMING.DAY_TO, 10) || 7;
  const days = Array.from({ length: Math.max(1, dayTo - dayFrom + 1) }, (_, i) =>
    String(dayFrom + i),
  ).join(',');

  // A window that wraps past midnight (e.g. 1030 → 0630) can't be expressed as a
  // start/end pair, so such rows fall back to the 24x7 window.
  if (end <= start) return { start: FALLBACK_TIME_FROM, end: FALLBACK_TIME_TO, days };

  return { start, end, days };
}

function normalizeRet10Location(
  location: Record<string, any>,
  window: LocationWindow,
): Record<string, any> {
  const gps = normalizeGps(location['gps']);
  const time = (location['time'] ?? {}) as Record<string, any>;

  const normalized: Record<string, any> = {
    ...location,
    gps,
    time: {
      ...time,
      label: String(time['label'] ?? 'enable'),
      days: window.days,
      schedule: {
        holidays: Array.isArray(time['schedule']?.holidays) ? time['schedule'].holidays : [],
      },
      range: { start: window.start, end: window.end },
    },
  };

  if (normalized['circle']) {
    normalized['circle'] = { ...normalized['circle'], gps };
  }

  return normalized;
}

// ─── Provider tag normalization ────────────────────────────────────────────

function timingTag(type: string, locationId: string, window: LocationWindow) {
  return {
    code: 'timing',
    list: [
      { code: 'type', value: type },
      { code: 'location', value: locationId },
      { code: 'day_from', value: window.days.split(',')[0] ?? '1' },
      { code: 'day_to', value: window.days.split(',').pop() ?? '7' },
      { code: 'time_from', value: window.start },
      { code: 'time_to', value: window.end },
    ],
  };
}

/**
 * Rebuild the provider timing tags from the store's real opening hours.
 * Orders are accepted round the clock; Delivery / Self-Pickup follow the
 * location window.
 */
function buildRet10TimingTags(locationId: string, window: LocationWindow): object[] {
  return [
    timingTag('Order', locationId, {
      start: FALLBACK_TIME_FROM,
      end: FALLBACK_TIME_TO,
      days: window.days,
    }),
    timingTag('Delivery', locationId, window),
    timingTag('Self-Pickup', locationId, window),
  ];
}

// ─── Service ───────────────────────────────────────────────────────────────

export const ret10CatalogService = {
  /**
   * Build the /on_search catalog for ONDC:RET10.
   */
  async buildSearchCatalog(): Promise<OnSearchCatalog> {
    const providers: object[] = [];

    const stores = await getActiveStores();

    for (const store of stores) {
      const providerId = String(store.id);

      // Locations
      let locRows: MainDbStoreLocation[] = [];
      let ondcLocations: ProviderLocation[] = [];
      try {
        locRows = await fetchStoreLocations(store.id);
        ondcLocations = locRows.map(mapStoreLocationToOndcLocation);
      } catch (err) {
        ondcLogger.warn('Failed to fetch store locations', { storeId: store.id, err });
      }

      const locationId = ondcLocations[0]?.id ?? 'L1';
      const fulfillmentId = '1'; // Delivery

      // Products + variants
      let rows: OndcCatalogRow[];
      try {
        rows = await fetchOndcCatalogRows(store.id);
      } catch (err) {
        ondcLogger.error('Failed to fetch catalog rows', { storeId: store.id, err });
        continue;
      }
      if (rows.length === 0) continue;

      const builtItems: ItemWithVariantMeta[] = [];
      for (const row of rows) {
        try {
          const built = await buildOndcItemFromRow(row, {
            providerId,
            locationId,
            fulfillmentId,
            storeName: store.name,
            storeEmail: store.email,
            storePhone: store.phone,
          });

          // STRICTLY filter for RET10 items
          if (built.domain !== RET10_DOMAIN) continue;

          const item = { ...(built.item as unknown as Record<string, any>) };
          normalizeRet10Item(item, row);

          builtItems.push({
            ...(item as unknown as ItemWithVariantMeta),
            _variantGroupId: built.variantGroupId,
          });
        } catch (err) {
          ondcLogger.warn('Item build failed for RET10', {
            storeId: store.id,
            productId: row.product_id,
            variantId: row.variant_id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (builtItems.length === 0) continue;

      const { items, categories } = applyVariantGrouping(builtItems);

      const providerInfo: ProviderBuildInfo = {
        provider_id: providerId,
        name: store.name,
        short_desc: store.description?.slice(0, 200) ?? '',
        long_desc: store.description ?? '',
        logo_url: store.logo ?? null,
        banner_url: store.banner ?? null,
        fssai_license: null,
        support_phone: store.phone,
        support_email: store.email,
        updated_at: new Date(),
      };

      const entry = buildProviderEntry(
        providerInfo,
        items,
        RET10_DOMAIN,
        ondcLocations,
        categories,
      ) as Record<string, any>;

      // ── RET10 provider-level normalization ──────────────────────────────
      const window = resolveLocationWindow();

      const entryLocations = Array.isArray(entry['locations'])
        ? (entry['locations'] as Array<Record<string, any>>)
        : [];
      entry['locations'] = entryLocations.map((loc) => normalizeRet10Location(loc, window));

      const primaryLocationId = String(entryLocations[0]?.['id'] ?? locationId);

      const nonTimingTags = (Array.isArray(entry['tags']) ? entry['tags'] : []).filter(
        (tag: { code?: unknown }) => String(tag?.code ?? '') !== 'timing',
      );
      entry['tags'] = [...buildRet10TimingTags(primaryLocationId, window), ...nonTimingTags];

      // `categories` carries variant groups only. None of the ODOP grocery
      // products are variant-grouped, so the block is dropped rather than
      // shipping an empty placeholder group no item references.
      if (categories.length === 0) delete entry['categories'];

      providers.push(entry);
    }

    return {
      'bpp/descriptor': buildBppDescriptor(),
      'bpp/fulfillments': buildBppFulfillments(),
      'bpp/providers': providers,
    };
  },
};
