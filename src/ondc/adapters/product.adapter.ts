/**
 * Product Adapter — builds ONDC items live from ondc_odop_db (no cache).
 *
 * One ONDC item is emitted per:
 *   - leaf variant   (product_variants row with no children)        → id = prod_<pid>_var_<vid>
 *   - standalone     (product with no product_variants rows at all) → id = prod_<pid>
 *
 * Mirrors the PHP reference (preprod_v1/lib.php :: db_products_expand_with_variants).
 */

import { ondcQuery } from '~/lib/ondcSql';
import categoryRules from '~/ondc/config/categoryRules.json' with { type: 'json' };
import { ondcEnv } from '~/config/ondc.config';
import { SELLER_PROFILE } from '~/ondc/config/constants';
import { buildOndcItem, type ItemTagInputs } from '~/ondc/utils/catalog.builders';
import { getDomainConfig, type OndcRetailDomain } from '~/ondc/config/domain.config';
import type { OndcItem } from '~/ondc/types/ondc.types';

interface CategoryRule {
  internal_category_id: number;
  ondc_domain: string;
  ondc_category_id: string;
}
interface CategoryRulesJson {
  mappings: CategoryRule[];
  default: { ondc_domain: string; ondc_category_id: string };
}
const rules = categoryRules as CategoryRulesJson;

// ─── Item ID helpers ───────────────────────────────────────────────────────

export function buildOndcItemId(productId: number, variantId: number | null): string {
  return variantId ? `prod_${productId}_var_${variantId}` : `prod_${productId}`;
}

export function parseOndcItemId(
  itemId: string,
): { productId: number; variantId: number | null } | null {
  const withVar = /^prod_(\d+)_var_(\d+)$/.exec(itemId);
  if (withVar)
    return { productId: parseInt(withVar[1]!, 10), variantId: parseInt(withVar[2]!, 10) };
  const justProd = /^prod_(\d+)$/.exec(itemId);
  if (justProd) return { productId: parseInt(justProd[1]!, 10), variantId: null };
  return null;
}

// ─── Row shape consumed by item builder ────────────────────────────────────

export interface OndcCatalogRow {
  product_id: number;
  variant_id: number | null;
  store_id: number;
  name: string;
  description: string | null;
  price: number;
  mrp: number;
  stock: number;
  category_id: number | null;
  category_name: string | null;
  category_domain: string | null;
  ondc_subcategory: string | null;
  weight_g: number | null;
  unit_type: string | null;
  unit_count: number | null;
  brand: string | null;
  manufacturer_name: string | null;
  manufacturer_address: string | null;
  manufacturing_month: string | null;
  country_of_origin: string | null;
  return_days_window: number | null;
  seller_pickup_return: boolean;
  is_cod_available: boolean;
  time_to_ship_value: number | null;
  time_to_ship_unit: string | null;
  cancellable_enum: string | null;
  returnable_enum: string | null;
  gst_percent: number;
  hsn_sac_code: string | null;
  /** Manual out-of-stock override (products.force_out_of_stock). */
  force_out_of_stock: boolean;
  sku: string | null;
  gtin_ean: string | null;
  variant_attribute_value: string | null;
  variant_level_name: string | null;
  /** Raw product_variants.variant_name (used as a colour fallback for grouping). */
  variant_name: string | null;
  color_code: string | null;
  /** Merged product-level + variant-chain ondc attributes (keyed by attribute_key). */
  ondc_attrs: Record<string, { value: string; color_name: string | null }>;
  /** Image URLs (already absolute). Product-level images unless variant has its own. */
  images: string[];
  /** true if this product has any variants in product_variants. Used by item id resolver. */
  has_variants: boolean;
  /** Persisted item rating normalized to ONDC's 1-5 integer scale. */
  item_rating: string;
}

interface ProductBaseRow {
  id: number;
  store_id: number;
  product_name: string;
  description: string | null;
  default_price: number | null;
  mrp: number | null;
  stock: number | null;
  category_id: number | null;
  category_name: string | null;
  category_domain: string | null;
  ondc_subcategory: string | null;
  product_weight_gm: number | null;
  unit_type: string | null;
  unit_count: number | null;
  brand: string | null;
  manufacturer_name: string | null;
  manufacturer_address: string | null;
  manufacturing_month: string | null;
  country_of_origin: string | null;
  return_days_window: number | null;
  seller_pickup_return: number | null;
  is_cod_available: number | null;
  time_to_ship_value: number | null;
  time_to_ship_unit: string | null;
  cancellable: string | null;
  returnable: string | null;
  gst_percent: number | null;
  hsn_sac_code: string | null;
  force_out_of_stock: number | null;
}

interface VariantBaseRow {
  id: number;
  product_id: number;
  parent_variant_id: number | null;
  attribute_value: string | null;
  level_name: string | null;
  variant_name: string | null;
  sku: string | null;
  gtin_ean: string | null;
  price: number | null;
  mrp: number | null;
  unit_count: number | null;
  unit_type: string | null;
  product_weight_gm: number | null;
  color_code: string | null;
}

interface OndcAttrRow {
  product_id: number;
  variant_id: number | null;
  attribute_key: string;
  attribute_value: string | null;
  color_name: string | null;
}

interface ItemRatingRow {
  rated_id: string;
  rating_value: number | null;
}

const PRODUCT_SELECT = `
  p.id,
  p.store_id,
  p.product_name,
  p.description,
  p.default_price,
  p.mrp,
  p.stock,
  p.category_id,
  c.name             AS category_name,
  c.domain           AS category_domain,
  p.ondc_subcategory,
  p.product_weight_gm,
  p.unit_type,
  p.unit_count,
  p.brand,
  p.manufacturer_name,
  p.manufacturer_address,
  p.manufacturing_month,
  p.country_of_origin,
  p.return_days_window,
  p.seller_pickup_return,
  p.is_cod_available,
  p.time_to_ship_value,
  p.time_to_ship_unit,
  p.cancellable,
  p.returnable,
  p.gst_percent,
  p.hsn_sac_code,
  p.force_out_of_stock`;

// ─── Row fetchers ──────────────────────────────────────────────────────────

/**
 * Fetch all published products for a store, expanded into one row per leaf
 * variant (or one row per product if no variants exist).
 */
export async function fetchOndcCatalogRows(storeId: number): Promise<OndcCatalogRow[]> {
  const products = await ondcQuery<ProductBaseRow>(
    `SELECT ${PRODUCT_SELECT}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.store_id = ? AND p.publish_status = 'publish'
     ORDER BY p.id ASC`,
    [storeId],
  );
  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const inPlaceholders = productIds.map(() => '?').join(',');

  const variantRows = await ondcQuery<VariantBaseRow>(
    `SELECT id, product_id, parent_variant_id, attribute_value, level_name,
            variant_name, sku, gtin_ean, price, mrp, unit_count, unit_type,
            product_weight_gm, color_code
     FROM product_variants
     WHERE product_id IN (${inPlaceholders}) AND COALESCE(is_active, 1) = 1
     ORDER BY product_id ASC, id ASC`,
    productIds,
  );

  const attrRows = await ondcQuery<OndcAttrRow>(
    `SELECT product_id, variant_id, attribute_key, attribute_value, color_name
     FROM product_ondc_attributes
     WHERE product_id IN (${inPlaceholders})
     ORDER BY product_id ASC, sort_order ASC, id ASC`,
    productIds,
  );

  const productImages = await ondcQuery<{ product_id: number; image_url: string }>(
    `SELECT product_id, image_url FROM product_images
     WHERE product_id IN (${inPlaceholders})
     ORDER BY sort_order ASC, id ASC`,
    productIds,
  );

  const variantIds = variantRows.map((v) => v.id);
  const variantImages =
    variantIds.length > 0
      ? await ondcQuery<{ variant_id: number; image_url: string }>(
          `SELECT variant_id, image_url FROM variant_images
         WHERE variant_id IN (${variantIds.map(() => '?').join(',')})
         ORDER BY sort_order ASC, id ASC`,
          variantIds,
        )
      : [];

  const rows = assembleRows(products, variantRows, attrRows, productImages, variantImages);
  return attachItemRatings(rows);
}

/** Resolve a single ONDC item id to the row that produced it (or null). */
export async function resolveOndcCatalogRow(itemId: string): Promise<OndcCatalogRow | null> {
  const parts = parseOndcItemId(itemId);
  if (!parts) return null;

  const products = await ondcQuery<ProductBaseRow>(
    `SELECT ${PRODUCT_SELECT}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.publish_status = 'publish'
     LIMIT 1`,
    [parts.productId],
  );
  if (products.length === 0) return null;

  const variantRows = await ondcQuery<VariantBaseRow>(
    `SELECT id, product_id, parent_variant_id, attribute_value, level_name,
            variant_name, sku, gtin_ean, price, mrp, unit_count, unit_type,
            product_weight_gm, color_code
     FROM product_variants
     WHERE product_id = ? AND COALESCE(is_active, 1) = 1
     ORDER BY id ASC`,
    [parts.productId],
  );

  const attrRows = await ondcQuery<OndcAttrRow>(
    `SELECT product_id, variant_id, attribute_key, attribute_value, color_name
     FROM product_ondc_attributes
     WHERE product_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [parts.productId],
  );

  const productImages = await ondcQuery<{ product_id: number; image_url: string }>(
    `SELECT product_id, image_url FROM product_images
     WHERE product_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [parts.productId],
  );

  const variantImages = parts.variantId
    ? await ondcQuery<{ variant_id: number; image_url: string }>(
        `SELECT variant_id, image_url FROM variant_images
         WHERE variant_id = ?
         ORDER BY sort_order ASC, id ASC`,
        [parts.variantId],
      )
    : [];

  const allRows = assembleRows(products, variantRows, attrRows, productImages, variantImages);
  const ratedRows = await attachItemRatings(allRows);
  return ratedRows.find((r) => r.variant_id === parts.variantId) ?? null;
}

async function attachItemRatings(rows: OndcCatalogRow[]): Promise<OndcCatalogRow[]> {
  if (rows.length === 0) return rows;

  const itemIds = rows.map((row) => buildOndcItemId(row.product_id, row.variant_id));
  const defaults = rows.map((row) => ({ ...row, item_rating: '4' }));
  const placeholders = itemIds.map(() => '?').join(',');

  try {
    const ratingRows = await ondcQuery<ItemRatingRow>(
      `SELECT rated_id, AVG(rating_value) AS rating_value
       FROM ondc_ratings
       WHERE rating_category = 'Item'
         AND rating_value IS NOT NULL
         AND rated_id IN (${placeholders})
       GROUP BY rated_id`,
      itemIds,
    );

    const ratingsByItemId = new Map<string, string>();
    for (const ratingRow of ratingRows) {
      const normalized = normalizeItemRating(ratingRow.rating_value);
      if (normalized) ratingsByItemId.set(ratingRow.rated_id, normalized);
    }

    return defaults.map((row) => ({
      ...row,
      item_rating: ratingsByItemId.get(buildOndcItemId(row.product_id, row.variant_id)) ?? '4',
    }));
  } catch {
    return defaults;
  }
}

// ─── Row assembly (variant expansion + attr/image merging) ─────────────────

function assembleRows(
  products: ProductBaseRow[],
  variants: VariantBaseRow[],
  attrs: OndcAttrRow[],
  productImages: { product_id: number; image_url: string }[],
  variantImages: { variant_id: number; image_url: string }[],
): OndcCatalogRow[] {
  // Group attributes
  const attrsByProduct = new Map<
    number,
    Record<string, { value: string; color_name: string | null }>
  >();
  const attrsByVariant = new Map<
    number,
    Record<string, { value: string; color_name: string | null }>
  >();
  for (const a of attrs) {
    const target = a.variant_id ? attrsByVariant : attrsByProduct;
    const key = a.variant_id ?? a.product_id;
    const bucket = target.get(key) ?? {};
    if (!bucket[a.attribute_key]) {
      bucket[a.attribute_key] = { value: a.attribute_value ?? '', color_name: a.color_name };
    }
    target.set(key, bucket);
  }

  // Group images
  const productImageMap = new Map<number, string[]>();
  for (const r of productImages) {
    const arr = productImageMap.get(r.product_id) ?? [];
    arr.push(r.image_url);
    productImageMap.set(r.product_id, arr);
  }
  const variantImageMap = new Map<number, string[]>();
  for (const r of variantImages) {
    const arr = variantImageMap.get(r.variant_id) ?? [];
    arr.push(r.image_url);
    variantImageMap.set(r.variant_id, arr);
  }

  // Group variants
  const variantsByProduct = new Map<number, VariantBaseRow[]>();
  const variantById = new Map<number, VariantBaseRow>();
  const childrenByParent = new Map<number, number[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
    variantById.set(v.id, v);
    if (v.parent_variant_id) {
      const list = childrenByParent.get(v.parent_variant_id) ?? [];
      list.push(v.id);
      childrenByParent.set(v.parent_variant_id, list);
    }
  }

  const baseUrl = ondcEnv.baseUri.replace(/\/api\/v1\/ondc$/, '');
  const absolutize = (url: string): string =>
    url.startsWith('http') ? url : `${baseUrl}/uploads/${url}`;

  const out: OndcCatalogRow[] = [];

  for (const p of products) {
    const productVariants = variantsByProduct.get(p.id) ?? [];
    const leafVariants = productVariants.filter((v) => !childrenByParent.has(v.id));
    const hasVariants = productVariants.length > 0;
    const productAttrs = attrsByProduct.get(p.id) ?? {};
    const productImgs = (productImageMap.get(p.id) ?? []).map(absolutize);

    if (leafVariants.length === 0) {
      // Standalone product — emit one row
      out.push(buildRowForProduct(p, productAttrs, productImgs, hasVariants));
      continue;
    }

    for (const leaf of leafVariants) {
      // Build attribute chain: product → ancestor variants → leaf
      const chainAttrs: Record<string, { value: string; color_name: string | null }> = {
        ...productAttrs,
      };
      const chainIds = ancestorChain(leaf.id, variantById);
      for (const chainId of chainIds) {
        const cv = attrsByVariant.get(chainId) ?? {};
        for (const k of Object.keys(cv)) chainAttrs[k] = cv[k]!;
      }

      const variantImgs = (variantImageMap.get(leaf.id) ?? []).map(absolutize);
      const finalImgs = variantImgs.length > 0 ? variantImgs : productImgs;

      out.push(buildRowForVariant(p, leaf, chainAttrs, finalImgs, hasVariants));
    }
  }

  return out;
}

function ancestorChain(leafId: number, variantById: Map<number, VariantBaseRow>): number[] {
  const chain: number[] = [];
  let curr: number | null = leafId;
  let guard = 0;
  while (curr !== null && guard++ < 20) {
    const v = variantById.get(curr);
    if (!v) break;
    chain.unshift(v.id);
    curr = v.parent_variant_id;
  }
  return chain;
}

function buildRowForProduct(
  p: ProductBaseRow,
  attrs: Record<string, { value: string; color_name: string | null }>,
  images: string[],
  hasVariants: boolean,
): OndcCatalogRow {
  const price = parseFloat(String(p.default_price ?? p.mrp ?? 0));
  const mrp = parseFloat(String(p.mrp ?? p.default_price ?? 0));
  return {
    product_id: p.id,
    variant_id: null,
    store_id: p.store_id,
    name: p.product_name,
    description: p.description,
    price,
    mrp,
    stock: parseInt(String(p.stock ?? 0), 10),
    category_id: p.category_id,
    category_name: p.category_name,
    category_domain: p.category_domain ?? null,
    ondc_subcategory: p.ondc_subcategory ?? null,
    weight_g: p.product_weight_gm ? parseFloat(String(p.product_weight_gm)) : null,
    unit_type: p.unit_type,
    unit_count: p.unit_count ? parseFloat(String(p.unit_count)) : null,
    brand: p.brand,
    manufacturer_name: p.manufacturer_name,
    manufacturer_address: p.manufacturer_address,
    manufacturing_month: p.manufacturing_month,
    country_of_origin: p.country_of_origin,
    return_days_window: p.return_days_window ? parseInt(String(p.return_days_window), 10) : null,
    seller_pickup_return: Boolean(p.seller_pickup_return),
    is_cod_available: p.is_cod_available !== 0,
    time_to_ship_value: p.time_to_ship_value ? parseInt(String(p.time_to_ship_value), 10) : null,
    time_to_ship_unit: p.time_to_ship_unit,
    cancellable_enum: p.cancellable ?? 'DEFAULT',
    returnable_enum: p.returnable ?? 'DEFAULT',
    gst_percent: p.gst_percent ? parseFloat(String(p.gst_percent)) : 0,
    hsn_sac_code: p.hsn_sac_code ?? null,
    force_out_of_stock: Boolean(p.force_out_of_stock),
    sku: null,
    gtin_ean: null,
    variant_attribute_value: null,
    variant_level_name: null,
    variant_name: null,
    color_code: null,
    ondc_attrs: attrs,
    images,
    has_variants: hasVariants,
    item_rating: '4',
  };
}

function buildRowForVariant(
  p: ProductBaseRow,
  v: VariantBaseRow,
  attrs: Record<string, { value: string; color_name: string | null }>,
  images: string[],
  hasVariants: boolean,
): OndcCatalogRow {
  const variantPrice = v.price ? parseFloat(String(v.price)) : null;
  const variantMrp = v.mrp ? parseFloat(String(v.mrp)) : null;
  const productPrice = parseFloat(String(p.default_price ?? p.mrp ?? 0));
  const productMrp = parseFloat(String(p.mrp ?? p.default_price ?? 0));

  const price = variantPrice && variantPrice > 0 ? variantPrice : productPrice;
  const mrp =
    variantMrp && variantMrp > 0
      ? variantMrp
      : variantPrice && variantPrice > 0
        ? variantPrice
        : productMrp;

  const unitCount =
    v.unit_count != null
      ? parseFloat(String(v.unit_count))
      : p.unit_count
        ? parseFloat(String(p.unit_count))
        : null;
  const stock = parseInt(String(p.stock ?? 0), 10);

  return {
    product_id: p.id,
    variant_id: v.id,
    store_id: p.store_id,
    name:
      // Only append the variant name when it adds information — sellers often
      // set variant_name = product_name, which produced ugly "X - X" names.
      v.variant_name &&
      v.variant_name.trim() !== '' &&
      v.variant_name.trim().toLowerCase() !==
        String(p.product_name ?? '')
          .trim()
          .toLowerCase()
        ? `${p.product_name} - ${v.variant_name}`
        : p.product_name,
    description: p.description,
    price,
    mrp,
    stock,
    category_id: p.category_id,
    category_name: p.category_name,
    category_domain: p.category_domain ?? null,
    ondc_subcategory: p.ondc_subcategory ?? null,
    weight_g: v.product_weight_gm
      ? parseFloat(String(v.product_weight_gm))
      : p.product_weight_gm
        ? parseFloat(String(p.product_weight_gm))
        : null,
    unit_type: v.unit_type ?? p.unit_type,
    unit_count: unitCount,
    brand: p.brand,
    manufacturer_name: p.manufacturer_name,
    manufacturer_address: p.manufacturer_address,
    manufacturing_month: p.manufacturing_month,
    country_of_origin: p.country_of_origin,
    return_days_window: p.return_days_window ? parseInt(String(p.return_days_window), 10) : null,
    seller_pickup_return: Boolean(p.seller_pickup_return),
    is_cod_available: p.is_cod_available !== 0,
    time_to_ship_value: p.time_to_ship_value ? parseInt(String(p.time_to_ship_value), 10) : null,
    time_to_ship_unit: p.time_to_ship_unit,
    cancellable_enum: p.cancellable ?? 'DEFAULT',
    returnable_enum: p.returnable ?? 'DEFAULT',
    gst_percent: p.gst_percent ? parseFloat(String(p.gst_percent)) : 0,
    hsn_sac_code: p.hsn_sac_code ?? null,
    force_out_of_stock: Boolean(p.force_out_of_stock),
    sku: v.sku,
    gtin_ean: v.gtin_ean,
    variant_attribute_value: v.attribute_value,
    variant_level_name: v.level_name,
    variant_name: v.variant_name ?? null,
    color_code: v.color_code,
    ondc_attrs: attrs,
    images,
    has_variants: hasVariants,
    item_rating: '4',
  };
}

// ─── Category / domain resolution ──────────────────────────────────────────

/**
 * Normalize whatever sits in categories.domain (display name, short code, or
 * full ONDC code) into a canonical ONDC:RETxx string. Returns null when it
 * cannot be resolved — caller then falls back to mappings / JSON rules.
 */
/**
 * Only RET10 (Grocery), RET12 (Fashion / Handicrafts / Handloom / Jewellery)
 * and RET16 (Home & Kitchen / Home Decor) are supported by this BPP.
 * Everything else returns null so the caller can fall back to the JSON default.
 */
function normalizeOndcDomain(raw: string | null | undefined): OndcRetailDomain | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'ONDC:RET10' || upper === 'ONDC:RET12' || upper === 'ONDC:RET16') {
    return upper as OndcRetailDomain;
  }

  const key = trimmed.toLowerCase().replace(/[\s_&-]+/g, '');
  const lookup: Record<string, OndcRetailDomain> = {
    grocery: 'ONDC:RET10',
    fashion: 'ONDC:RET12',
    apparel: 'ONDC:RET12',
    clothing: 'ONDC:RET12',
    handicrafts: 'ONDC:RET12',
    handloom: 'ONDC:RET12',
    jewellery: 'ONDC:RET12',
    homekitchen: 'ONDC:RET16',
    homeandkitchen: 'ONDC:RET16',
    homedecor: 'ONDC:RET16',
  };
  return lookup[key] ?? null;
}

/** Minimal shape needed to resolve a product's real ONDC domain/category —
 * a subset of OndcCatalogRow so select/init/confirm's lighter row types
 * (which don't carry price/images/etc) can be domain-checked too. */
export interface DomainResolvableRow {
  product_id: number;
  category_id: number | null;
  category_name: string | null;
  category_domain: string | null;
  ondc_subcategory: string | null;
}

/**
 * Resolve a product's REAL ONDC domain (from categories.domain →
 * ondc_category_mappings → categoryRules.json → category name → default).
 * This is the single source of truth for "what domain does this product
 * actually belong to" — /select, /init, /confirm must cross-check their
 * incoming ctx.domain against this before accepting an item_id, exactly as
 * /on_search already does via buildOndcItemFromRow.
 */
export async function resolveOndcCategory(
  row: DomainResolvableRow,
): Promise<{ domain: OndcRetailDomain; categoryId: string }> {
  if (row.category_domain && row.ondc_subcategory) {
    const dom = normalizeOndcDomain(row.category_domain);
    if (dom) return { domain: dom, categoryId: row.ondc_subcategory };
  }

  // ondc_category_mappings.ondc_category_id is an FK to ondc_categories.id;
  // join through to get the canonical ondc_category_code that goes into payloads.
  // ondc_category_mappings.domain is populated out-of-band and can be NULL —
  // prefer the joined ondc_categories.domain (the category the resolved code
  // actually belongs to) over the JSON default before falling all the way
  // back, so a NULL mapping.domain never produces a categoryId/domain pair
  // that don't correspond to the same category.
  const dbRows = await ondcQuery<{
    domain: string | null;
    category_table_domain: string | null;
    category_code: string | null;
  }>(
    `SELECT ocm.domain AS domain, oc.domain AS category_table_domain,
            oc.ondc_category_code AS category_code
     FROM ondc_category_mappings ocm
     LEFT JOIN ondc_categories oc ON oc.id = ocm.ondc_category_id
     WHERE ocm.product_id = ? AND ocm.ondc_category_id IS NOT NULL
     LIMIT 1`,
    [row.product_id],
  );
  if (dbRows[0]?.category_code) {
    const dom =
      normalizeOndcDomain(dbRows[0].domain) ??
      normalizeOndcDomain(dbRows[0].category_table_domain) ??
      (rules.default.ondc_domain as OndcRetailDomain);
    return { domain: dom, categoryId: dbRows[0].category_code };
  }

  if (row.category_id !== null) {
    const match = rules.mappings.find((r) => r.internal_category_id === row.category_id);
    if (match) {
      const dom =
        normalizeOndcDomain(match.ondc_domain) ?? (rules.default.ondc_domain as OndcRetailDomain);
      return { domain: dom, categoryId: match.ondc_category_id };
    }
  }

  // Try category_name as a last resort before defaulting
  const fallbackDom = normalizeOndcDomain(row.category_name);
  if (fallbackDom) {
    // rules.default.ondc_category_id ("Handicrafts") only belongs to
    // ONDC:RET12 — using it verbatim here would reproduce the same
    // domain/categoryId inconsistency the ondc_category_mappings branch
    // above was fixed for, whenever category_name resolves to a different
    // domain (e.g. RET10/RET16). Prefer a category_id from rules.mappings
    // that's actually paired with fallbackDom before falling back to the
    // domain-agnostic default.
    const domainMatch = rules.mappings.find(
      (r) => normalizeOndcDomain(r.ondc_domain) === fallbackDom,
    );
    return {
      domain: fallbackDom,
      categoryId:
        row.ondc_subcategory ?? domainMatch?.ondc_category_id ?? rules.default.ondc_category_id,
    };
  }

  return {
    domain: rules.default.ondc_domain as OndcRetailDomain,
    categoryId: rules.default.ondc_category_id,
  };
}

// ─── Item builder (row → ONDC item) ────────────────────────────────────────

export interface BuiltOndcItem {
  item: OndcItem;
  domain: OndcRetailDomain;
  /** Variant group key — items sharing this key are siblings. Empty for standalone. */
  variantGroupId: string;
}

function buildTimeToShip(value: number | null, unit: string | null, fallback: string): string {
  if (!value || !unit) return fallback;
  switch (unit.toUpperCase()) {
    case 'MINUTES':
      return `PT${value}M`;
    case 'HOURS':
      return `PT${value}H`;
    case 'DAYS':
      return `P${value}D`;
    default:
      return fallback;
  }
}

function buildReturnWindow(days: number | null, fallback: string): string {
  if (!days || days <= 0) return fallback;
  return `P${days}D`;
}

function attrValue(attrs: OndcCatalogRow['ondc_attrs'], key: string): string | undefined {
  const a = attrs[key];
  if (!a) return undefined;
  if (key === 'colour' && a.color_name) return a.color_name;
  return a.value || undefined;
}

function normalizeItemRating(raw?: number | string | null): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 5) return undefined;
  return String(rounded);
}

function formatManufacturingMonth(raw?: string | null): string {
  const value = raw?.trim();
  if (!value) {
    const now = new Date();
    return `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;
  }
  if (/^NA$/i.test(value)) return 'NA';

  const mmYyyy = /^(\d{2})\/(\d{4})$/.exec(value);
  if (mmYyyy) return `${mmYyyy[1]}/${mmYyyy[2]}`;

  const yyyyMm = /^(\d{4})-(\d{2})$/.exec(value);
  if (yyyyMm) return `${yyyyMm[2]}/${yyyyMm[1]}`;

  const yyyyMmDd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (yyyyMmDd) return `${yyyyMmDd[2]}/${yyyyMmDd[1]}`;

  return value;
}

export async function buildOndcItemFromRow(
  row: OndcCatalogRow,
  ctx: {
    providerId: string;
    locationId: string;
    fulfillmentId: string;
    storeName?: string | null;
    storeEmail?: string | null;
    storePhone?: string | null;
  },
): Promise<BuiltOndcItem> {
  const { domain, categoryId } = await resolveOndcCategory(row);
  const cfg = getDomainConfig(domain);

  const baseUrl = ondcEnv.baseUri.replace(/\/api\/v1\/ondc$/, '');
  const images = row.images.length > 0 ? row.images : [`${baseUrl}/logo.png`];

  const ondcItemId = buildOndcItemId(row.product_id, row.variant_id);

  const isReturnable =
    row.returnable_enum === 'YES' ||
    (row.returnable_enum === 'DEFAULT' && cfg.defaultReturnWindow !== 'PT0H');
  const isCancellable = row.cancellable_enum !== 'NO';

  const returnWindow = buildReturnWindow(row.return_days_window, cfg.defaultReturnWindow);
  const timeToShip = buildTimeToShip(
    row.time_to_ship_value,
    row.time_to_ship_unit,
    cfg.defaultTimeToShip,
  );

  const brand = row.brand ?? attrValue(row.ondc_attrs, 'brand') ?? SELLER_PROFILE.BRAND_NAME;
  const mfgName =
    row.manufacturer_name ??
    attrValue(row.ondc_attrs, 'manufacturer_name') ??
    SELLER_PROFILE.COMPANY_NAME;
  const mfgAddress =
    row.manufacturer_address ??
    attrValue(row.ondc_attrs, 'manufacturer_address') ??
    `${SELLER_PROFILE.STREET}, ${SELLER_PROFILE.CITY}, ${SELLER_PROFILE.STATE} ${SELLER_PROFILE.AREA_CODE}`;
  const mfgMonth = formatManufacturingMonth(
    row.manufacturing_month ?? attrValue(row.ondc_attrs, 'month_year_of_mfg'),
  );
  const origin = row.country_of_origin ?? attrValue(row.ondc_attrs, 'origin_country') ?? 'IND';

  // Colour resolution: structured ondc attribute → variant color_code → fallback.
  // Fallback: when a variant carries no structured colour but has a distinct
  // variant_name (e.g. "carousel pink"), use it so variant grouping still works
  // without per-variant attributes seeded. Skips empty / "Default" names AND
  // names that just repeat the product name (would emit colour = product name).
  const vName = row.variant_name?.trim();
  const productNameLower = String(row.name ?? '')
    .trim()
    .toLowerCase();
  const colour =
    attrValue(row.ondc_attrs, 'colour') ??
    row.color_code ??
    (row.variant_id !== null &&
    vName &&
    vName.toLowerCase() !== 'default' &&
    vName.toLowerCase() !== productNameLower
      ? vName
      : undefined);
  const sizeFromVariant =
    row.variant_level_name && row.variant_level_name.toLowerCase().includes('size')
      ? (row.variant_attribute_value ?? undefined)
      : undefined;
  const size = attrValue(row.ondc_attrs, 'size') ?? sizeFromVariant;

  const attrs: Omit<ItemTagInputs, 'domain'> = {
    brand,
    colour,
    size,
    gender: attrValue(row.ondc_attrs, 'gender'),
    material: attrValue(row.ondc_attrs, 'material'),
    originCountry: origin,
    packagedCommodity: {
      manufacturerOrPackerName: mfgName,
      manufacturerOrPackerAddress: mfgAddress,
      // common/generic commodity name = the product's category (categories.name)
      commonOrGenericNameOfCommodity: row.category_name ?? row.name,
      monthYearOfManufacture: mfgMonth,
    },
  };
  if (cfg.requiresVegNonveg) {
    attrs.isVeg = attrValue(row.ondc_attrs, 'veg_nonveg') !== 'non_veg';
  }
  if (cfg.requiresFoodStatutory) {
    attrs.prepackagedFood = {
      brandOwnerName: attrValue(row.ondc_attrs, 'brand_owner_name') ?? SELLER_PROFILE.COMPANY_NAME,
      brandOwnerFssaiLicense: attrValue(row.ondc_attrs, 'brand_owner_fssai_license') ?? '',
      nutritionalInfo: attrValue(row.ondc_attrs, 'nutritional_info') ?? '',
      additivesInfo: attrValue(row.ondc_attrs, 'additives_info') ?? '',
      netQuantity:
        attrValue(row.ondc_attrs, 'net_quantity') ??
        (row.weight_g ? `${row.weight_g} ${row.unit_type ?? 'g'}` : ''),
    };
  }

  const unit = row.weight_g ? { unit: 'gram', value: String(row.weight_g) } : undefined;

  // descriptor.code in "type:code" form (1-EAN, 2-ISBN, 3-GTIN, 4-HSN, 5-other).
  // Prefer HSN (products.hsn_sac_code → type 4); fall back to variant GTIN/EAN (type 3).
  const idCode = row.hsn_sac_code
    ? `4:${row.hsn_sac_code}`
    : row.gtin_ean
      ? `3:${row.gtin_ean}`
      : undefined;

  const item = buildOndcItem({
    productId: row.product_id,
    ondcItemId,
    name: row.name,
    shortDesc: (row.description ?? row.name).slice(0, 200),
    longDesc: row.description ?? '',
    images,
    price: row.price,
    mrp: row.mrp || row.price,
    stock: row.stock,
    categoryCode: categoryId,
    domain,
    fulfillmentId: ctx.fulfillmentId,
    locationId: ctx.locationId,
    returnable: isReturnable,
    cancellable: isCancellable,
    returnWindow,
    timeToShip,
    sellerPickupReturn: row.seller_pickup_return,
    availableOnCod: row.is_cod_available,
    // Consumer-care = seller's store contact (stores.store_name, support_email, support_phone),
    // falling back to the platform support profile when a store field is missing.
    consumerCareContact: [
      ctx.storeName ?? SELLER_PROFILE.SUPPORT_NAME,
      ctx.storeEmail ?? SELLER_PROFILE.SUPPORT_EMAIL,
      ctx.storePhone ?? SELLER_PROFILE.SUPPORT_PHONE,
    ].join(','),
    rating: row.item_rating,
    attributes: attrs,
    unit,
    idCode,
    outOfStock: row.force_out_of_stock,
  }) as OndcItem;

  // Variant group: PHP uses 'VG-<product_id>' for all variants of one product.
  // Standalone products (no variants) get '' so the grouping pass strips them.
  const variantGroupId = row.has_variants && row.variant_id !== null ? `VG-${row.product_id}` : '';

  return { item, domain, variantGroupId };
}
