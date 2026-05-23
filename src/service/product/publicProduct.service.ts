import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';
import { expandS3RefsDeep } from '~/lib/storageUrls';
import type { Request, Response } from 'express';
import {
  publicCatalogQuerySchema,
  publicRelatedQuerySchema,
  publicReviewsQuerySchema,
  addProductReviewBodySchema,
} from './product.schema';
import { UserRole } from '~/lib/userRole';
import { canModerateProduct } from '~/service/admin/admin.service';

function parseOptionalBigintParam(raw: string | string[] | undefined): bigint | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === undefined || s === '') return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function slugParam(raw: string | string[] | undefined): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return typeof s === 'string' ? s : '';
}

function toDecString(v: any): string {
  if (v == null) return '0';
  if (typeof v === 'object' && typeof v.toString === 'function') return v.toString();
  return String(v);
}

function orderByForSort(sort: string): string {
  switch (sort) {
    case 'newest':
      return 'p.created_at DESC';
    case 'price_asc':
      return 'p.default_price ASC, p.created_at DESC';
    case 'price_desc':
      return 'p.default_price DESC, p.created_at DESC';
    case 'popular':
    default:
      return 'p.review_count DESC, p.avg_rating DESC, p.created_at DESC';
  }
}

function normalizeFilterToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function toPublicProductCard(product: any) {
  const price = Number(product.default_price ?? product.defaultPrice ?? 0);
  const mrp = Number(product.mrp ?? 0);
  return {
    ...product,
    productName: product.product_name ?? product.productName,
    categoryId: product.category_id ?? product.category?.id,
    categoryName: product.category_name ?? product.category?.name,
    storeId: product.store_id ?? product.store?.id,
    storeName: product.store_name ?? product.store?.storeName,
    storeSlug: product.store_slug ?? product.store?.storeSlug,
    createdAt: product.created_at ?? product.createdAt,
    hasVariants: Number(product.no_of_variants ?? 0) > 0,
    aliasSlug: product.alias_slug ?? product.aliasSlug,
    price,
    mrp,
    discountPercent: mrp > price && price > 0 ? Math.round(((mrp - price) / mrp) * 100) : null,
    unitCount: Number(product.unit_count ?? product.unitCount ?? product.stock ?? 0),
    isOutOfStock: Boolean(product.force_out_of_stock) || Number(product.stock ?? 0) <= 0,
    hasLimitedStock: Number(product.stock ?? 0) > 0 && Number(product.stock ?? 0) <= 5,
    minPurchaseQty: product.min_purchase_limit ?? product.minPurchaseLimit ?? 1,
    maxPurchaseQty: product.max_purchase_limit ?? product.maxPurchaseLimit ?? null,
    thumbnail: {
      url: product.images?.[0]?.imageUrl ?? null,
      alt: product.images?.[0]?.altText ?? null,
    },
  };
}

async function hydrateProducts(
  products: any[],
  opts: { withServiceability?: boolean; variantLimit?: number; withStoreSupport?: boolean },
) {
  const ids = [...new Set(products.map((p) => BigInt(p.id)))];
  if (!ids.length) return products;
  const inList = ids.map(() => '?').join(',');

  const [images, attrs, variants, vimgs, cities, pincodes] = await Promise.all([
    sqlQuery<any>(
      `SELECT * FROM product_images WHERE product_id IN (${inList}) ORDER BY sort_order ASC`,
      ids,
    ),
    sqlQuery<any>(
      `SELECT * FROM product_attributes WHERE product_id IN (${inList}) ORDER BY id ASC`,
      ids,
    ),
    sqlQuery<any>(
      `SELECT * FROM product_variants WHERE product_id IN (${inList}) AND is_active = 1 ORDER BY id ASC`,
      ids,
    ),
    sqlQuery<any>(
      `SELECT vi.* FROM variant_images vi JOIN product_variants pv ON pv.id = vi.variant_id WHERE pv.product_id IN (${inList}) ORDER BY vi.sort_order ASC`,
      ids,
    ),
    opts.withServiceability
      ? sqlQuery<any>(
          `SELECT * FROM product_serviceable_cities WHERE product_id IN (${inList})`,
          ids,
        )
      : Promise.resolve([]),
    opts.withServiceability
      ? sqlQuery<any>(
          `SELECT * FROM product_serviceable_pincodes WHERE product_id IN (${inList})`,
          ids,
        )
      : Promise.resolve([]),
  ]);

  const imgByPid = new Map<bigint, any[]>();
  for (const r of images) {
    const k = BigInt(r.product_id);
    const list = imgByPid.get(k) ?? [];
    list.push({
      id: r.id,
      productId: r.product_id,
      imageUrl: r.image_url,
      altText: r.alt_text,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    });
    imgByPid.set(k, list);
  }

  const attrByPid = new Map<bigint, any[]>();
  for (const r of attrs) {
    const k = BigInt(r.product_id);
    const list = attrByPid.get(k) ?? [];
    list.push({
      id: r.id,
      productId: r.product_id,
      attributeKey: r.attribute_key,
      attributeValue: r.attribute_value,
      createdAt: r.created_at,
    });
    attrByPid.set(k, list);
  }

  const vimgByVid = new Map<bigint, any[]>();
  for (const r of vimgs) {
    const k = BigInt(r.variant_id);
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

  const varByPid = new Map<bigint, any[]>();
  for (const r of variants) {
    const k = BigInt(r.product_id);
    const list = varByPid.get(k) ?? [];
    list.push({
      ...r,
      id: r.id,
      productId: r.product_id,
      variantName: r.variant_name,
      isActive: !!r.is_active,
      variantImages: vimgByVid.get(BigInt(r.id)) ?? [],
    });
    varByPid.set(k, list);
  }

  const cityByPid = new Map<bigint, any[]>();
  for (const r of cities) {
    const k = BigInt(r.product_id);
    const list = cityByPid.get(k) ?? [];
    list.push({ productId: r.product_id, city: r.city });
    cityByPid.set(k, list);
  }

  const pinByPid = new Map<bigint, any[]>();
  for (const r of pincodes) {
    const k = BigInt(r.product_id);
    const list = pinByPid.get(k) ?? [];
    list.push({ productId: r.product_id, pincode: r.pincode });
    pinByPid.set(k, list);
  }

  const mapped = products.map((p) => {
    const pid = BigInt(p.id);
    const allVariants = varByPid.get(pid) ?? [];
    const limitedVariants =
      typeof opts.variantLimit === 'number' ? allVariants.slice(0, opts.variantLimit) : allVariants;
    return {
      ...p,
      avgRating: toDecString(p.avg_rating ?? p.avgRating),
      defaultPrice: toDecString(p.default_price ?? p.defaultPrice),
      mrp: toDecString(p.mrp),
      images: imgByPid.get(pid) ?? [],
      attributes: attrByPid.get(pid) ?? [],
      variants: limitedVariants,
      serviceableCities: opts.withServiceability ? (cityByPid.get(pid) ?? []) : undefined,
      serviceablePincodes: opts.withServiceability ? (pinByPid.get(pid) ?? []) : undefined,
    };
  });
  return expandS3RefsDeep(mapped);
}

class PublicProductService {
  private constructor() {}

  public static getInstance(): PublicProductService {
    return new PublicProductService();
  }

  private buildListWhereSql(q: {
    categoryId?: string | undefined;
    categoryIds?: bigint[] | undefined;
    storeId?: string | undefined;
    district?: string | undefined;
    search?: string | undefined;
    minPrice?: number | undefined;
    maxPrice?: number | undefined;
    filters?: Record<string, string[]> | undefined;
  }): { whereSql: string; args: any[] } | null {
    const args: any[] = [];
    let whereSql =
      "p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1";

    if (q.categoryIds?.length) {
      whereSql += ` AND p.category_id IN (${q.categoryIds.map(() => '?').join(',')})`;
      args.push(...q.categoryIds);
    } else {
      const catId = parseOptionalBigintParam(q.categoryId);
      if (q.categoryId !== undefined && q.categoryId !== '' && catId === null) return null;
      if (catId != null) {
        whereSql += ' AND p.category_id = ?';
        args.push(catId);
      }
    }

    const sid = parseOptionalBigintParam(q.storeId);
    if (q.storeId !== undefined && q.storeId !== '' && sid === null) return null;
    if (sid != null) {
      whereSql += ' AND p.store_id = ?';
      args.push(sid);
    }

    if (q.search !== undefined && q.search.trim() !== '') {
      const term = `%${q.search.trim()}%`;
      whereSql += ' AND (p.product_name LIKE ? OR p.description LIKE ? OR p.brand LIKE ?)';
      args.push(term, term, term);
    }

    if (q.minPrice != null && !Number.isNaN(q.minPrice)) {
      whereSql += ' AND p.default_price >= ?';
      args.push(q.minPrice);
    }
    if (q.maxPrice != null && !Number.isNaN(q.maxPrice)) {
      whereSql += ' AND p.default_price <= ?';
      args.push(q.maxPrice);
    }

    if (q.district !== undefined && q.district.trim() !== '') {
      whereSql += ' AND p.district = ?';
      args.push(q.district.trim());
    }

    for (const [slug, values] of Object.entries(q.filters ?? {})) {
      const cleanValues = values.map(normalizeFilterToken).filter(Boolean);
      if (!cleanValues.length) continue;
      whereSql += ` AND EXISTS (
        SELECT 1
        FROM product_filters pf
        JOIN cms_filters f ON f.id = pf.filter_id
        JOIN cms_filter_values fv ON fv.id = pf.filter_value_id
        WHERE pf.product_id = p.id
          AND LOWER(REPLACE(REPLACE(TRIM(f.slug), ' ', '_'), '-', '_')) = ?
          AND LOWER(REPLACE(REPLACE(TRIM(fv.value), ' ', '-'), '_', '-')) IN (${cleanValues.map(() => '?').join(',')})
      )`;
      args.push(
        slug
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_'),
        ...cleanValues,
      );
    }

    return { whereSql, args };
  }

  private async getCategoryScopeIds(where: { whereSql: string; args: any[] }): Promise<bigint[]> {
    const rows = await sqlQuery<any>(
      `SELECT DISTINCT p.category_id as categoryId
       FROM products p
       JOIN stores s ON s.id = p.store_id
       JOIN categories c ON c.id = p.category_id
       JOIN product_verification v ON v.product_id = p.id
       WHERE ${where.whereSql}
         AND v.approval_status = 'approved'`,
      where.args,
    );
    return rows.map((row) => BigInt(row.categoryId));
  }

  private async listFiltersForCategories(
    categoryIds: bigint[],
    where: { whereSql: string; args: any[] },
  ) {
    if (!categoryIds.length) return [];
    const categoryPlaceholders = categoryIds.map(() => '?').join(',');

    const filterRows = await sqlQuery<any>(
      `SELECT
          f.id, f.name, f.slug, f.group_type, f.sort_order,
          MAX(cf.is_required) as is_required,
          MIN(cf.sort_order) as category_sort_order
       FROM category_filters cf
       JOIN cms_filters f ON f.id = cf.filter_id
       WHERE cf.category_id IN (${categoryPlaceholders})
         AND cf.is_active = 1
         AND f.is_active = 1
       GROUP BY f.id, f.name, f.slug, f.group_type, f.sort_order
       ORDER BY category_sort_order ASC, f.sort_order ASC, f.name ASC`,
      categoryIds,
    );

    if (!filterRows.length) return [];
    const filterIds = filterRows.map((row) => BigInt(row.id));
    const filterPlaceholders = filterIds.map(() => '?').join(',');

    const [valueRows, countRows] = await Promise.all([
      sqlQuery<any>(
        `SELECT id, filter_id, label, value, sort_order
         FROM cms_filter_values
         WHERE filter_id IN (${filterPlaceholders})
           AND is_active = 1
         ORDER BY sort_order ASC, label ASC`,
        filterIds,
      ),
      sqlQuery<any>(
        `SELECT
            f.id as filterId,
            fv.value,
            COUNT(DISTINCT p.id) as productCount
         FROM cms_filters f
         JOIN cms_filter_values fv ON fv.filter_id = f.id AND fv.is_active = 1
         JOIN category_filters cf ON cf.filter_id = f.id AND cf.is_active = 1
         JOIN products p ON p.category_id = cf.category_id
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
         JOIN product_verification v ON v.product_id = p.id
         JOIN product_filters pf ON pf.product_id = p.id
           AND pf.filter_id = f.id
           AND pf.filter_value_id = fv.id
         WHERE f.id IN (${filterPlaceholders})
           AND p.category_id IN (${categoryPlaceholders})
           AND ${where.whereSql}
           AND v.approval_status = 'approved'
         GROUP BY f.id, fv.value`,
        [...filterIds, ...categoryIds, ...where.args],
      ),
    ]);

    const valuesByFilter = new Map<string, any[]>();
    for (const row of valueRows) {
      const key = String(row.filter_id);
      const list = valuesByFilter.get(key) ?? [];
      list.push(row);
      valuesByFilter.set(key, list);
    }

    const counts = new Map<string, number>();
    for (const row of countRows) {
      counts.set(`${String(row.filterId)}:${String(row.value)}`, Number(row.productCount ?? 0));
    }

    return filterRows.map((filter) => ({
      id: filter.id,
      name: filter.name,
      slug: filter.slug,
      group_type: filter.group_type,
      is_required: Boolean(filter.is_required),
      values:
        filter.group_type === 'range'
          ? []
          : (valuesByFilter.get(String(filter.id)) ?? []).map((value) => ({
              label: value.label,
              value: value.value,
              productCount: counts.get(`${String(filter.id)}:${String(value.value)}`) ?? 0,
            })),
    }));
  }

  private async getActiveCategoryDescendantIds(slug: string): Promise<bigint[] | null> {
    const rows = await sqlQuery<any>(
      'SELECT id, parent_id as parentId, slug FROM categories WHERE is_active = 1',
    );
    const target = rows.find((r) => String(r.slug) === slug);
    if (!target) return null;

    const byParent = new Map<string, any[]>();
    for (const row of rows) {
      const key = row.parentId == null ? 'root' : String(row.parentId);
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    const ids: bigint[] = [];
    const visit = (node: any) => {
      ids.push(BigInt(String(node.id)));
      for (const child of byParent.get(String(node.id)) ?? []) visit(child);
    };
    visit(target);
    return ids;
  }

  public listCatalog = async (req: Request, res: Response) => {
    try {
      const parsed = publicCatalogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', parsed.error);
      }
      const q = parsed.data;

      const hasCategoryId = q.categoryId !== undefined && q.categoryId !== '';
      let categoryFilterIds: bigint[] | undefined;
      let queryForWhere: Parameters<typeof this.buildListWhereSql>[0] = q;
      if (hasCategoryId) {
        const catId = parseOptionalBigintParam(q.categoryId);
        if (catId !== null) categoryFilterIds = [catId];
      } else if (q.categorySlug !== undefined && q.categorySlug.trim() !== '') {
        const categoryIds = await this.getActiveCategoryDescendantIds(q.categorySlug.trim());
        if (!categoryIds) {
          return ApiResponse.notFound(res, 'Category not found');
        }
        categoryFilterIds = categoryIds;
        queryForWhere = { ...q, categoryIds };
      }

      const where = this.buildListWhereSql(queryForWhere);
      if (!where) {
        return ApiResponse.badRequest(res, 'Invalid categoryId or storeId');
      }

      const page = q.page;
      const limit = q.limit;
      const skip = (page - 1) * limit;

      const orderBy = orderByForSort(q.sort);
      const [baseRows, totalRows] = await Promise.all([
        sqlQuery<any>(
          `SELECT p.*, 
            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
           FROM products p
           JOIN stores s ON s.id = p.store_id
           JOIN categories c ON c.id = p.category_id
           JOIN product_verification v ON v.product_id = p.id  -- ✅ ADDED
           WHERE ${where.whereSql}
            AND v.approval_status = 'approved'    -- ✅ ADDED
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
          [...where.args, limit, skip],
        ),
        sqlQuery<{ total: number }>(
          `SELECT COUNT(*) as total
           FROM products p
           JOIN stores s ON s.id = p.store_id
           JOIN categories c ON c.id = p.category_id
           JOIN product_verification v ON v.product_id = p.id   -- ADD THIS
           WHERE ${where.whereSql}
          AND v.approval_status = 'approved'`,
          where.args,
        ),
      ]);
      const total = Number(totalRows?.[0]?.total ?? 0);
      const rows = await hydrateProducts(
        baseRows.map((r) => ({
          ...r,
          id: r.id,
          store: {
            id: r.store_id_join,
            storeName: r.store_name,
            storeSlug: r.store_slug,
            description: r.store_description,
            isActive: !!r.store_is_active,
          },
          category: {
            id: r.category_id_join,
            name: r.category_name,
            slug: r.category_slug,
            domainCode: r.category_domain,
            isActive: !!r.category_is_active,
          },
        })),
        { variantLimit: 12, withServiceability: false },
      );

      const totalPages = Math.ceil(total / limit);
      const categoryScopeIds = categoryFilterIds ?? (await this.getCategoryScopeIds(where));
      const filters = await this.listFiltersForCategories(categoryScopeIds, where);

      return ApiResponse.success(
        res,
        'Products fetched successfully',
        {
          filters,
          products: rows.map(toPublicProductCard),
        },
        {
          page,
          limit,
          total,
          totalPages,
        },
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching products', error);
    }
  };

  //   public listProductsForAdmin = async (req: Request, res: Response) => {
  //   try {
  //     const rows = await sqlQuery<any>(
  //       `
  //       SELECT
  //         p.*,

  //         v.approval_status AS approval_status,
  //         v.reason AS rejection_reason,

  //         s.id AS store_id_join,
  //         s.store_name,

  //         c.id AS category_id_join,
  //         c.name AS category_name

  //       FROM products p

  //       LEFT JOIN product_verification v
  //         ON v.product_id = p.id

  //       LEFT JOIN stores s
  //         ON s.id = p.store_id

  //       LEFT JOIN categories c
  //         ON c.id = p.category_id

  //       ORDER BY p.created_at DESC
  //       `
  //     );

  //     const products = await hydrateProducts(
  //       rows.map((r) => ({
  //         ...r,

  //         approval_status: r.approval_status || "pending",
  //         rejection_reason: r.rejection_reason,

  //         store: {
  //           id: r.store_id_join,
  //           storeName: r.store_name,
  //         },

  //         category: {
  //           id: r.category_id_join,
  //           name: r.category_name,
  //         },
  //       })),
  //       { variantLimit: 12, withServiceability: false }
  //     );

  //     return ApiResponse.success(
  //       res,
  //       "Admin products fetched successfully",
  //       products
  //     );
  //   } catch (error) {
  //     return ApiResponse.serverError(
  //       res,
  //       "Error fetching admin products",
  //       error
  //     );
  //   }
  // };

  //   public listCatalog = async (req: Request, res: Response) => {
  //   try {
  //     const parsed = publicCatalogQuerySchema.safeParse(req.query);
  //     if (!parsed.success) {
  //       return ApiResponse.badRequest(res, "Invalid query parameters", parsed.error);
  //     }

  //     const q = parsed.data;

  //     const where = this.buildListWhereSql(q);
  //     if (!where) {
  //       return ApiResponse.badRequest(res, "Invalid categoryId or storeId");
  //     }

  //     const page = q.page;
  //     const limit = q.limit;
  //     const skip = (page - 1) * limit;

  //     const orderBy = orderByForSort(q.sort);

  //     const [baseRows, totalRows] = await Promise.all([
  //       sqlQuery<any>(
  //         `SELECT
  //             p.*,

  //             v.approval_status AS approval_status,
  //             v.reason AS rejection_reason,

  //             s.id AS store_id_join,
  //             s.store_name,
  //             s.store_slug,
  //             s.description AS store_description,
  //             s.is_active AS store_is_active,

  //             c.id AS category_id_join,
  //             c.name AS category_name,
  //             c.slug AS category_slug,
  //             c.domain AS category_domain,
  //             c.is_active AS category_is_active

  //          FROM products p
  //          JOIN stores s ON s.id = p.store_id
  //          JOIN categories c ON c.id = p.category_id
  //          JOIN product_verification v ON v.product_id = p.id

  //          WHERE ${where.whereSql}
  //            AND v.approval_status = 'approved'

  //          ORDER BY ${orderBy}
  //          LIMIT ? OFFSET ?`,
  //         [...where.args, limit, skip],
  //       ),

  //       sqlQuery<{ total: number }>(
  //         `SELECT COUNT(*) AS total
  //          FROM products p
  //          JOIN stores s ON s.id = p.store_id
  //          JOIN categories c ON c.id = p.category_id
  //          JOIN product_verification v ON v.product_id = p.id

  //          WHERE ${where.whereSql}
  //            AND v.approval_status = 'approved'`,
  //         where.args,
  //       ),
  //     ]);

  //     const total = Number(totalRows?.[0]?.total ?? 0);

  //     const rows = await hydrateProducts(
  //       baseRows.map((r) => ({
  //         ...r,

  //         approval_status: r.approval_status,
  //         rejection_reason: r.rejection_reason,

  //         id: r.id,
  //         store: {
  //           id: r.store_id_join,
  //           storeName: r.store_name,
  //           storeSlug: r.store_slug,
  //           description: r.store_description,
  //           isActive: !!r.store_is_active,
  //         },
  //         category: {
  //           id: r.category_id_join,
  //           name: r.category_name,
  //           slug: r.category_slug,
  //           domainCode: r.category_domain,
  //           isActive: !!r.category_is_active,
  //         },
  //       })),
  //       { variantLimit: 12, withServiceability: false },
  //     );

  //     const totalPages = Math.ceil(total / limit);

  //     return ApiResponse.success(res, "Products fetched successfully", rows, {
  //       page,
  //       limit,
  //       total,
  //       totalPages,
  //     });
  //   } catch (error) {
  //     return ApiResponse.serverError(res, "Error fetching products", error);
  //   }
  // };

  public listProductsForAdmin = async (req: Request, res: Response) => {
    try {
      if (!req.user || ![UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(req.user.role as any)) {
        return ApiResponse.forbidden(res, 'Admin access required');
      }

      // ✅ Get page & limit from query (default: page=1, limit=10)
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const isSuperAdmin = req.user.role === UserRole.SUPER_ADMIN;
      const countRows = await sqlQuery<{ total: number }>(
        `
      SELECT COUNT(*) AS total
      FROM products p
      ${isSuperAdmin ? '' : 'JOIN admin_district_assignments ada ON ada.admin_id = ? AND LOWER(TRIM(ada.district_name)) = LOWER(TRIM(p.district))'}
      `,
        isSuperAdmin ? [] : [req.user.id],
      );
      const total = Number(countRows?.[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const rows = await sqlQuery<any>(
        `
      SELECT 
        p.*,

        v.approval_status AS approval_status,
        v.reason AS rejection_reason,

        s.id AS store_id_join,
        s.store_name,

        c.id AS category_id_join,
        c.name AS category_name

      FROM products p

      LEFT JOIN product_verification v 
        ON v.product_id = p.id

      LEFT JOIN stores s 
        ON s.id = p.store_id

      LEFT JOIN categories c 
        ON c.id = p.category_id

      ${isSuperAdmin ? '' : 'JOIN admin_district_assignments ada ON ada.admin_id = ? AND LOWER(TRIM(ada.district_name)) = LOWER(TRIM(p.district))'}

      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
      `,
        isSuperAdmin ? [limit, offset] : [req.user.id, limit, offset],
      );

      const products = await hydrateProducts(
        rows.map((r) => ({
          ...r,

          approval_status: r.approval_status || 'pending',
          rejection_reason: r.rejection_reason,

          store: {
            id: r.store_id_join,
            storeName: r.store_name,
          },

          category: {
            id: r.category_id_join,
            name: r.category_name,
          },
        })),
        { variantLimit: 12, withServiceability: false },
      );

      return ApiResponse.success(res, 'Admin products fetched successfully', {
        page,
        limit,
        total,
        totalPages,
        count: products.length,
        data: products,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching admin products', error);
    }
  };

  public listByCategorySlug = async (req: Request, res: Response) => {
    try {
      const slug = slugParam(req.params.slug).trim();
      if (!slug) {
        return ApiResponse.badRequest(res, 'Invalid category slug');
      }

      const parsed = publicCatalogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', parsed.error);
      }
      const q = parsed.data;

      const categoryIds = await this.getActiveCategoryDescendantIds(slug);
      if (!categoryIds) {
        return ApiResponse.notFound(res, 'Category not found');
      }

      const where = this.buildListWhereSql({ ...q, categoryIds });
      if (!where) {
        return ApiResponse.badRequest(res, 'Invalid storeId');
      }

      const page = q.page;
      const limit = q.limit;
      const skip = (page - 1) * limit;
      const orderBy = orderByForSort(q.sort);

      const [baseRows, totalRows] = await Promise.all([
        sqlQuery<any>(
          `SELECT p.*, 
            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
           FROM products p
           JOIN stores s ON s.id = p.store_id
           JOIN categories c ON c.id = p.category_id
           JOIN product_verification v ON v.product_id = p.id
           WHERE ${where.whereSql}
             AND v.approval_status = 'approved'
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
          [...where.args, limit, skip],
        ),
        sqlQuery<{ total: number }>(
          `SELECT COUNT(*) as total
           FROM products p
           JOIN stores s ON s.id = p.store_id
           JOIN categories c ON c.id = p.category_id
           JOIN product_verification v ON v.product_id = p.id
           WHERE ${where.whereSql}
             AND v.approval_status = 'approved'`,
          where.args,
        ),
      ]);

      const total = Number(totalRows?.[0]?.total ?? 0);
      const rows = await hydrateProducts(
        baseRows.map((r) => ({
          ...r,
          id: r.id,
          store: {
            id: r.store_id_join,
            storeName: r.store_name,
            storeSlug: r.store_slug,
            description: r.store_description,
            isActive: !!r.store_is_active,
          },
          category: {
            id: r.category_id_join,
            name: r.category_name,
            slug: r.category_slug,
            domainCode: r.category_domain,
            isActive: !!r.category_is_active,
          },
        })),
        { variantLimit: 12, withServiceability: false },
      );
      const filters = await this.listFiltersForCategories(categoryIds, where);

      return ApiResponse.success(
        res,
        'Products fetched by category successfully',
        {
          filters,
          products: rows.map(toPublicProductCard),
        },
        {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          categorySlug: slug,
        },
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching products by category', error);
    }
  };

  public listProductCategoryTree = async (_req: Request, res: Response) => {
    try {
      const [categoryRows, productRows] = await Promise.all([
        sqlQuery<any>(
          'SELECT id, parent_id as parentId, domain as domainCode, name, slug, is_active as isActive FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC',
        ),
        sqlQuery<any>(
          `SELECT p.category_id as categoryId, COUNT(*) as productCount
           FROM products p
           JOIN stores s ON s.id = p.store_id
           JOIN categories c ON c.id = p.category_id
           JOIN product_verification v ON v.product_id = p.id
           WHERE p.publish_status = 'publish'
             AND p.visibility = 'PUBLIC'
             AND s.is_active = 1
             AND s.deleted_at IS NULL
             AND c.is_active = 1
             AND v.approval_status = 'approved'
           GROUP BY p.category_id`,
        ),
      ]);

      const counts = new Map<string, number>();
      for (const row of productRows) {
        counts.set(String(row.categoryId), Number(row.productCount ?? 0));
      }

      const byParent = new Map<string, any[]>();
      for (const row of categoryRows) {
        const key = row.parentId == null ? 'root' : String(row.parentId);
        const list = byParent.get(key) ?? [];
        list.push({ ...row, children: [], productCount: counts.get(String(row.id)) ?? 0 });
        byParent.set(key, list);
      }

      const attach = (node: any, depth: number): any | null => {
        const children = (byParent.get(String(node.id)) ?? [])
          .map((child) => attach(child, depth + 1))
          .filter(Boolean);
        const directProductCount = counts.get(String(node.id)) ?? 0;
        const childProductCount = children.reduce(
          (sum: number, child: any) => sum + Number(child.productCount ?? 0),
          0,
        );
        const productCount = directProductCount + childProductCount;
        if (productCount <= 0) return null;

        return {
          ...node,
          children,
          level: depth,
          productCount,
          is_selectable: children.length === 0 && directProductCount > 0,
        };
      };

      const roots = (byParent.get('root') ?? []).map((root) => attach(root, 0)).filter(Boolean);
      return ApiResponse.success(res, 'Category tree fetched successfully', roots);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error building category tree', error);
    }
  };

  public getById = async (req: Request, res: Response) => {
    try {
      const id = parseOptionalBigintParam(req.params.product_id);
      if (id === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }
      const user = (req as any).user;
      const isSellerOrAdmin =
        user && ['seller', 'admin', 'super_admin'].includes(String(user.role || '').toLowerCase());

      const base = await sqlQuery<any>(
        `SELECT p.*, 
              v.approval_status AS approval_status,   -- ✅ ADD THIS
              v.reason AS rejection_reason,           -- ✅ OPTIONAL

            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.support_email, s.support_phone, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
         FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
           LEFT JOIN product_verification v ON v.product_id = p.id 
         WHERE ${isSellerOrAdmin ? 'p.id = ? AND s.deleted_at IS NULL' : "p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1 AND v.approval_status = 'approved'"}
         LIMIT 1`,
        [id],
      );
      const hydrated = await hydrateProducts(
        base.map((r) => ({
          ...r,
          store: {
            id: r.store_id_join,
            storeName: r.store_name,
            storeSlug: r.store_slug,
            description: r.store_description,
            supportEmail: r.support_email,
            supportPhone: r.support_phone,
            isActive: !!r.store_is_active,
          },
          category: {
            id: r.category_id_join,
            name: r.category_name,
            slug: r.category_slug,
            domainCode: r.category_domain,
            isActive: !!r.category_is_active,
          },
        })),
        { withServiceability: true },
      );
      const product = hydrated[0] ?? null;

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      return ApiResponse.success(res, 'Product fetched successfully', product);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching product', error);
    }
  };

  public getByIdForAdmin = async (req: Request, res: Response) => {
    const id = parseOptionalBigintParam(req.params.product_id);
    if (id === null) {
      return ApiResponse.badRequest(res, 'Invalid product id');
    }

    if (!req.user || ![UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(req.user.role as any)) {
      return ApiResponse.forbidden(res, 'Admin access required');
    }

    const access = await canModerateProduct(
      { id: Number(req.user.id), role: String(req.user.role) },
      id,
    );
    if (!access.ok) {
      if (access.status === 404) return ApiResponse.notFound(res, access.message);
      return ApiResponse.forbidden(res, access.message);
    }

    return this.getById(req, res);
  };

  public getBySlug = async (req: Request, res: Response) => {
    try {
      const slug = slugParam(req.params.slug).trim();

      if (!slug) {
        return ApiResponse.badRequest(res, 'Invalid slug');
      }
      const user = (req as any).user;
      const isSellerOrAdmin =
        user && ['seller', 'admin', 'super_admin'].includes(String(user.role || '').toLowerCase());

      const base = await sqlQuery<any>(
        `SELECT p.*, 
            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.support_email, s.support_phone, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
         FROM products p  
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN product_verification v ON v.product_id = p.id
         WHERE ${isSellerOrAdmin ? 'p.alias_slug = ? AND s.deleted_at IS NULL' : "p.alias_slug = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1 AND v.approval_status = 'approved'"}
         LIMIT 1`,
        [slug],
      );
      const hydrated = await hydrateProducts(
        base.map((r) => ({
          ...r,
          store: {
            id: r.store_id_join,
            storeName: r.store_name,
            storeSlug: r.store_slug,
            description: r.store_description,
            supportEmail: r.support_email,
            supportPhone: r.support_phone,
            isActive: !!r.store_is_active,
          },
          category: {
            id: r.category_id_join,
            name: r.category_name,
            slug: r.category_slug,
            domainCode: r.category_domain,
            isActive: !!r.category_is_active,
          },
        })),
        { withServiceability: true },
      );
      const product = hydrated[0] ?? null;

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      return ApiResponse.success(res, 'Product fetched successfully', product);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching product', error);
    }
  };

  public listRelated = async (req: Request, res: Response) => {
    try {
      const id = parseOptionalBigintParam(req.params.product_id);
      if (id === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }

      const qParsed = publicRelatedQuerySchema.safeParse(req.query);
      if (!qParsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', qParsed.error);
      }
      const limit = qParsed.data.limit;

      const baseRows = await sqlQuery<any>(
        `SELECT p.id, p.category_id FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
          JOIN product_verification v ON v.product_id = p.id
         WHERE p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
           AND v.approval_status = 'approved'
         LIMIT 1`,
        [id],
      );
      const base = baseRows[0] ?? null;

      if (!base) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const relRows = await sqlQuery<any>(
        `SELECT p.*, 
            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
         FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
         JOIN product_verification v ON v.product_id = p.id
         WHERE p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
            AND v.approval_status = 'approved'
           AND p.id <> ?
           AND p.category_id = ?
         ORDER BY p.sort_order ASC, p.created_at DESC
         LIMIT ?`,
        [base.id, base.category_id, limit],
      );
      const related = await hydrateProducts(
        relRows.map((r) => ({
          ...r,
          store: {
            id: r.store_id_join,
            storeName: r.store_name,
            storeSlug: r.store_slug,
            description: r.store_description,
            isActive: !!r.store_is_active,
          },
          category: {
            id: r.category_id_join,
            name: r.category_name,
            slug: r.category_slug,
            domainCode: r.category_domain,
            isActive: !!r.category_is_active,
          },
        })),
        { variantLimit: 12, withServiceability: false },
      );

      return ApiResponse.success(res, 'Related products fetched successfully', related);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching related products', error);
    }
  };

  public listReviews = async (req: Request, res: Response) => {
    try {
      const productId = parseOptionalBigintParam(req.params.product_id);
      if (productId === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }

      const existsRows = await sqlQuery<any>(
        `SELECT p.id FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
         WHERE p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
         LIMIT 1`,
        [productId],
      );
      const exists = existsRows[0] ?? null;
      if (!exists) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const qParsed = publicReviewsQuerySchema.safeParse(req.query);
      if (!qParsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', qParsed.error);
      }
      const { page, limit } = qParsed.data;
      const skip = (page - 1) * limit;

      const [reviews, totalRows] = await Promise.all([
        sqlQuery<any>(
          'SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
          [productId, limit, skip],
        ),
        sqlQuery<{ total: number }>(
          'SELECT COUNT(*) as total FROM product_reviews WHERE product_id = ?',
          [productId],
        ),
      ]);
      const total = Number(totalRows?.[0]?.total ?? 0);

      const userIds = [
        ...new Set(reviews.map((r) => r.userId).filter((u): u is number => u != null)),
      ];
      const users =
        userIds.length > 0
          ? await sqlQuery<any>(
              `SELECT id, name, avatar FROM User WHERE id IN (${userIds.map(() => '?').join(',')})`,
              userIds,
            )
          : [];
      const userMap = new Map(users.map((u) => [u.id, u]));

      const data = reviews.map((r) => ({
        ...r,
        user: r.user_id != null ? (userMap.get(r.user_id) ?? null) : null,
      }));

      const totalPages = Math.ceil(total / limit);

      return ApiResponse.success(res, 'Reviews fetched successfully', data, {
        page,
        limit,
        total,
        totalPages,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching reviews', error);
    }
  };

  public reviewStats = async (req: Request, res: Response) => {
    try {
      const productId = parseOptionalBigintParam(req.params.product_id);
      if (productId === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }

      const existsRows = await sqlQuery<any>(
        `SELECT p.id, p.avg_rating, p.review_count FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
        JOIN product_verification v ON v.product_id = p.id
         WHERE p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
            AND v.approval_status = 'approved'
         LIMIT 1`,
        [productId],
      );
      const exists = existsRows[0] ?? null;
      if (!exists) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const grouped = await sqlQuery<any>(
        'SELECT rating, COUNT(*) as cnt FROM product_reviews WHERE product_id = ? GROUP BY rating',
        [productId],
      );

      const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      for (const row of grouped) {
        counts[String(row.rating)] = Number(row.cnt ?? 0);
      }

      return ApiResponse.success(res, 'Review stats fetched successfully', {
        averageRating: toDecString(exists.avg_rating),
        totalReviews: Number(exists.review_count ?? 0),
        counts,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching review stats', error);
    }
  };

  public checkPincode = async (req: Request, res: Response) => {
    try {
      const productId = parseOptionalBigintParam(req.params.product_id);
      if (productId === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }

      const pincodeRaw = req.query.pincode;
      const pincode =
        typeof pincodeRaw === 'string'
          ? pincodeRaw.trim()
          : Array.isArray(pincodeRaw)
            ? String(pincodeRaw[0] ?? '').trim()
            : '';

      if (!pincode || !/^\d{3,10}$/.test(pincode)) {
        return ApiResponse.badRequest(res, 'Valid pincode query parameter is required');
      }

      const rows = await sqlQuery<any>(
        `SELECT p.id, p.force_out_of_stock, p.availability_mode
         FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
            JOIN product_verification v ON v.product_id = p.id
         WHERE p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
             AND v.approval_status = 'approved'
         LIMIT 1`,
        [productId],
      );
      const product = rows[0] ?? null;

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.force_out_of_stock) {
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: false,
          pincode,
          reason: 'out_of_stock',
          availabilityMode: product.availability_mode,
        });
      }

      const mode = product.availability_mode;

      if (mode === 'ALL_INDIA' || mode === 'SELLER_DEFAULT') {
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: true,
          pincode,
          availabilityMode: mode,
        });
      }

      if (mode === 'PINCODES') {
        const row = await sqlQuery<any>(
          'SELECT 1 as ok FROM product_serviceable_pincodes WHERE product_id = ? AND pincode = ? LIMIT 1',
          [productId, pincode],
        );
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: row.length > 0,
          pincode,
          availabilityMode: mode,
        });
      }

      if (mode === 'CITIES') {
        const cities = await sqlQuery<any>(
          'SELECT city FROM product_serviceable_cities WHERE product_id = ?',
          [productId],
        );
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: true,
          pincode,
          availabilityMode: mode,
          note:
            cities.length > 0
              ? 'City-restricted delivery; confirm eligibility at checkout.'
              : undefined,
        });
      }

      return ApiResponse.success(res, 'Pincode check completed', {
        serviceable: true,
        pincode,
        availabilityMode: mode,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error checking pincode', error);
    }
  };

  public variantStock = async (req: Request, res: Response) => {
    try {
      const variantId = parseOptionalBigintParam(req.params.variant_id);
      if (variantId === null) {
        return ApiResponse.badRequest(res, 'Invalid variant id');
      }

      const vrows = await sqlQuery<any>(
        `SELECT pv.id, pv.product_id, pv.is_active
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
            JOIN product_verification v ON v.product_id = p.id
         WHERE pv.id = ? AND pv.is_active = 1 AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
           AND v.approval_status = 'approved'
         LIMIT 1`,
        [variantId],
      );
      const variant = vrows[0] ?? null;

      if (!variant) {
        return ApiResponse.notFound(res, 'Variant not found');
      }

      const inv = await sqlQuery<any>(
        'SELECT qty_on_hand, qty_reserved FROM inventory WHERE variant_id = ?',
        [variantId],
      );
      let available = 0;
      for (const row of inv) {
        available += Math.max(0, Number(row.qty_on_hand ?? 0));
      }

      return ApiResponse.success(res, 'Stock fetched successfully', {
        variantId: variant.id,
        productId: variant.product_id,
        availableQty: available,
        inStock: available > 0,
        isActive: !!variant.is_active,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching stock', error);
    }
  };

  public addReview = async (req: Request, res: Response) => {
    try {
      const productId = parseOptionalBigintParam(req.params.product_id);
      if (productId === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }

      const bodyParsed = addProductReviewBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return ApiResponse.badRequest(res, 'Invalid request body', bodyParsed.error);
      }
      const { rating, reviewText } = bodyParsed.data;

      const productRows = await sqlQuery<any>(
        `SELECT p.id FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
          JOIN product_verification v ON v.product_id = p.id
         WHERE p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
          AND v.approval_status = 'approved'
         LIMIT 1`,
        [productId],
      );
      const product = productRows[0] ?? null;
      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const userId = req.user?.id ?? null;

      await withSqlTransaction(async (tx) => {
        await sqlExec(
          'INSERT INTO product_reviews (product_id, user_id, rating, review_text) VALUES (?, ?, ?, ?)',
          [productId, userId, rating, reviewText ?? null],
          tx,
        );
        const agg = await sqlQuery<any>(
          'SELECT AVG(rating) as avgRating, COUNT(*) as cnt FROM product_reviews WHERE product_id = ?',
          [productId],
          tx,
        );
        const avg = agg?.[0]?.avgRating ?? 0;
        const cnt = agg?.[0]?.cnt ?? 0;
        await sqlExec(
          'UPDATE products SET review_count = ?, avg_rating = ? WHERE id = ?',
          [cnt, avg, productId],
          tx,
        );
      });

      return ApiResponse.created(res, 'Review submitted successfully', {
        productId: productId.toString(),
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error submitting review', error);
    }
  };

  // public searchProducts2 = async (req: Request, res: Response) => {
  //   try {
  //     const search = String(req.query.search || '').trim();

  //     if (!search) {
  //       return ApiResponse.success(res, 'Products fetched successfully', []);
  //     }

  //     const likeSearch = `%${search}%`;

  //     const rows = await sqlQuery<any>(
  //       `
  //     SELECT
  //       p.id,
  //       p.product_name,
  //       p.slug,
  //       p.default_price,
  //       p.mrp,
  //       p.avg_rating,
  //       p.review_count,
  //       p.district,
  //       p.thumbnail,
  //       c.name AS category_name,
  //       s.store_name
  //     FROM products p
  //     JOIN stores s ON s.id = p.store_id
  //     JOIN categories c ON c.id = p.category_id
  //     JOIN product_verification v ON v.product_id = p.id
  //     WHERE
  //       p.publish_status = 'publish'
  //       AND p.visibility = 'PUBLIC'
  //       AND s.is_active = 1
  //       AND s.deleted_at IS NULL
  //       AND c.is_active = 1
  //       AND v.approval_status = 'approved'
  //       AND (
  //         p.product_name LIKE ?
  //         OR c.name LIKE ?
  //         OR s.store_name LIKE ?
  //         OR p.district LIKE ?
  //       )
  //     ORDER BY p.id DESC
  //     LIMIT 20
  //     `,
  //       [likeSearch, likeSearch, likeSearch, likeSearch],
  //     );

  //     return ApiResponse.success(res, 'Products fetched successfully', rows);
  //   } catch (error) {
  //     return ApiResponse.serverError(res, 'Error searching products', error);
  //   }
  // };

  public searchProducts2 = async (req: Request, res: Response) => {
    try {
      const search = String(req.query.search || '').trim();

      if (!search) {
        return ApiResponse.success(res, 'Products fetched successfully', []);
      }

      const likeSearch = `%${search}%`;

      const rows = await sqlQuery<any>(
        `
  SELECT
    p.id,
    p.product_name,
    p.default_price,
    p.mrp,
    p.avg_rating,
    p.review_count,
    p.district,
    p.description,
    c.name AS category_name,
    s.store_name,

    (
      SELECT pi.image_url
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.sort_order ASC
      LIMIT 1
    ) AS imageUrl

  FROM products p
  JOIN stores s ON s.id = p.store_id
  JOIN categories c ON c.id = p.category_id
  JOIN product_verification v ON v.product_id = p.id

  WHERE
    p.publish_status = 'publish'
    AND p.visibility = 'PUBLIC'
    AND s.is_active = 1
    AND s.deleted_at IS NULL
    AND c.is_active = 1
    AND v.approval_status = 'approved'
    AND (
      p.product_name LIKE ?
      OR p.description LIKE ?
      OR c.name LIKE ?
      OR s.store_name LIKE ?
      OR p.district LIKE ?
    )

  ORDER BY p.id DESC
  LIMIT 20
  `,
        [likeSearch, likeSearch, likeSearch, likeSearch, likeSearch],
      );

      return ApiResponse.success(
        res,
        'Products fetched successfully',
        await expandS3RefsDeep(rows),
      );
    } catch (error) {
      return ApiResponse.serverError(res, 'Error searching products', error);
    }
  };
}

export const publicProductService = PublicProductService.getInstance();
