import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { sqlExec, sqlQuery, withSqlTransaction, type SqlTx } from '~/lib/sql';
import type {
  CreateProductDTO,
  UpdateProductDTO,
  UpdateInventoryDTO,
  SetServiceabilityDTO,
  ListProductsParams,
} from './product.types';
import { expandS3RefsDeep } from '~/lib/storageUrls';
import { deleteS3Object } from '~/lib/s3';
import { mailServiceAsync } from '../mail/mail.service';
import { SellerMailTemplate } from '../mail/seller.mail.template';

function decString(v: any): string {
  if (v == null) return '0';
  if (typeof v === 'object' && typeof v.toString === 'function') return v.toString();
  return String(v);
}

function toBool(v: any): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function toIntQty(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Prefer active DELIVERY, then any active row, then any row (inventory must attach to a location). */
async function resolvePrimaryStoreLocationId(storeId: bigint, tx?: SqlTx): Promise<bigint | null> {
  const pick = async (sql: string) => {
    const rows = await sqlQuery<{ id: bigint | string }>(sql, [storeId], tx);
    const id = rows[0]?.id;
    return id != null ? BigInt(String(id)) : null;
  };
  return (
    (await pick(
      `SELECT id FROM store_locations WHERE store_id = ? AND is_active = 1
       ORDER BY (location_type = 'DELIVERY') DESC, id ASC LIMIT 1`,
    )) ??
    (await pick(
      `SELECT id FROM store_locations WHERE store_id = ?
       ORDER BY (location_type = 'DELIVERY') DESC, id ASC LIMIT 1`,
    ))
  );
}

/**
 * Inventory rows require `store_location_id`. Many stores have no location yet — create a minimal DELIVERY row.
 */
async function ensureInventoryStoreLocationId(tx: SqlTx, storeId: bigint): Promise<bigint> {
  const existing = await resolvePrimaryStoreLocationId(storeId, tx);
  if (existing != null) return existing;

  const storeRows = await sqlQuery<{ store_name: string | null }>(
    'SELECT store_name FROM stores WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [storeId],
    tx,
  );
  const name = String(storeRows[0]?.store_name ?? 'Store').slice(0, 200);
  const ins = await sqlExec(
    `INSERT INTO store_locations (
       store_id, location_type, address_line1, address_line2, city, state, country, pincode,
       latitude, longitude, radius, opening_time, closing_time, serviceability, is_active, updated_at
     ) VALUES (?, 'DELIVERY', ?, NULL, 'Unspecified', 'Unspecified', 'India', '000000',
       NULL, NULL, NULL, NULL, NULL, 0, 1, CURRENT_TIMESTAMP(3))`,
    [storeId, `Default warehouse — ${name}`],
    tx,
  );
  return BigInt(String((ins as { insertId?: bigint | number | string }).insertId));
}

async function upsertInventoryForVariant(
  tx: SqlTx | undefined,
  storeLocationId: bigint,
  variantId: bigint,
  qtyOnHand: number,
  qtyReserved = 0,
): Promise<void> {
  const existing = await sqlQuery<{ id: bigint | string }>(
    'SELECT id FROM inventory WHERE store_location_id = ? AND variant_id = ? LIMIT 1',
    [storeLocationId, variantId],
    tx,
  );
  if (existing[0]) {
    await sqlExec(
      'UPDATE inventory SET qty_on_hand = ?, qty_reserved = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [qtyOnHand, qtyReserved, existing[0].id],
      tx,
    );
  } else {
    await sqlExec(
      'INSERT INTO inventory (store_location_id, variant_id, qty_on_hand, qty_reserved, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
      [storeLocationId, variantId, qtyOnHand, qtyReserved],
      tx,
    );
  }
}

async function replaceProductFilters(
  tx: SqlTx,
  productId: bigint,
  categoryId: bigint,
  input: Array<{ filterId?: bigint; filterValueId: bigint }>,
): Promise<void> {
  await sqlExec('DELETE FROM product_filters WHERE product_id = ?', [productId], tx);
  if (!Array.isArray(input) || input.length === 0) return;

  const valueIds = Array.from(new Set(input.map((x) => String(x.filterValueId)).filter(Boolean)));
  if (!valueIds.length) return;

  const rows = await sqlQuery<{
    filter_value_id: bigint | string;
    filter_id: bigint | string;
  }>(
    `SELECT fv.id AS filter_value_id, fv.filter_id
     FROM cms_filter_values fv
     JOIN cms_filters f ON f.id = fv.filter_id AND f.is_active = 1
     JOIN category_filters cf ON cf.filter_id = fv.filter_id
       AND cf.category_id = ?
       AND cf.is_active = 1
     WHERE fv.is_active = 1
       AND fv.id IN (${valueIds.map(() => '?').join(',')})`,
    [categoryId, ...valueIds],
    tx,
  );

  const allowedByValue = new Map(
    rows.map((r) => [String(r.filter_value_id), BigInt(String(r.filter_id))]),
  );
  const seen = new Set<string>();
  for (const item of input) {
    const valueKey = String(item.filterValueId);
    const filterId = allowedByValue.get(valueKey);
    if (!filterId) {
      throw new Error('INVALID_PRODUCT_FILTER');
    }
    if (item.filterId != null && BigInt(String(item.filterId)) !== filterId) {
      throw new Error('INVALID_PRODUCT_FILTER');
    }
    const uniqueKey = `${String(filterId)}:${valueKey}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    await sqlExec(
      'INSERT INTO product_filters (product_id, filter_id, filter_value_id) VALUES (?, ?, ?)',
      [productId, filterId, item.filterValueId],
      tx,
    );
  }
}

/**
 * Inserts Mrignayanee-style variant tree rows and optional `inventory` for leaf SKUs.
 */
async function insertVariantTreeFromPayload(
  tx: SqlTx,
  storeId: bigint,
  productId: bigint,
  input: any[],
): Promise<void> {
  const storeLocationId = await ensureInventoryStoreLocationId(tx, storeId);

  const idToDb = new Map<string, bigint>();
  const pending = [...input];
  const inserted = new Set<any>();

  const insertOne = async (v: any, parentDbId: bigint | null) => {
    const vres = await sqlExec(
      'INSERT INTO product_variants (product_id, parent_variant_id, level_index, level_name, attribute_value, color_code, variant_name, sku, gtin_ean, price, mrp, unit_count, unit_type, product_weight_gm, product_length_cm, product_width_cm, product_height_cm, shipping_pkg_weight_gm, shipping_pkg_length_cm, shipping_pkg_width_cm, shipping_pkg_height_cm, min_purchase_limit, max_purchase_limit, standard_package_qty, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        productId,
        parentDbId,
        v.levelIndex ?? null,
        v.levelName ?? null,
        v.name ?? null,
        v.colorCode ?? null,
        (v.variantName && String(v.variantName).trim().length ? v.variantName : v.name) ?? '',
        v.sku ?? null,
        v.gtinEan ?? null,
        v.price ?? null,
        v.mrp ?? null,
        v.unitCount ?? null,
        v.unitType ?? null,
        v.productWeightGm ?? null,
        v.productLengthCm ?? null,
        v.productWidthCm ?? null,
        v.productHeightCm ?? null,
        v.shippingPkgWeightGm ?? null,
        v.shippingPkgLengthCm ?? null,
        v.shippingPkgWidthCm ?? null,
        v.shippingPkgHeightCm ?? null,
        v.minPurchaseLimit ?? null,
        v.maxPurchaseLimit ?? null,
        v.standardPackageQty ?? null,
        v.isActive ?? true,
      ],
      tx,
    );
    const vid = BigInt((vres as any).insertId);
    if (typeof v.id === 'string' && v.id.length) {
      idToDb.set(v.id, vid);
    }
    if (Array.isArray(v.images)) {
      let j = 0;
      for (const im of v.images) {
        await sqlExec(
          'INSERT INTO variant_images (variant_id, image_url, sort_order) VALUES (?, ?, ?)',
          [vid, im.imageUrl, im.sortOrder ?? j],
          tx,
        );
        j++;
      }
    }
    if (Array.isArray(v.ondcAttributes)) {
      let k = 0;
      for (const a of v.ondcAttributes) {
        if (!a?.attributeKey) continue;
        await sqlExec(
          'INSERT INTO product_ondc_attributes (product_id, variant_id, attribute_key, attribute_value, color_name, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [
            productId,
            vid,
            String(a.attributeKey).trim(),
            a.attributeValue != null && String(a.attributeValue).trim() !== ''
              ? String(a.attributeValue).trim()
              : null,
            a.colorName != null && String(a.colorName).trim() !== ''
              ? String(a.colorName).trim()
              : null,
            a.sortOrder ?? k,
          ],
          tx,
        );
        k++;
      }
    }

    const skuTrim = v.sku != null ? String(v.sku).trim() : '';
    if (skuTrim.length > 0) {
      const qtyRaw = v.stock ?? v.qtyOnHand ?? v.qty_on_hand;
      const qty = toIntQty(qtyRaw);
      await upsertInventoryForVariant(tx, storeLocationId, vid, qty, 0);
    }

    return vid;
  };

  for (let pass = 0; pass < 20 && pending.length; pass++) {
    let progressed = false;
    for (let i = 0; i < pending.length; ) {
      const v = pending[i];
      if (inserted.has(v)) {
        pending.splice(i, 1);
        continue;
      }

      const parentRaw =
        v.parentId ?? v.parent_id ?? v.parentVariantId ?? v.parent_variant_id ?? null;
      let parentDb: bigint | null = null;
      if (parentRaw == null || parentRaw === '' || parentRaw === 0 || parentRaw === '0') {
        parentDb = null;
      } else if (typeof parentRaw === 'number' || typeof parentRaw === 'bigint') {
        parentDb = BigInt(parentRaw);
      } else {
        const key = String(parentRaw);
        parentDb = idToDb.get(key) ?? null;
      }

      if (
        parentRaw != null &&
        parentRaw !== '' &&
        parentRaw !== 0 &&
        parentRaw !== '0' &&
        parentDb === null
      ) {
        i++;
        continue;
      }

      await insertOne(v, parentDb);
      inserted.add(v);
      pending.splice(i, 1);
      progressed = true;
    }
    if (!progressed) break;
  }

  if (pending.length) {
    const unresolved = pending
      .map((v) => String(v.id ?? v.name ?? v.variantName ?? 'unknown'))
      .join(', ');
    throw new Error(`UNRESOLVED_VARIANT_PARENT:${unresolved}`);
  }
}

async function loadProductHydrated(storeId: bigint, productId: bigint) {
  const base = await sqlQuery<any>(
    `SELECT p.*,
      s.store_name, s.store_slug, s.description as store_description, s.support_email, s.support_phone, s.is_active as store_is_active,
      c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
     FROM products p
     JOIN stores s ON s.id = p.store_id
     JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.store_id = ? AND s.deleted_at IS NULL
     LIMIT 1`,
    [productId, storeId],
  );
  const p = base[0] ?? null;
  if (!p) return null;

  const storeIdForInv = BigInt(p.store_id);

  const [images, attributes, productFilters, ondcAttributes, variants, vimgs] = await Promise.all([
    sqlQuery<any>('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC', [
      productId,
    ]),
    sqlQuery<any>('SELECT * FROM product_attributes WHERE product_id = ? ORDER BY id ASC', [
      productId,
    ]),
    sqlQuery<any>(
      `SELECT
         pf.id,
         pf.product_id,
         pf.filter_id,
         pf.filter_value_id,
         f.name AS filter_name,
         f.slug AS filter_slug,
         f.group_type,
         fv.label AS value_label,
         fv.value,
         pf.created_at
       FROM product_filters pf
       JOIN cms_filters f ON f.id = pf.filter_id
       JOIN cms_filter_values fv ON fv.id = pf.filter_value_id
       WHERE pf.product_id = ?
       ORDER BY f.sort_order ASC, fv.sort_order ASC, fv.label ASC`,
      [productId],
    ),
    sqlQuery<any>(
      'SELECT * FROM product_ondc_attributes WHERE product_id = ? ORDER BY sort_order ASC, id ASC',
      [productId],
    ),
    sqlQuery<any>('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id ASC', [
      productId,
    ]),
    sqlQuery<any>(
      `SELECT vi.* FROM variant_images vi
       JOIN product_variants pv ON pv.id = vi.variant_id
       WHERE pv.product_id = ?
       ORDER BY vi.sort_order ASC`,
      [productId],
    ),
  ]);

  const vimgByVid = new Map<string, any[]>();
  for (const r of vimgs) {
    const k = String(r.variant_id);
    const list = vimgByVid.get(k) ?? [];
    list.push({
      id: r.id,
      variantId: r.variant_id,
      imageUrl: r.image_url,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    });
    vimgByVid.set(k, list);
  }

  const invByVid = new Map<string, { qtyOnHand: number; qtyReserved: number }>();
  if (variants.length) {
    const vids = variants.map((x: { id: unknown }) => x.id);
    const ph = vids.map(() => '?').join(',');
    const invRows = await sqlQuery<{
      variant_id: bigint | string;
      qty_on_hand: string | number | null;
      qty_reserved: string | number | null;
    }>(
      `SELECT i.variant_id, SUM(i.qty_on_hand) AS qty_on_hand, SUM(i.qty_reserved) AS qty_reserved
       FROM inventory i
       INNER JOIN store_locations sl ON sl.id = i.store_location_id AND sl.store_id = ?
       WHERE i.variant_id IN (${ph})
       GROUP BY i.variant_id`,
      [storeIdForInv, ...vids],
    );
    for (const row of invRows) {
      invByVid.set(String(row.variant_id), {
        qtyOnHand: Number(row.qty_on_hand ?? 0),
        qtyReserved: Number(row.qty_reserved ?? 0),
      });
    }
  }

  const variantsOut = variants.map((v) => {
    const inv = invByVid.get(String(v.id));
    const qtyOnHand = inv?.qtyOnHand ?? 0;
    const qtyReserved = inv?.qtyReserved ?? 0;
    return {
      ...v,
      id: v.id,
      productId: v.product_id,
      parentVariantId: v.parent_variant_id,
      variantName: v.variant_name,
      attributeValue: v.attribute_value,
      colorCode: v.color_code,
      isActive: !!v.is_active,
      unitCount: v.unit_count != null ? decString(v.unit_count) : null,
      price: v.price != null ? decString(v.price) : null,
      mrp: v.mrp != null ? decString(v.mrp) : null,
      variantImages: vimgByVid.get(String(v.id)) ?? [],
      stock: decString(qtyOnHand),
      qtyOnHand,
      qtyReserved,
      inventory: { qtyOnHand, qtyReserved },
    };
  });

  return {
    ...p,
    id: p.id,
    storeId: p.store_id,
    categoryId: p.category_id,
    productName: p.product_name,
    defaultPrice: decString(p.default_price),
    mrp: decString(p.mrp),
    avgRating: decString(p.avg_rating),
    reviewCount: p.review_count,
    store: {
      id: p.store_id,
      storeName: p.store_name,
      storeSlug: p.store_slug,
      description: p.store_description,
      supportEmail: p.support_email,
      supportPhone: p.support_phone,
      isActive: !!p.store_is_active,
    },
    category: {
      id: p.category_id,
      name: p.category_name,
      slug: p.category_slug,
      domainCode: p.category_domain,
      isActive: !!p.category_is_active,
    },
    images: images.map((r) => ({
      id: r.id,
      productId: r.product_id,
      imageUrl: r.image_url,
      altText: r.alt_text,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    })),
    attributes: attributes.map((r) => ({
      id: r.id,
      productId: r.product_id,
      attributeKey: r.attribute_key,
      attributeValue: r.attribute_value,
      createdAt: r.created_at,
    })),
    productFilters: productFilters.map((r) => ({
      id: r.id,
      productId: r.product_id,
      filterId: r.filter_id,
      filterValueId: r.filter_value_id,
      filterName: r.filter_name,
      filterSlug: r.filter_slug,
      groupType: r.group_type,
      label: r.value_label,
      value: r.value,
      createdAt: r.created_at,
    })),
    ondcAttributes: ondcAttributes.map((r) => ({
      id: r.id,
      productId: r.product_id,
      variantId: r.variant_id,
      attributeKey: r.attribute_key,
      attributeValue: r.attribute_value,
      colorName: r.color_name,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    })),
    variants: variantsOut,
  };
}

async function assertStoreExists(storeId: bigint): Promise<boolean> {
  const rows = await sqlQuery<any>(
    'SELECT id FROM stores WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [storeId],
  );
  return !!rows[0];
}

async function sendProductCreatedMails(storeId: bigint, productName: string): Promise<void> {
  const rows = await sqlQuery<{
    storeName: string | null;
    sellerName: string | null;
    sellerEmail: string | null;
  }>(
    `SELECT
       s.store_name AS storeName,
       u.name AS sellerName,
       u.email AS sellerEmail
     FROM stores s
     LEFT JOIN \`User\` u ON u.id = s.seller_user_id
     WHERE s.id = ? AND s.deleted_at IS NULL
     LIMIT 1`,
    [storeId],
  );

  const info = rows[0] ?? null;

  if (info?.sellerEmail) {
    const sellerMailData: {
      sellerName?: string;
      productName: string;
    } = { productName };

    if (info.sellerName) {
      sellerMailData.sellerName = info.sellerName;
    }

    void mailServiceAsync({
      to: info.sellerEmail,
      subject: 'Product Submitted Successfully',
      html: SellerMailTemplate.productSubmitted(sellerMailData),
      text: `Your product ${productName} has been submitted successfully.`,
    });
  }

  if (process.env.ADMIN_EMAIL) {
    const adminMailData: {
      productName: string;
      sellerName?: string;
      storeName?: string;
    } = { productName };

    if (info?.sellerName) {
      adminMailData.sellerName = info.sellerName;
    }

    if (info?.storeName) {
      adminMailData.storeName = info.storeName;
    }

    void mailServiceAsync({
      to: process.env.ADMIN_EMAIL,
      subject: `Product Approval Required - ${productName}`,
      html: SellerMailTemplate.productApprovalRequest(adminMailData),
      text: `New product approval required: ${productName}`,
    });
  }
}

async function getProductSellerMailInfo(productId: bigint): Promise<{
  productName: string;
  sellerName: string | null;
  sellerEmail: string | null;
} | null> {
  const rows = await sqlQuery<{
    productName: string;
    sellerName: string | null;
    sellerEmail: string | null;
  }>(
    `SELECT
       p.product_name AS productName,
       u.name AS sellerName,
       u.email AS sellerEmail
     FROM products p
     JOIN stores s ON s.id = p.store_id
     LEFT JOIN \`User\` u ON u.id = s.seller_user_id
     WHERE p.id = ? AND s.deleted_at IS NULL
     LIMIT 1`,
    [productId],
  );

  return rows[0] ?? null;
}

async function sendProductApprovedMail(productId: bigint): Promise<void> {
  const info = await getProductSellerMailInfo(productId);
  if (!info?.sellerEmail) return;

  const mailData: {
    sellerName?: string;
    productName: string;
  } = { productName: info.productName };

  if (info.sellerName) {
    mailData.sellerName = info.sellerName;
  }

  void mailServiceAsync({
    to: info.sellerEmail,
    subject: `Product Approved - ${info.productName}`,
    html: SellerMailTemplate.productApproved(mailData),
    text: `Your product ${info.productName} has been approved successfully.`,
  });
}

async function sendProductRejectedMail(productId: bigint, reason?: string): Promise<void> {
  const info = await getProductSellerMailInfo(productId);
  if (!info?.sellerEmail) return;

  const mailData: {
    sellerName?: string;
    productName: string;
    reason?: string;
  } = { productName: info.productName };

  if (info.sellerName) {
    mailData.sellerName = info.sellerName;
  }

  if (reason) {
    mailData.reason = reason;
  }

  void mailServiceAsync({
    to: info.sellerEmail,
    subject: `Product Rejected - ${info.productName}`,
    html: SellerMailTemplate.productRejected(mailData),
    text: reason
      ? `Your product ${info.productName} has been rejected. Reason: ${reason}`
      : `Your product ${info.productName} has been rejected.`,
  });
}

async function sendProductPublishedMail(productId: bigint): Promise<void> {
  const info = await getProductSellerMailInfo(productId);
  if (!info?.sellerEmail) return;

  const mailData: {
    sellerName?: string;
    productName: string;
  } = { productName: info.productName };

  if (info.sellerName) {
    mailData.sellerName = info.sellerName;
  }

  void mailServiceAsync({
    to: info.sellerEmail,
    subject: `Product Published - ${info.productName}`,
    html: SellerMailTemplate.productPublished(mailData),
    text: `Your product ${info.productName} has been published successfully.`,
  });
}

class ProductSqlService {
  private constructor() {}
  public static getInstance(): ProductSqlService {
    return new ProductSqlService();
  }

  public listCatalogCategories = async (_req: Request, res: Response) => {
    try {
      const rows = await sqlQuery<any>(
        'SELECT id, parent_id as parentId, domain as domainCode, name, slug, sort_order as sortOrder, is_active as isActive FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC',
      );
      return ApiResponse.success(res, 'Categories fetched successfully', rows);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error listing categories', error);
    }
  };

  public listCatalogCategoryTree = async (_req: Request, res: Response) => {
    try {
      const rows = await sqlQuery<any>(
        'SELECT id, parent_id as parentId, domain as domainCode, name, slug, is_active as isActive FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC',
      );
      const byParent = new Map<string, any[]>();
      for (const r of rows) {
        const key = r.parentId == null ? 'root' : String(r.parentId);
        const list = byParent.get(key) ?? [];
        list.push({ ...r, children: [] });
        byParent.set(key, list);
      }
      const attach = (node: any, depth: number) => {
        const kids = byParent.get(String(node.id)) ?? [];
        node.children = kids;
        node.level = depth;
        node.is_selectable = kids.length === 0;
        for (const k of kids) attach(k, depth + 1);
      };
      const roots = byParent.get('root') ?? [];
      for (const r of roots) attach(r, 0);
      return ApiResponse.success(res, 'Category tree fetched successfully', roots);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error building category tree', error);
    }
  };

  public listCategoryFilters = async (res: Response, categoryId: bigint) => {
    try {
      const rows = await sqlQuery<any>(
        `SELECT
           f.id AS filter_id,
           f.name,
           f.slug,
           f.group_type,
           cf.is_required,
           fv.id AS value_id,
           fv.label,
           fv.value
         FROM category_filters cf
         JOIN cms_filters f ON f.id = cf.filter_id
         LEFT JOIN cms_filter_values fv ON fv.filter_id = f.id AND fv.is_active = 1
         WHERE cf.category_id = ?
           AND cf.is_active = 1
           AND f.is_active = 1
         ORDER BY cf.sort_order ASC, f.sort_order ASC, f.name ASC, fv.sort_order ASC, fv.label ASC`,
        [categoryId],
      );

      const byFilter = new Map<string, any>();
      for (const row of rows) {
        const key = String(row.filter_id);
        if (!byFilter.has(key)) {
          byFilter.set(key, {
            id: row.filter_id,
            name: row.name,
            slug: row.slug,
            group_type: row.group_type,
            is_required: Boolean(row.is_required),
            values: [],
          });
        }
        if (row.value_id != null) {
          byFilter.get(key).values.push({
            id: row.value_id,
            label: row.label,
            value: row.value,
          });
        }
      }

      return ApiResponse.success(
        res,
        'Category filters fetched successfully',
        Array.from(byFilter.values()),
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching category filters', error);
    }
  };

  public getStoreProduct = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
  ) => {
    try {
      const product = await loadProductHydrated(storeId, productId);
      if (!product) return ApiResponse.notFound(res, 'Product not found');
      return ApiResponse.success(
        res,
        'Product fetched successfully',
        await expandS3RefsDeep(product),
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching product', error);
    }
  };

  public listProducts = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    params: ListProductsParams,
  ) => {
    try {
      if (!(await assertStoreExists(storeId))) return ApiResponse.notFound(res, 'Store not found');
      const page = params.page ?? 1;
      const limit = params.limit ?? 20;
      const skip = (page - 1) * limit;
      const args: any[] = [storeId];
      let whereSql = 'p.store_id = ?';
      if (params.search && params.search.trim()) {
        whereSql += ' AND (p.product_name LIKE ? OR p.description LIKE ?)';
        const s = `%${params.search.trim()}%`;
        args.push(s, s);
      }
      if ((params as any).publishStatus) {
        whereSql += ' AND p.publish_status = ?';
        args.push((params as any).publishStatus);
      }

      const [rows, totalRows] = await Promise.all([
        sqlQuery<{
          id: bigint | number | string;
          product_name: string;
          brand: string | null;
          district: string | null;
          stock: bigint | number | string | null;
          force_out_of_stock: boolean | number;
          unit_count: unknown;
          unit_type: string | null;
          publish_status: string;
          created_at: Date | string;
        }>(
          `SELECT p.id, p.product_name, p.brand, p.district, p.stock, p.force_out_of_stock,
                  p.unit_count, p.unit_type, p.publish_status, p.created_at
           FROM products p WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
          [...args, limit, skip],
        ),
        sqlQuery<{ total: number }>(
          `SELECT COUNT(*) as total FROM products p WHERE ${whereSql}`,
          args,
        ),
      ]);
      const total = Number(totalRows?.[0]?.total ?? 0);

      const imgsByProductId = new Map<
        string,
        { id: unknown; imageUrl: string; altText: string | null; sortOrder: number }[]
      >();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const ph = ids.map(() => '?').join(', ');
        const imgRows = await sqlQuery<{
          product_id: bigint | number | string;
          id: unknown;
          image_url: string;
          alt_text: string | null;
          sort_order: number;
        }>(
          `SELECT product_id, id, image_url, alt_text, sort_order FROM product_images
           WHERE product_id IN (${ph}) ORDER BY product_id ASC, sort_order ASC`,
          ids as any[],
        );
        for (const im of imgRows) {
          const k = String(im.product_id);
          const list = imgsByProductId.get(k) ?? [];
          list.push({
            id: im.id,
            imageUrl: im.image_url,
            altText: im.alt_text,
            sortOrder: im.sort_order,
          });
          imgsByProductId.set(k, list);
        }

        const productIdsWithoutCover = rows
          .filter((r) => (imgsByProductId.get(String(r.id)) ?? []).length === 0)
          .map((r) => r.id);
        if (productIdsWithoutCover.length > 0) {
          const ph2 = productIdsWithoutCover.map(() => '?').join(', ');
          const variantImgRows = await sqlQuery<{
            product_id: bigint | number | string;
            id: unknown;
            image_url: string;
            sort_order: number;
          }>(
            `SELECT pv.product_id, vi.id, vi.image_url, vi.sort_order
             FROM variant_images vi
             INNER JOIN product_variants pv ON pv.id = vi.variant_id
             WHERE pv.product_id IN (${ph2})
             ORDER BY pv.product_id ASC, pv.id ASC, vi.sort_order ASC`,
            productIdsWithoutCover as any[],
          );
          const coverSeen = new Set<string>();
          for (const vim of variantImgRows) {
            const pk = String(vim.product_id);
            if (coverSeen.has(pk)) continue;
            coverSeen.add(pk);
            imgsByProductId.set(pk, [
              {
                id: vim.id,
                imageUrl: vim.image_url,
                altText: null,
                sortOrder: vim.sort_order,
              },
            ]);
          }
        }
      }

      const snapshot = rows.map((p) => ({
        id: p.id,
        productName: p.product_name,
        brand: p.brand,
        district: p.district,
        stock: decString(p.stock),
        forceOutOfStock: !!p.force_out_of_stock,
        unitCount: p.unit_count != null ? decString(p.unit_count) : null,
        unitType: p.unit_type,
        publishStatus: p.publish_status,
        images: imgsByProductId.get(String(p.id)) ?? [],
      }));

      return ApiResponse.success(
        res,
        'Products fetched successfully',
        await expandS3RefsDeep(snapshot),
        {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error listing products', error);
    }
  };

  public createProduct = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    body: CreateProductDTO,
  ) => {
    try {
      const productId = await withSqlTransaction(async (tx) => {
        const ins = await sqlExec(
          `INSERT INTO products (store_id, category_id, product_name, district, description, hsn_sac_code, gst_percent, gtin_ean, stock, force_out_of_stock, unit_count, unit_type, brand, manufacturing_month, expiry_date, country_of_origin, sort_order, return_days_window, seller_pickup_return, is_cod_available, publish_status, is_manufacturer, manufacturer_name, manufacturer_address, currency, default_price, mrp, visibility, alias_slug, seo_title, seo_description, seo_keywords, disable_for_bots, availability_mode, cancellable, returnable, time_to_ship_value, time_to_ship_unit, instructions, storage_conditions, included_items, size_chart_url, gi_tag, silk_mark, have_ondc_attributes, product_weight_gm, product_length_cm, product_width_cm, product_height_cm, package_weight_gm, package_length_cm, package_width_cm, package_height_cm, min_purchase_limit, max_purchase_limit, standard_package_qty, low_stock_qty, order_mode, ondc_subcategory)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            storeId,
            body.categoryId,
            body.productName,
            (body as any).district ?? '',
            body.description ?? null,
            (body as any).hsnSacCode ?? null,
            (body as any).gstPercent ?? 0,
            (body as any).gtinEan ?? null,
            (body as any).stock ?? 0,
            toBool((body as any).forceOutOfStock),
            (body as any).unitCount ?? null,
            (body as any).unitType ?? null,
            (body as any).brand ?? null,
            (body as any).manufacturingMonth ?? null,
            (body as any).expiryDate ?? null,
            (body as any).countryOfOrigin ?? null,
            (body as any).sortOrder ?? 0,
            (body as any).returnDaysWindow ?? null,
            toBool((body as any).sellerPickupReturn),
            (body as any).isCodAvailable ?? true,
            (body as any).publishStatus ?? 'draft',
            toBool((body as any).isManufacturer),
            (body as any).manufacturerName ?? null,
            (body as any).manufacturerAddress ?? null,
            (body as any).currency ?? 'INR',
            body.defaultPrice,
            body.mrp,
            (body as any).visibility ?? 'PUBLIC',
            (body as any).aliasSlug ?? null,
            (body as any).seoTitle ?? null,
            (body as any).seoDescription ?? null,
            (body as any).seoKeywords ?? null,
            toBool((body as any).disableForBots),
            (body as any).availabilityMode ?? 'SELLER_DEFAULT',
            (body as any).cancellable ?? 'DEFAULT',
            (body as any).returnable ?? 'DEFAULT',
            (body as any).timeToShipValue ?? null,
            (body as any).timeToShipUnit ?? null,
            (body as any).instructions ?? null,
            (body as any).storageConditions ?? null,
            (body as any).includedItems ?? null,
            (body as any).sizeChartUrl ?? null,
            toBool((body as any).giTag),
            toBool((body as any).silkMark),
            toBool((body as any).haveOndcAttributes),
            (body as any).productWeightGm ?? null,
            (body as any).productLengthCm ?? null,
            (body as any).productWidthCm ?? null,
            (body as any).productHeightCm ?? null,
            (body as any).packageWeightGm ?? null,
            (body as any).packageLengthCm ?? null,
            (body as any).packageWidthCm ?? null,
            (body as any).packageHeightCm ?? null,
            (body as any).minPurchaseLimit ?? null,
            (body as any).maxPurchaseLimit ?? null,
            (body as any).standardPackageQty ?? null,
            (body as any).lowStockQty ?? null,
            (body as any).orderMode ?? 'ONLINE',
            (body as any).ondcSubcategory ?? null,
          ],
          tx,
        );
        const pid = BigInt(ins.insertId as any);

        if (Array.isArray((body as any).images)) {
          let i = 0;
          for (const img of (body as any).images) {
            await sqlExec(
              'INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)',
              [pid, img.imageUrl, img.altText ?? null, img.sortOrder ?? i],
              tx,
            );
            i++;
          }
        }
        if (Array.isArray((body as any).attributes)) {
          for (const a of (body as any).attributes) {
            if (!a?.attributeKey) continue;
            await sqlExec(
              'INSERT INTO product_attributes (product_id, attribute_key, attribute_value) VALUES (?, ?, ?)',
              [pid, a.attributeKey, a.attributeValue ?? null],
              tx,
            );
          }
        }
        if (Array.isArray((body as any).productFilters)) {
          await replaceProductFilters(
            tx,
            pid,
            BigInt(String(body.categoryId)),
            (body as any).productFilters,
          );
        }
        if (Array.isArray((body as any).ondcAttributes)) {
          let i = 0;
          for (const a of (body as any).ondcAttributes) {
            if (!a?.attributeKey) continue;
            await sqlExec(
              'INSERT INTO product_ondc_attributes (product_id, variant_id, attribute_key, attribute_value, color_name, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
              [
                pid,
                null,
                String(a.attributeKey).trim(),
                a.attributeValue != null && String(a.attributeValue).trim() !== ''
                  ? String(a.attributeValue).trim()
                  : null,
                a.colorName != null && String(a.colorName).trim() !== ''
                  ? String(a.colorName).trim()
                  : null,
                a.sortOrder ?? i,
              ],
              tx,
            );
            i++;
          }
        }
        if (Array.isArray((body as any).variants)) {
          await insertVariantTreeFromPayload(tx, storeId, pid, (body as any).variants as any[]);
        }

        // ============================================================
        // ✅ ADDED: Product Verification Insert
        // ============================================================
        await sqlExec(
          `INSERT INTO product_verification 
         (product_id, store_id, approval_status)
         VALUES (?, ?, 'pending')`,
          [pid, storeId],
          tx,
        );
        // ============================================================

        return pid;
      });

      const product = await loadProductHydrated(storeId, productId);
      if (product?.productName) {
        await sendProductCreatedMails(storeId, product.productName);
      }
      return ApiResponse.created(
        res,
        'Product created successfully',
        await expandS3RefsDeep(product),
      );
    } catch (error: any) {
      if (String(error?.message) === 'INVALID_PRODUCT_FILTER') {
        return ApiResponse.badRequest(
          res,
          'Selected product filter is not valid for this category',
        );
      }
      return ApiResponse.serverError(res, 'Error creating product', error);
    }
  };

  // aprovel of product by admin
  public approveProduct = async (res: Response, productId: bigint) => {
    try {
      await withSqlTransaction(async (tx) => {
        // ✅ Update ONLY product_verification table
        const result = await sqlExec(
          `UPDATE product_verification 
         SET approval_status = 'approved',
             reason = NULL
         WHERE product_id = ?`,
          [productId],
          tx,
        );

        // ✅ OPTIONAL: safety check (recommended)
        if ((result as any).affectedRows === 0) {
          throw new Error('Product not found in verification table');
        }
      });

      await sendProductApprovedMail(productId);

      return ApiResponse.success(res, 'Product approved successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error approving product', error);
    }
  };
  // Rejection of product by admin witrh reason
  public rejectProduct = async (res: Response, productId: bigint, reason: string) => {
    try {
      await withSqlTransaction(async (tx) => {
        // ✅ Update ONLY product_verification table
        const result = await sqlExec(
          `UPDATE product_verification 
         SET approval_status = 'rejected',
             reason = ?
         WHERE product_id = ?`,
          [reason, productId],
          tx,
        );

        // ✅ Optional safety check
        if ((result as any).affectedRows === 0) {
          throw new Error('Product not found in verification table');
        }
      });

      await sendProductRejectedMail(productId, reason);

      return ApiResponse.success(res, 'Product rejected successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error rejecting product', error);
    }
  };
  public updateProduct = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    body: UpdateProductDTO,
  ) => {
    try {
      let shouldSendProductPublishedMail = false;

      await withSqlTransaction(async (tx) => {
        const current = await sqlQuery<any>(
          'SELECT id, category_id, publish_status FROM products WHERE id = ? AND store_id = ? LIMIT 1',
          [productId, storeId],
          tx,
        );
        if (!current[0]) throw new Error('NOT_FOUND');
        const previousPublishStatus = String(current[0].publish_status ?? '');
        const nextPublishStatus =
          (body as any).publishStatus !== undefined ? String((body as any).publishStatus) : null;
        shouldSendProductPublishedMail =
          previousPublishStatus !== 'publish' && nextPublishStatus === 'publish';

        const fields: string[] = [];
        const args: any[] = [];
        const set = (col: string, val: any) => {
          fields.push(`${col} = ?`);
          args.push(val);
        };

        if ((body as any).productName !== undefined) set('product_name', (body as any).productName);
        if ((body as any).categoryId !== undefined) set('category_id', (body as any).categoryId);
        if ((body as any).description !== undefined)
          set('description', (body as any).description ?? null);
        if ((body as any).defaultPrice !== undefined)
          set('default_price', (body as any).defaultPrice);
        if ((body as any).mrp !== undefined) set('mrp', (body as any).mrp);
        if ((body as any).publishStatus !== undefined)
          set('publish_status', (body as any).publishStatus);
        if ((body as any).aliasSlug !== undefined)
          set('alias_slug', (body as any).aliasSlug ?? null);
        if ((body as any).stock !== undefined) set('stock', (body as any).stock);
        if ((body as any).district !== undefined) set('district', (body as any).district ?? '');
        if ((body as any).brand !== undefined) set('brand', (body as any).brand ?? null);
        if ((body as any).hsnSacCode !== undefined)
          set('hsn_sac_code', (body as any).hsnSacCode ?? null);
        if ((body as any).gstPercent !== undefined)
          set('gst_percent', (body as any).gstPercent ?? 0);
        if ((body as any).unitCount !== undefined)
          set('unit_count', (body as any).unitCount ?? null);
        if ((body as any).unitType !== undefined) set('unit_type', (body as any).unitType ?? null);
        if ((body as any).countryOfOrigin !== undefined)
          set('country_of_origin', (body as any).countryOfOrigin ?? null);
        if ((body as any).isCodAvailable !== undefined)
          set('is_cod_available', Boolean((body as any).isCodAvailable));
        if ((body as any).cancellable !== undefined)
          set('cancellable', (body as any).cancellable ?? 'DEFAULT');
        if ((body as any).returnable !== undefined)
          set('returnable', (body as any).returnable ?? 'DEFAULT');
        if ((body as any).minPurchaseLimit !== undefined)
          set('min_purchase_limit', (body as any).minPurchaseLimit ?? null);
        if ((body as any).maxPurchaseLimit !== undefined)
          set('max_purchase_limit', (body as any).maxPurchaseLimit ?? null);
        if ((body as any).standardPackageQty !== undefined)
          set('standard_package_qty', (body as any).standardPackageQty ?? null);
        if ((body as any).lowStockQty !== undefined)
          set('low_stock_qty', (body as any).lowStockQty ?? null);
        if ((body as any).orderMode !== undefined)
          set('order_mode', (body as any).orderMode ?? 'ONLINE');
        if ((body as any).timeToShipValue !== undefined)
          set('time_to_ship_value', (body as any).timeToShipValue ?? null);
        if ((body as any).timeToShipUnit !== undefined)
          set('time_to_ship_unit', (body as any).timeToShipUnit ?? null);
        if ((body as any).instructions !== undefined)
          set('instructions', (body as any).instructions ?? null);
        if ((body as any).storageConditions !== undefined)
          set('storage_conditions', (body as any).storageConditions ?? null);
        if ((body as any).includedItems !== undefined)
          set('included_items', (body as any).includedItems ?? null);
        if ((body as any).sizeChartUrl !== undefined)
          set('size_chart_url', (body as any).sizeChartUrl ?? null);
        if ((body as any).haveOndcAttributes !== undefined)
          set('have_ondc_attributes', toBool((body as any).haveOndcAttributes));
        if ((body as any).forceOutOfStock !== undefined)
          set('force_out_of_stock', toBool((body as any).forceOutOfStock));
        if ((body as any).productWeightGm !== undefined)
          set('product_weight_gm', (body as any).productWeightGm ?? null);
        if ((body as any).productLengthCm !== undefined)
          set('product_length_cm', (body as any).productLengthCm ?? null);
        if ((body as any).productWidthCm !== undefined)
          set('product_width_cm', (body as any).productWidthCm ?? null);
        if ((body as any).productHeightCm !== undefined)
          set('product_height_cm', (body as any).productHeightCm ?? null);
        if ((body as any).packageWeightGm !== undefined)
          set('package_weight_gm', (body as any).packageWeightGm ?? null);
        if ((body as any).packageLengthCm !== undefined)
          set('package_length_cm', (body as any).packageLengthCm ?? null);
        if ((body as any).packageWidthCm !== undefined)
          set('package_width_cm', (body as any).packageWidthCm ?? null);
        if ((body as any).packageHeightCm !== undefined)
          set('package_height_cm', (body as any).packageHeightCm ?? null);
        if ((body as any).ondcSubcategory !== undefined)
          set('ondc_subcategory', (body as any).ondcSubcategory ?? null);

        if (fields.length) {
          await sqlExec(
            `UPDATE products SET ${fields.join(', ')} WHERE id = ? AND store_id = ?`,
            [...args, productId, storeId],
            tx,
          );
        }

        if (Array.isArray((body as any).images)) {
          await sqlExec('DELETE FROM product_images WHERE product_id = ?', [productId], tx);
          let i = 0;
          for (const img of (body as any).images) {
            await sqlExec(
              'INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)',
              [productId, img.imageUrl, img.altText ?? null, img.sortOrder ?? i],
              tx,
            );
            i++;
          }
        }
        if (Array.isArray((body as any).attributes)) {
          await sqlExec('DELETE FROM product_attributes WHERE product_id = ?', [productId], tx);
          for (const a of (body as any).attributes) {
            if (!a?.attributeKey) continue;
            await sqlExec(
              'INSERT INTO product_attributes (product_id, attribute_key, attribute_value) VALUES (?, ?, ?)',
              [productId, a.attributeKey, a.attributeValue ?? null],
              tx,
            );
          }
        }
        if (Array.isArray((body as any).productFilters)) {
          const categoryId =
            (body as any).categoryId != null
              ? BigInt(String((body as any).categoryId))
              : BigInt(String(current[0].category_id ?? current[0].categoryId));
          await replaceProductFilters(tx, productId, categoryId, (body as any).productFilters);
        }
        if (Array.isArray((body as any).ondcAttributes)) {
          await sqlExec(
            'DELETE FROM product_ondc_attributes WHERE product_id = ? AND variant_id IS NULL',
            [productId],
            tx,
          );
          let i = 0;
          for (const a of (body as any).ondcAttributes) {
            if (!a?.attributeKey) continue;
            await sqlExec(
              'INSERT INTO product_ondc_attributes (product_id, variant_id, attribute_key, attribute_value, color_name, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
              [
                productId,
                null,
                String(a.attributeKey).trim(),
                a.attributeValue != null && String(a.attributeValue).trim() !== ''
                  ? String(a.attributeValue).trim()
                  : null,
                a.colorName != null && String(a.colorName).trim() !== ''
                  ? String(a.colorName).trim()
                  : null,
                a.sortOrder ?? i,
              ],
              tx,
            );
            i++;
          }
        }

        const replaceTree =
          (body as any).replaceVariantTree === true || (body as any).replaceVariantTree === 'true';
        if (
          replaceTree &&
          Array.isArray((body as any).variants) &&
          (body as any).variants.length > 0
        ) {
          await sqlExec('DELETE FROM product_variants WHERE product_id = ?', [productId], tx);
          await insertVariantTreeFromPayload(
            tx,
            storeId,
            productId,
            (body as any).variants as any[],
          );
        }
      });

      const product = await loadProductHydrated(storeId, productId);
      if (!product) return ApiResponse.notFound(res, 'Product not found');
      if (shouldSendProductPublishedMail) {
        await sendProductPublishedMail(productId);
      }
      return ApiResponse.success(
        res,
        'Product updated successfully',
        await expandS3RefsDeep(product),
      );
    } catch (error: any) {
      if (String(error?.message) === 'NOT_FOUND')
        return ApiResponse.notFound(res, 'Product not found');
      if (String(error?.message) === 'INVALID_PRODUCT_FILTER') {
        return ApiResponse.badRequest(
          res,
          'Selected product filter is not valid for this category',
        );
      }
      return ApiResponse.serverError(res, 'Error updating product', error);
    }
  };

  public deleteProduct = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
  ) => {
    try {
      await withSqlTransaction(async (tx) => {
        await sqlExec(
          'DELETE FROM products WHERE id = ? AND store_id = ?',
          [productId, storeId],
          tx,
        );
        await sqlExec('DELETE FROM product_images WHERE product_id = ?', [productId], tx);
        await sqlExec('DELETE FROM product_attributes WHERE product_id = ?', [productId], tx);
        await sqlExec('DELETE FROM product_variants WHERE product_id = ?', [productId], tx);
        await sqlExec(
          'DELETE FROM product_serviceable_cities WHERE product_id = ?',
          [productId],
          tx,
        );
        await sqlExec(
          'DELETE FROM product_serviceable_pincodes WHERE product_id = ?',
          [productId],
          tx,
        );
      });
      return ApiResponse.success(res, 'Product deleted successfully', { id: productId.toString() });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting product', error);
    }
  };

  public deleteProductImage = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    imageId: bigint,
  ) => {
    try {
      const p = await sqlQuery<any>(
        'SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1',
        [productId, storeId],
      );
      if (!p[0]) return ApiResponse.notFound(res, 'Product not found');
      const rows = await sqlQuery<{ image_url: string }>(
        'SELECT image_url FROM product_images WHERE id = ? AND product_id = ? LIMIT 1',
        [imageId, productId],
      );
      if (!rows[0]) return ApiResponse.notFound(res, 'Product image not found');
      const ref = String(rows[0].image_url ?? '');
      const hdr = await sqlExec('DELETE FROM product_images WHERE id = ? AND product_id = ?', [
        imageId,
        productId,
      ]);
      if (Number((hdr as { affectedRows?: number }).affectedRows ?? 0) === 0) {
        return ApiResponse.notFound(res, 'Product image not found');
      }
      if (ref.startsWith('s3:')) {
        await deleteS3Object(ref.slice(3)).catch(() => undefined);
      }
      return ApiResponse.success(res, 'Image deleted successfully', { id: imageId.toString() });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting product image', error);
    }
  };

  public deleteVariantImage = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    variantId: bigint,
    imageId: bigint,
  ) => {
    try {
      const p = await sqlQuery<any>(
        'SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1',
        [productId, storeId],
      );
      if (!p[0]) return ApiResponse.notFound(res, 'Product not found');
      const vimRows = await sqlQuery<{ image_url: string }>(
        `SELECT vi.image_url FROM variant_images vi
         INNER JOIN product_variants pv ON pv.id = vi.variant_id
         INNER JOIN products pr ON pr.id = pv.product_id
         WHERE vi.id = ? AND vi.variant_id = ? AND pv.product_id = ? AND pr.store_id = ?
         LIMIT 1`,
        [imageId, variantId, productId, storeId],
      );
      if (!vimRows[0]) return ApiResponse.notFound(res, 'Variant image not found');
      const ref = String(vimRows[0].image_url ?? '');
      const hdr = await sqlExec(
        `DELETE vi FROM variant_images vi
         INNER JOIN product_variants pv ON pv.id = vi.variant_id
         INNER JOIN products pr ON pr.id = pv.product_id
         WHERE vi.id = ? AND vi.variant_id = ? AND pv.product_id = ? AND pr.store_id = ?`,
        [imageId, variantId, productId, storeId],
      );
      if (Number((hdr as { affectedRows?: number }).affectedRows ?? 0) === 0) {
        return ApiResponse.notFound(res, 'Variant image not found');
      }
      if (ref.startsWith('s3:')) {
        await deleteS3Object(ref.slice(3)).catch(() => undefined);
      }
      return ApiResponse.success(res, 'Variant image deleted successfully', {
        id: imageId.toString(),
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting variant image', error);
    }
  };

  public reorderProductImages = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    imageIds: bigint[],
  ) => {
    try {
      const p = await sqlQuery<any>(
        'SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1',
        [productId, storeId],
      );
      if (!p[0]) return ApiResponse.notFound(res, 'Product not found');
      await withSqlTransaction(async (tx) => {
        for (let i = 0; i < imageIds.length; i++) {
          await sqlExec(
            'UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?',
            [i, imageIds[i], productId],
            tx,
          );
        }
      });
      const imgs = await sqlQuery<any>(
        'SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC',
        [productId],
      );
      return ApiResponse.success(
        res,
        'Images reordered successfully',
        await expandS3RefsDeep(imgs),
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error reordering product images', error);
    }
  };

  public updateInventory = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    body: UpdateInventoryDTO,
  ) => {
    try {
      const p = await sqlQuery<any>(
        'SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1',
        [productId, storeId],
      );
      if (!p[0]) return ApiResponse.notFound(res, 'Product not found');
      await withSqlTransaction(async (tx) => {
        const existing = await sqlQuery<any>(
          'SELECT id FROM inventory WHERE store_location_id = ? AND variant_id = ? LIMIT 1',
          [body.storeLocationId, body.variantId],
          tx,
        );
        if (existing[0]) {
          await sqlExec(
            'UPDATE inventory SET qty_on_hand = ?, qty_reserved = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
            [body.qtyOnHand, body.qtyReserved ?? 0, existing[0].id],
            tx,
          );
        } else {
          await sqlExec(
            'INSERT INTO inventory (store_location_id, variant_id, qty_on_hand, qty_reserved, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
            [body.storeLocationId, body.variantId, body.qtyOnHand, body.qtyReserved ?? 0],
            tx,
          );
        }
      });
      return ApiResponse.success(res, 'Inventory updated successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error updating inventory', error);
    }
  };

  public setServiceability = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    body: SetServiceabilityDTO,
  ) => {
    try {
      const p = await sqlQuery<any>(
        'SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1',
        [productId, storeId],
      );
      if (!p[0]) return ApiResponse.notFound(res, 'Product not found');
      await withSqlTransaction(async (tx) => {
        await sqlExec(
          'DELETE FROM product_serviceable_cities WHERE product_id = ?',
          [productId],
          tx,
        );
        await sqlExec(
          'DELETE FROM product_serviceable_pincodes WHERE product_id = ?',
          [productId],
          tx,
        );
        if (Array.isArray((body as any).cities)) {
          for (const city of (body as any).cities) {
            await sqlExec(
              'INSERT INTO product_serviceable_cities (product_id, city) VALUES (?, ?)',
              [productId, city],
              tx,
            );
          }
        }
        if (Array.isArray((body as any).pincodes)) {
          for (const pincode of (body as any).pincodes) {
            await sqlExec(
              'INSERT INTO product_serviceable_pincodes (product_id, pincode) VALUES (?, ?)',
              [productId, pincode],
              tx,
            );
          }
        }
        if ((body as any).availabilityMode) {
          await sqlExec(
            'UPDATE products SET availability_mode = ? WHERE id = ?',
            [(body as any).availabilityMode, productId],
            tx,
          );
        }
      });
      return ApiResponse.success(res, 'Serviceability updated successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error updating serviceability', error);
    }
  };
}

export const productService = ProductSqlService.getInstance();
