import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';
import type {
  CreateProductDTO,
  UpdateProductDTO,
  UpdateInventoryDTO,
  SetServiceabilityDTO,
  ListProductsParams,
} from './product.types';

function decString(v: any): string {
  if (v == null) return '0';
  if (typeof v === 'object' && typeof v.toString === 'function') return v.toString();
  return String(v);
}

function toBool(v: any): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
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

  const [images, attributes, variants, vimgs] = await Promise.all([
    sqlQuery<any>('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC', [
      productId,
    ]),
    sqlQuery<any>('SELECT * FROM product_attributes WHERE product_id = ? ORDER BY id ASC', [
      productId,
    ]),
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

  const variantsOut = variants.map((v) => ({
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
  }));

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

  public getStoreProduct = async (
    _req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
  ) => {
    try {
      const product = await loadProductHydrated(storeId, productId);
      if (!product) return ApiResponse.notFound(res, 'Product not found');
      return ApiResponse.success(res, 'Product fetched successfully', product);
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
        sqlQuery<any>(
          `SELECT p.* FROM products p WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
          [...args, limit, skip],
        ),
        sqlQuery<{ total: number }>(
          `SELECT COUNT(*) as total FROM products p WHERE ${whereSql}`,
          args,
        ),
      ]);
      const total = Number(totalRows?.[0]?.total ?? 0);

      return ApiResponse.success(res, 'Products fetched successfully', rows, {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
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
          `INSERT INTO products (store_id, category_id, product_name, district, description, hsn_sac_code, gst_percent, gtin_ean, stock, force_out_of_stock, unit_count, unit_type, brand, manufacturing_month, expiry_date, country_of_origin, sort_order, return_days_window, seller_pickup_return, is_cod_available, publish_status, is_manufacturer, manufacturer_name, manufacturer_address, currency, default_price, mrp, visibility, alias_slug, seo_title, seo_description, seo_keywords, disable_for_bots, availability_mode, cancellable, returnable, time_to_ship_value, time_to_ship_unit, instructions, storage_conditions, included_items, size_chart_url, gi_tag, silk_mark, have_ondc_attributes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        if (Array.isArray((body as any).variants)) {
          const input = (body as any).variants as any[];

          // Tree payloads can use string ids for parent linking (e.g. "node-123").
          // We must translate those to DB ids as we insert.
          const idToDb = new Map<string, bigint>();
          const pending = [...input];
          const inserted = new Set<any>();

          const insertOne = async (v: any, parentDbId: bigint | null) => {
            const vres = await sqlExec(
              'INSERT INTO product_variants (product_id, parent_variant_id, level_index, level_name, attribute_value, color_code, variant_name, sku, gtin_ean, price, mrp, unit_count, unit_type, product_weight_gm, product_length_cm, product_width_cm, product_height_cm, shipping_pkg_weight_gm, shipping_pkg_length_cm, shipping_pkg_width_cm, shipping_pkg_height_cm, min_purchase_limit, max_purchase_limit, standard_package_qty, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                pid,
                parentDbId,
                v.levelIndex ?? null,
                v.levelName ?? null,
                v.name ?? null,
                v.colorCode ?? null,
                // keep name non-empty if client omits variantName on internal nodes
                (v.variantName && String(v.variantName).trim().length ? v.variantName : v.name) ??
                  '',
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
            const vid = BigInt(vres.insertId as any);
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
            return vid;
          };

          // Multi-pass topological insert: insert roots first, then children once parent exists.
          for (let pass = 0; pass < 20 && pending.length; pass++) {
            let progressed = false;
            for (let i = 0; i < pending.length; ) {
              const v = pending[i];
              if (inserted.has(v)) {
                pending.splice(i, 1);
                continue;
              }

              const parentRaw = v.parentId ?? v.parent_id ?? null;
              let parentDb: bigint | null = null;
              if (parentRaw == null || parentRaw === '' || parentRaw === 0 || parentRaw === '0') {
                parentDb = null;
              } else if (typeof parentRaw === 'number' || typeof parentRaw === 'bigint') {
                parentDb = BigInt(parentRaw);
              } else {
                const key = String(parentRaw);
                parentDb = idToDb.get(key) ?? null;
              }

              // If a parent is required but not yet inserted, skip for later pass.
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

          // Any leftover variants with unresolved parent: insert as roots to avoid FK failure.
          for (const v of pending) {
            await insertOne(v, null);
          }
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
      return ApiResponse.created(res, 'Product created successfully', product);
    } catch (error) {
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
      await withSqlTransaction(async (tx) => {
        const current = await sqlQuery<any>(
          'SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1',
          [productId, storeId],
          tx,
        );
        if (!current[0]) throw new Error('NOT_FOUND');

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
        if ((body as any).forceOutOfStock !== undefined)
          set('force_out_of_stock', toBool((body as any).forceOutOfStock));

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
      });

      const product = await loadProductHydrated(storeId, productId);
      if (!product) return ApiResponse.notFound(res, 'Product not found');
      return ApiResponse.success(res, 'Product updated successfully', product);
    } catch (error: any) {
      if (String(error?.message) === 'NOT_FOUND')
        return ApiResponse.notFound(res, 'Product not found');
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
      await sqlExec('DELETE FROM product_images WHERE id = ? AND product_id = ?', [
        imageId,
        productId,
      ]);
      return ApiResponse.success(res, 'Image deleted successfully', { id: imageId.toString() });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting product image', error);
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
      return ApiResponse.success(res, 'Images reordered successfully', imgs);
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
            'UPDATE inventory SET qty_on_hand = ?, qty_reserved = ? WHERE id = ?',
            [body.qtyOnHand, body.qtyReserved ?? 0, existing[0].id],
            tx,
          );
        } else {
          await sqlExec(
            'INSERT INTO inventory (store_location_id, variant_id, qty_on_hand, qty_reserved) VALUES (?, ?, ?, ?)',
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
