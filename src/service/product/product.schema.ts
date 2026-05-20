import { z } from 'zod';
import { UNIT_TYPE_VALUES, normalizeUnitTypeInput } from './product.unitType';

export { UNIT_TYPE_OPTIONS, UNIT_TYPE_VALUES } from './product.unitType';

/** HTTP(S), app-relative path, or S3 storage ref (`s3:object/key`) stored in DB. */
const imageUrlAllowed = (s: string) =>
  s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/') || s.startsWith('s3:');

const unitTypeSchema = z.preprocess(normalizeUnitTypeInput, z.enum(UNIT_TYPE_VALUES).optional());

/** Maps Postman / previous API snake_case keys to our DTO shape */
export function normalizeSellerProductBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const n: Record<string, unknown> = { ...r };
  if (n.productName == null && r.product_name != null) n.productName = r.product_name;
  if (n.categoryId == null && r.category_id != null) n.categoryId = r.category_id;
  if (n.defaultPrice == null && r.default_price != null) n.defaultPrice = r.default_price;
  if (n.aliasSlug === undefined && r.alias_slug !== undefined) n.aliasSlug = r.alias_slug;
  if (n.publishStatus == null && r.publish_status != null) n.publishStatus = r.publish_status;
  if (n.publishStatus == null && r.is_published === true) n.publishStatus = 'publish';
  if (n.publishStatus == null && r.is_published === false) n.publishStatus = 'draft';
  if (n.hsnSacCode == null && r.hsn_sac_code != null) n.hsnSacCode = r.hsn_sac_code;
  if (n.gstPercent == null && r.gst_percent != null) n.gstPercent = r.gst_percent;
  if (n.gtinEan == null && r.gtin_ean != null) n.gtinEan = r.gtin_ean;
  if (n.stock == null && r.stock != null) n.stock = r.stock;
  if (n.forceOutOfStock == null && r.force_out_of_stock != null)
    n.forceOutOfStock = r.force_out_of_stock;
  if (n.unitCount == null && r.unit_count != null) n.unitCount = r.unit_count;
  if (n.unitType == null && r.unit_type != null) n.unitType = normalizeUnitTypeInput(r.unit_type);
  if (n.countryOfOrigin == null && r.country_of_origin != null)
    n.countryOfOrigin = r.country_of_origin;
  if (n.returnDaysWindow == null && r.return_days_window != null)
    n.returnDaysWindow = r.return_days_window;
  if (n.sellerPickupReturn == null && r.seller_pickup_return != null)
    n.sellerPickupReturn = r.seller_pickup_return;
  if (n.isCodAvailable == null && r.is_cod_available != null) n.isCodAvailable = r.is_cod_available;
  if (n.isManufacturer == null && r.is_manufacturer != null) n.isManufacturer = r.is_manufacturer;
  if (n.manufacturerName == null && r.manufacturer_name != null)
    n.manufacturerName = r.manufacturer_name;
  if (n.manufacturerAddress == null && r.manufacturer_address != null)
    n.manufacturerAddress = r.manufacturer_address;
  if (n.minPurchaseLimit == null && r.min_purchase_limit != null)
    n.minPurchaseLimit = r.min_purchase_limit;
  if (n.maxPurchaseLimit == null && r.max_purchase_limit != null)
    n.maxPurchaseLimit = r.max_purchase_limit;
  if (n.standardPackageQty == null && r.standard_package_qty != null)
    n.standardPackageQty = r.standard_package_qty;
  if (n.lowStockQty == null && r.low_stock_qty != null) n.lowStockQty = r.low_stock_qty;
  if (n.seoTitle == null && r.seo_title != null) n.seoTitle = r.seo_title;
  if (n.seoDescription == null && r.seo_description != null) n.seoDescription = r.seo_description;
  if (n.seoKeywords == null && r.seo_keywords != null) n.seoKeywords = r.seo_keywords;
  if (n.disableForBots == null && r.disable_for_bots != null) n.disableForBots = r.disable_for_bots;
  if (n.timeToShipValue == null && r.time_to_ship_value != null)
    n.timeToShipValue = r.time_to_ship_value;
  if (n.timeToShipUnit == null && r.time_to_ship_unit != null)
    n.timeToShipUnit = r.time_to_ship_unit;
  if (r.careInstructions != null) n.instructions = r.careInstructions;
  if (r.care_instructions != null) n.instructions = r.care_instructions;
  if (n.sizeChartUrl == null && r.size_chart_url != null) n.sizeChartUrl = r.size_chart_url;
  if (n.giTag == null && r.gi_tag != null) n.giTag = r.gi_tag;
  if (n.silkMark == null && r.silk_mark != null) n.silkMark = r.silk_mark;
  if (n.haveOndcAttributes == null && r.have_ondc_attributes != null)
    n.haveOndcAttributes = r.have_ondc_attributes;
  if (n.productWeightGm == null && r.product_weight_gm != null)
    n.productWeightGm = r.product_weight_gm;
  if (n.productLengthCm == null && r.product_length_cm != null)
    n.productLengthCm = r.product_length_cm;
  if (n.productWidthCm == null && r.product_width_cm != null) n.productWidthCm = r.product_width_cm;
  if (n.productHeightCm == null && r.product_height_cm != null)
    n.productHeightCm = r.product_height_cm;
  if (n.packageWeightGm == null && r.package_weight_gm != null)
    n.packageWeightGm = r.package_weight_gm;
  if (n.packageLengthCm == null && r.package_length_cm != null)
    n.packageLengthCm = r.package_length_cm;
  if (n.packageWidthCm == null && r.package_width_cm != null) n.packageWidthCm = r.package_width_cm;
  if (n.packageHeightCm == null && r.package_height_cm != null)
    n.packageHeightCm = r.package_height_cm;
  if (n.packageWeightGm == null && r.shipping_pkg_weight_gm != null)
    n.packageWeightGm = r.shipping_pkg_weight_gm;
  if (n.packageLengthCm == null && r.shipping_pkg_length_cm != null)
    n.packageLengthCm = r.shipping_pkg_length_cm;
  if (n.packageWidthCm == null && r.shipping_pkg_width_cm != null)
    n.packageWidthCm = r.shipping_pkg_width_cm;
  if (n.packageHeightCm == null && r.shipping_pkg_height_cm != null)
    n.packageHeightCm = r.shipping_pkg_height_cm;
  if (n.ondcSubcategory == null && r.ondc_subcategory != null)
    n.ondcSubcategory = r.ondc_subcategory;
  if (n.productFilters == null && r.product_filters != null) n.productFilters = r.product_filters;
  return n;
}

export function normalizeVariantBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const n: Record<string, unknown> = { ...r };
  if (n.variantName == null && r.variant_name != null) n.variantName = r.variant_name;
  if (n.parentId == null && r.parentId !== undefined) n.parentId = r.parentId;
  if (n.parentId == null && r.parent_id !== undefined) n.parentId = r.parent_id;
  if (n.parentId == null && r.parentVariantId !== undefined) n.parentId = r.parentVariantId;
  if (n.parentId == null && r.parent_variant_id !== undefined) n.parentId = r.parent_variant_id;
  if (n.levelIndex == null && r.level_index != null) n.levelIndex = r.level_index;
  if (n.levelName == null && r.level_name != null) n.levelName = r.level_name;
  if (n.name == null && r.name != null) n.name = r.name;
  if (n.colorCode == null && r.color_code != null) n.colorCode = r.color_code;
  if (n.unitCount == null && r.unit_count != null) n.unitCount = r.unit_count;
  if (n.unitType == null && r.unit_type != null) n.unitType = normalizeUnitTypeInput(r.unit_type);
  if (n.gtinEan == null && r.gtin_ean != null) n.gtinEan = r.gtin_ean;
  if (n.productWeightGm == null && r.product_weight_gm != null)
    n.productWeightGm = r.product_weight_gm;
  if (n.productLengthCm == null && r.product_length_cm != null)
    n.productLengthCm = r.product_length_cm;
  if (n.productWidthCm == null && r.product_width_cm != null) n.productWidthCm = r.product_width_cm;
  if (n.productHeightCm == null && r.product_height_cm != null)
    n.productHeightCm = r.product_height_cm;
  if (n.shippingPkgWeightGm == null && r.shipping_pkg_weight_gm != null)
    n.shippingPkgWeightGm = r.shipping_pkg_weight_gm;
  if (n.shippingPkgLengthCm == null && r.shipping_pkg_length_cm != null)
    n.shippingPkgLengthCm = r.shipping_pkg_length_cm;
  if (n.shippingPkgWidthCm == null && r.shipping_pkg_width_cm != null)
    n.shippingPkgWidthCm = r.shipping_pkg_width_cm;
  if (n.shippingPkgHeightCm == null && r.shipping_pkg_height_cm != null)
    n.shippingPkgHeightCm = r.shipping_pkg_height_cm;
  if (n.minPurchaseLimit == null && r.min_purchase_limit != null)
    n.minPurchaseLimit = r.min_purchase_limit;
  if (n.maxPurchaseLimit == null && r.max_purchase_limit != null)
    n.maxPurchaseLimit = r.max_purchase_limit;
  if (n.standardPackageQty == null && r.standard_package_qty != null)
    n.standardPackageQty = r.standard_package_qty;
  if (n.stock == null && r.stock != null) n.stock = r.stock;
  if (n.stock == null && r.qty_on_hand != null) n.stock = r.qty_on_hand;
  if (n.stock == null && r.qtyOnHand != null) n.stock = r.qtyOnHand;
  return n;
}

export function normalizeInventoryBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const n: Record<string, unknown> = { ...r };
  if (n.variantId == null && r.variant_id != null) n.variantId = r.variant_id;
  if (n.storeLocationId == null && r.store_location_id != null)
    n.storeLocationId = r.store_location_id;
  if (n.qtyOnHand == null && r.qty_on_hand != null) n.qtyOnHand = r.qty_on_hand;
  if (n.qtyReserved == null && r.qty_reserved != null) n.qtyReserved = r.qty_reserved;
  return n;
}

function tryParseJsonValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s.startsWith('[') && !s.startsWith('{')) return value;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return value;
  }
}

// ─── JSON body helpers (used before zod) ─────────────────────────────
export function normalizeProductNestedInBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const b = { ...body };
  if (b.variants != null) b.variants = tryParseJsonValue(b.variants) ?? b.variants;
  if (b.images != null) b.images = tryParseJsonValue(b.images) ?? b.images;
  if (b.attributes != null) b.attributes = tryParseJsonValue(b.attributes) ?? b.attributes;
  if (b.ondcAttributes == null && b.ondc_attributes != null) b.ondcAttributes = b.ondc_attributes;
  if (b.ondcAttributes != null)
    b.ondcAttributes = tryParseJsonValue(b.ondcAttributes) ?? b.ondcAttributes;
  if (b.replaceVariantTree == null && b.replace_variant_tree != null) {
    const v = b.replace_variant_tree;
    b.replaceVariantTree = v === true || v === 'true' || v === 1 || v === '1';
  }
  if (b.removeVariantIds == null && b.remove_variant_ids != null) {
    b.removeVariantIds = b.remove_variant_ids;
  }
  if (b.removeVariantIds != null) {
    b.removeVariantIds = tryParseJsonValue(b.removeVariantIds) ?? b.removeVariantIds;
  }
  if (Array.isArray(b.images)) {
    b.images = b.images.map((item) => normalizeProductImageItem(item));
  }
  if (Array.isArray(b.variants)) {
    b.variants = b.variants.map((item) => normalizeEmbeddedVariantItem(item));
  }
  if (Array.isArray(b.attributes)) {
    b.attributes = b.attributes.map((item) => coerceProductAttributePayloadItem(item));
  }
  if (Array.isArray(b.ondcAttributes)) {
    b.ondcAttributes = b.ondcAttributes.map((item) => coerceOndcAttributePayloadItem(item));
  }
  return b;
}

/** Coerce one `attributes[]` item to `{ attributeKey, attributeValue? }` (DB: `product_attributes`). */
function coerceProductAttributePayloadItem(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const r = raw as Record<string, unknown>;
  const key = r.attributeKey ?? r.attribute_key;
  const out: { attributeKey?: string; attributeValue?: string | null } = {};
  if (key != null && String(key).trim() !== '') {
    out.attributeKey = String(key).trim();
  }
  const val = r.attributeValue ?? r.attribute_value;
  if (val !== undefined) {
    out.attributeValue = val === null || val === '' ? null : String(val);
  }
  return out;
}

function coerceOndcAttributePayloadItem(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const key = r.attributeKey ?? r.attribute_key;
  if (key != null && String(key).trim() !== '') out.attributeKey = String(key).trim();
  const val = r.attributeValue ?? r.attribute_value;
  if (val !== undefined) out.attributeValue = val === null || val === '' ? null : String(val);
  const colorName = r.colorName ?? r.color_name;
  if (colorName !== undefined)
    out.colorName = colorName === null || colorName === '' ? null : String(colorName);
  const sortOrder = r.sortOrder ?? r.sort_order;
  if (sortOrder !== undefined) out.sortOrder = sortOrder;
  return out;
}

/** One `images[]` item: snake_case / camelCase → shape expected by `productImagePayloadItemSchema` */
function normalizeProductImageItem(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const imageUrl = (r.imageUrl ?? r.image_url) as string | number | null | undefined;
  const out: Record<string, unknown> = {};
  if (imageUrl != null && imageUrl !== '') {
    out.imageUrl = String(imageUrl);
  }
  const alt = r.altText ?? r.alt_text;
  if (alt != null) out.altText = alt;
  if (r.sortOrder != null || r.sort_order != null) {
    out.sortOrder = r.sortOrder ?? r.sort_order;
  }
  return out;
}

/** One `variants[].images[]` item (maps to `variant_images`; no alt column) */
function normalizeVariantImageItem(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const imageUrl = (r.imageUrl ?? r.image_url) as string | number | null | undefined;
  const out: Record<string, unknown> = {};
  if (imageUrl != null && imageUrl !== '') {
    out.imageUrl = String(imageUrl);
  }
  if (r.sortOrder != null || r.sort_order != null) {
    out.sortOrder = r.sortOrder ?? r.sort_order;
  }
  return out;
}

/** One `variants[]` item: reuse variant snake_case + `id` / `variant_id` for update payloads */
function normalizeEmbeddedVariantItem(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const n = normalizeVariantBody(raw);
  if (n.id == null && r.id != null) n.id = r.id;
  if (n.id == null && (r as { variant_id?: unknown }).variant_id != null) {
    n.id = (r as { variant_id: unknown }).variant_id;
  }
  if (n.images != null) {
    const parsed = Array.isArray(n.images) ? n.images : tryParseJsonValue(n.images);
    n.images = Array.isArray(parsed) ? parsed.map((x) => normalizeVariantImageItem(x)) : n.images;
  }
  const attrs = n.ondcAttributes ?? (r as { ondc_attributes?: unknown }).ondc_attributes;
  if (attrs != null) {
    const parsed = Array.isArray(attrs) ? attrs : tryParseJsonValue(attrs);
    n.ondcAttributes = Array.isArray(parsed)
      ? parsed.map((x) => coerceOndcAttributePayloadItem(x))
      : attrs;
  }
  return n;
}

/** Per-variant gallery (`variant_images`). On create/update: omit key = leave unchanged; `[]` = clear; non-empty = replace order. */
const variantImagePayloadItemSchema = z
  .object({
    imageUrl: z
      .string()
      .min(1, 'imageUrl is required')
      .refine((s) => imageUrlAllowed(s), {
        message: 'imageUrl must be a URL, absolute path, or s3:object/key',
      }),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const variantImagesField = z.array(variantImagePayloadItemSchema).optional();

const ondcAttributePayloadItemSchema = z.preprocess(
  coerceOndcAttributePayloadItem,
  z
    .object({
      attributeKey: z.string().min(1, 'attributeKey is required').max(255),
      attributeValue: z.union([z.string().max(65535), z.null()]).optional(),
      colorName: z.union([z.string().max(255), z.null()]).optional(),
      sortOrder: z.coerce.number().int().min(0).optional(),
    })
    .strict(),
);

const ondcAttributesPayloadSchema = z.array(ondcAttributePayloadItemSchema);

/** Single sellable row (no hierarchy). */
export const flatVariantCreateSchema = z.object({
  variantName: z.string().min(1, 'Variant name is required').max(255),
  sku: z.string().min(1, 'SKU is required').max(255),
  price: z.coerce.number().positive('Price must be positive'),
  mrp: z.coerce.number().positive('MRP must be positive'),
  unitCount: z.coerce.number().optional(),
  unitType: unitTypeSchema,
  gtinEan: z.string().optional(),
  productWeightGm: z.coerce.number().int().optional(),
  productLengthCm: z.coerce.number().optional(),
  productWidthCm: z.coerce.number().optional(),
  productHeightCm: z.coerce.number().optional(),
  shippingPkgWeightGm: z.coerce.number().int().optional(),
  shippingPkgLengthCm: z.coerce.number().optional(),
  shippingPkgWidthCm: z.coerce.number().optional(),
  shippingPkgHeightCm: z.coerce.number().optional(),
  minPurchaseLimit: z.coerce.number().int().optional(),
  maxPurchaseLimit: z.coerce.number().int().optional(),
  standardPackageQty: z.coerce.number().int().optional(),
  images: variantImagesField,
  ondcAttributes: ondcAttributesPayloadSchema.optional(),
  /** Maps to `inventory.qty_on_hand` for this SKU (per default store location). */
  stock: z.coerce.number().int().min(0).optional(),
});

/**
 * Mrignayanee-style tree node shape (no leaf rules). Zod v4 forbids `.partial()` on schemas with
 * refinements, so refinements live only on `treeVariantCreateSchema`.
 */
export const treeVariantShapeSchema = z.object({
  id: z.string().min(1, 'Client variant id is required for tree nodes'),
  parentId: z.union([z.string(), z.null()]).optional(),
  levelIndex: z.coerce.number().int().min(0),
  levelName: z.string().max(255).optional(),
  name: z.string().min(1, 'name (attribute value at this level) is required').max(255),
  variantName: z.string().max(255).optional(),
  sku: z.union([z.string().max(255), z.literal('')]).optional(),
  price: z.coerce.number().positive().optional(),
  mrp: z.coerce.number().positive().optional(),
  unitCount: z.coerce.number().optional(),
  unitType: unitTypeSchema,
  gtinEan: z.string().optional(),
  productWeightGm: z.coerce.number().int().optional(),
  productLengthCm: z.coerce.number().optional(),
  productWidthCm: z.coerce.number().optional(),
  productHeightCm: z.coerce.number().optional(),
  shippingPkgWeightGm: z.coerce.number().int().optional(),
  shippingPkgLengthCm: z.coerce.number().optional(),
  shippingPkgWidthCm: z.coerce.number().optional(),
  shippingPkgHeightCm: z.coerce.number().optional(),
  minPurchaseLimit: z.coerce.number().int().optional(),
  maxPurchaseLimit: z.coerce.number().int().optional(),
  standardPackageQty: z.coerce.number().int().optional(),
  colorCode: z.string().max(255).optional(),
  images: variantImagesField,
  ondcAttributes: ondcAttributesPayloadSchema.optional(),
  /** Per-leaf qty on hand → `inventory` row (default store location). */
  stock: z.coerce.number().int().min(0).optional(),
});

/**
 * Mrignayanee-style tree node (UI: `id`, `parentId`, `levelIndex`, `levelName`, `name`).
 * Intermediate nodes: omit `sku` (or empty); leaf rows: `sku` + `price` + `mrp` required,
 * and `variantName` = full display name (e.g. `Cotton/Red/L`).
 */
export const treeVariantCreateSchema = treeVariantShapeSchema.superRefine((d, ctx) => {
  const skuTrim = d.sku != null ? String(d.sku).trim() : '';
  const isLeaf = skuTrim.length > 0;
  if (isLeaf) {
    const vn = d.variantName?.trim() ?? '';
    if (!vn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Leaf variants must send variantName as the full display name (e.g. Cotton/Red/L)',
        path: ['variantName'],
      });
    }
    if (d.price == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Leaf variants require price',
        path: ['price'],
      });
    }
    if (d.mrp == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Leaf variants require mrp',
        path: ['mrp'],
      });
    }
  }
});

/** Partial tree node for PATCH variant-by-id (no create-time leaf refinement). */
export const treeVariantUpdateSchema = treeVariantShapeSchema.partial();

// Create Variant Schema (flat sellable row OR tree node)
export const createVariantSchema = z.union([treeVariantCreateSchema, flatVariantCreateSchema]);

// Update Variant Schema (partial of either shape; hierarchy keys optional)
export const updateVariantSchema = z.union([
  treeVariantUpdateSchema,
  flatVariantCreateSchema.partial(),
]);

/** New image rows for JSON payload or from multipart (relative URLs allowed; controller may emit full public URL) */
const productImagePayloadItemSchema = z
  .object({
    imageUrl: z
      .string()
      .min(1, 'imageUrl is required')
      .refine((s) => imageUrlAllowed(s), {
        message: 'imageUrl must be a URL, absolute path, or s3:object/key',
      }),
    altText: z.string().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

/** Custom key/value rows stored in `product_attributes` (e.g. material, care instructions). */
const productAttributePayloadItemSchema = z.preprocess(
  coerceProductAttributePayloadItem,
  z
    .object({
      attributeKey: z.string().min(1, 'attributeKey is required').max(255),
      attributeValue: z.union([z.string().max(65535), z.null()]).optional(),
    })
    .strict(),
);

const productAttributesPayloadSchema = z
  .array(productAttributePayloadItemSchema)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i += 1) {
      const k = arr[i]!.attributeKey.trim();
      if (seen.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate attributeKey in payload: ${k}`,
          path: [i, 'attributeKey'],
        });
        return;
      }
      seen.add(k);
    }
  });

// Core product row (no nested images/variants in DB sense)
const productCoreSchema = z.object({
  productName: z.string().min(1, 'Product name is required').max(255),
  district: z.string().max(255).optional().default('Unspecified'),
  categoryId: z.coerce.bigint().positive('Category ID must be a positive number'),
  defaultPrice: z.coerce.number().positive('Default price must be positive'),
  mrp: z.coerce.number().positive('MRP must be positive'),
  description: z.string().optional(),
  brand: z.string().optional(),
  /** Empty string → null (treat as omitted / clear for PATCH). */
  aliasSlug: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().max(255).nullable().optional(),
  ),
  /** No Zod `.default` here — PATCH `.partial()` would otherwise fill omitted keys and overwrite DB. Defaults live in create handler only. */
  publishStatus: z.enum(['draft', 'publish', 'unpublish']).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  forceOutOfStock: z.boolean().optional(),
  hsnSacCode: z.string().optional(),
  gstPercent: z.coerce.number().int().min(0).max(100).optional(),
  gtinEan: z.string().optional(),
  unitCount: z.coerce.number().optional(),
  unitType: unitTypeSchema,
  manufacturingMonth: z.string().optional(),
  expiryDate: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  returnDaysWindow: z.coerce.number().int().optional(),
  sellerPickupReturn: z.boolean().optional(),
  isCodAvailable: z.boolean().optional(),
  isManufacturer: z.boolean().optional(),
  manufacturerName: z.string().optional(),
  manufacturerAddress: z.string().optional(),
  minPurchaseLimit: z.coerce.number().int().optional(),
  maxPurchaseLimit: z.coerce.number().int().optional(),
  standardPackageQty: z.coerce.number().int().optional(),
  lowStockQty: z.coerce.number().int().optional(),
  orderMode: z.enum(['ONLINE', 'BUYQ', 'BOTH']).optional(),
  visibility: z.enum(['PUBLIC', 'BUSINESS']).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.string().optional(),
  disableForBots: z.boolean().optional(),
  availabilityMode: z.enum(['SELLER_DEFAULT', 'ALL_INDIA', 'CITIES', 'PINCODES']).optional(),
  cancellable: z.enum(['DEFAULT', 'YES', 'NO']).optional(),
  returnable: z.enum(['DEFAULT', 'YES', 'NO']).optional(),
  timeToShipValue: z.coerce.number().int().optional(),
  timeToShipUnit: z.enum(['MINUTES', 'HOURS', 'DAYS']).optional(),
  instructions: z.string().optional(),
  storageConditions: z.string().optional(),
  includedItems: z.string().optional(),
  sizeChartUrl: z.string().optional(),
  giTag: z.boolean().optional(),
  silkMark: z.boolean().optional(),
  haveOndcAttributes: z.boolean().optional(),
  productWeightGm: z.coerce.number().int().min(0).optional(),
  productLengthCm: z.coerce.number().optional(),
  productWidthCm: z.coerce.number().optional(),
  productHeightCm: z.coerce.number().optional(),
  packageWeightGm: z.coerce.number().int().min(0).optional(),
  packageLengthCm: z.coerce.number().optional(),
  packageWidthCm: z.coerce.number().optional(),
  packageHeightCm: z.coerce.number().optional(),
  ondcSubcategory: z.string().max(512).optional(),
});

const productFiltersPayloadSchema = z.array(
  z.object({
    filterId: z.coerce.bigint().positive('Filter ID must be a positive number').optional(),
    filterValueId: z.coerce.bigint().positive('Filter value ID must be a positive number'),
  }),
);

/** @desc Create product. Omit `variants` or `[]` → one default sellable variant; set `variants` to pre-seed many rows.
 *  `alias_slug` / `aliasSlug`: optional; if omitted or empty, server assigns `{normalized_name}_{id}` after insert (name: spaces/special chars → `_`). */
export const createProductSchema = productCoreSchema.extend({
  images: z.array(productImagePayloadItemSchema).optional(),
  variants: z.array(createVariantSchema).optional(),
  attributes: productAttributesPayloadSchema.optional(),
  ondcAttributes: ondcAttributesPayloadSchema.optional(),
  productFilters: productFiltersPayloadSchema.optional(),
});

const updateVariantInPayload = flatVariantCreateSchema
  .partial()
  .extend({ id: z.coerce.bigint() })
  .refine((d) => d.id > 0n, { path: ['id'], message: 'id must be a positive BigInt' });

const variantItemForUpdateSchema = z.union([
  updateVariantInPayload,
  treeVariantCreateSchema,
  flatVariantCreateSchema,
]);

export const updateProductSchema = productCoreSchema.partial().extend({
  images: z.array(productImagePayloadItemSchema).optional(),
  variants: z.array(variantItemForUpdateSchema).optional(),
  /** If present (including `[]`), replaces all `product_attributes` rows for this product. Omit to leave unchanged. */
  attributes: productAttributesPayloadSchema.optional(),
  /** If present (including `[]`), replaces product-level `product_ondc_attributes` rows (`variant_id IS NULL`). */
  ondcAttributes: ondcAttributesPayloadSchema.optional(),
  /** If present (including `[]`), replaces the selected CMS filter values for this product. */
  productFilters: productFiltersPayloadSchema.optional(),
  removeVariantIds: z
    .array(z.coerce.bigint().refine((b) => b > 0n, { message: 'Variant id must be positive' }))
    .optional(),
  /** When true with a full `variants` tree payload, existing variant rows are replaced (Mrignayanee-style save). */
  replaceVariantTree: z.boolean().optional(),
});

// Product Image Schema (JSON body or form fields after file upload)
export const productImageSchema = z
  .object({
    imageUrl: z.string().url('Invalid image URL').optional(),
    image_url: z.string().url('Invalid image URL').optional(),
    altText: z.string().optional(),
    alt_text: z.string().optional(),
    sortOrder: z.coerce.number().int().optional().default(0),
    sort_order: z.coerce.number().int().optional(),
  })
  .transform((v) => ({
    imageUrl: v.imageUrl ?? v.image_url,
    altText: v.altText ?? v.alt_text,
    sortOrder: v.sort_order ?? v.sortOrder ?? 0,
  }));

// Inventory Schema
export const updateInventorySchema = z.object({
  variantId: z.coerce.bigint().positive('Variant ID must be a positive number'),
  storeLocationId: z.coerce.bigint().positive('Store location ID must be a positive number'),
  qtyOnHand: z.coerce.number().int().min(0, 'Quantity on hand must be non-negative'),
  qtyReserved: z.coerce
    .number()
    .int()
    .min(0, 'Quantity reserved must be non-negative')
    .optional()
    .default(0),
});

// Serviceability Schema
export const setServiceabilitySchema = z.object({
  pincodes: z.array(z.string()).optional(),
  cities: z.array(z.string()).optional(),
});

// List Products Params Schema
export const listProductsParamsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().optional().default(20),
  search: z.string().optional(),
});

/** Public storefront catalog (GET /ui/products, /ui/products/search) */
export const publicCatalogQuerySchema = z.preprocess(
  (raw) => {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const q = raw as Record<string, unknown>;
    const reserved = new Set([
      'page',
      'limit',
      'sort',
      'categoryId',
      'category_id',
      'categorySlug',
      'category_slug',
      'category',
      'storeId',
      'store_id',
      'district',
      'search',
      'minPrice',
      'min_price',
      'maxPrice',
      'max_price',
    ]);
    const filters: Record<string, string[]> = {};
    for (const [key, rawValue] of Object.entries(q)) {
      if (reserved.has(key) || rawValue == null || rawValue === '') continue;
      const values = Array.isArray(rawValue) ? rawValue : String(rawValue).split(',');
      const clean = values.map((value) => String(value).trim()).filter(Boolean);
      if (clean.length > 0) filters[key] = clean;
    }
    return {
      ...q,
      categoryId: q.categoryId ?? q.category_id,
      categorySlug: q.categorySlug ?? q.category_slug ?? q.category,
      storeId: q.storeId ?? q.store_id,
      minPrice: q.minPrice ?? q.min_price,
      maxPrice: q.maxPrice ?? q.max_price,
      filters,
    };
  },
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['popular', 'newest', 'price_asc', 'price_desc']).default('popular'),
    categoryId: z.string().optional(),
    categorySlug: z.string().optional(),
    storeId: z.string().optional(),
    district: z.string().optional(),
    search: z.string().optional(),
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    filters: z.record(z.string(), z.array(z.string())).default({}),
  }),
);

export const publicRelatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export const publicReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const addProductReviewBodySchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    review_text: z.string().max(8000).optional(),
    reviewText: z.string().max(8000).optional(),
  })
  .transform((d) => ({
    rating: d.rating,
    reviewText: (d.reviewText ?? d.review_text ?? null) as string | null,
  }));
