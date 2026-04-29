import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';
import type { Request, Response } from 'express';
import {
  publicCatalogQuerySchema,
  publicRelatedQuerySchema,
  publicReviewsQuerySchema,
  addProductReviewBodySchema,
} from './product.schema';

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

  return products.map((p) => {
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
}

class PublicProductService {
  private constructor() {}

  public static getInstance(): PublicProductService {
    return new PublicProductService();
  }

  private buildListWhereSql(q: {
    categoryId?: string | undefined;
    storeId?: string | undefined;
    search?: string | undefined;
    minPrice?: number | undefined;
    maxPrice?: number | undefined;
  }): { whereSql: string; args: any[] } | null {
    const args: any[] = [];
    let whereSql =
      "p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1";

    const catId = parseOptionalBigintParam(q.categoryId);
    if (q.categoryId !== undefined && q.categoryId !== '' && catId === null) return null;
    if (catId != null) {
      whereSql += ' AND p.category_id = ?';
      args.push(catId);
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

    return { whereSql, args };
  }

  public listCatalog = async (req: Request, res: Response) => {
    try {
      const parsed = publicCatalogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', parsed.error);
      }
      const q = parsed.data;

      const where = this.buildListWhereSql(q);
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

      return ApiResponse.success(res, 'Products fetched successfully', rows, {
        page,
        limit,
        total,
        totalPages,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching products', error);
    }
  };

  public getById = async (req: Request, res: Response) => {
    try {
      const id = parseOptionalBigintParam(req.params.product_id);
      if (id === null) {
        return ApiResponse.badRequest(res, 'Invalid product id');
      }

      const base = await sqlQuery<any>(
        `SELECT p.*, 
            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.support_email, s.support_phone, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
         FROM products p
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
           JOIN product_verification v ON v.product_id = p.id 
         WHERE p.id = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
             AND v.approval_status = 'approved'
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

  public getBySlug = async (req: Request, res: Response) => {
    try {
      const slug = slugParam(req.params.slug).trim();

      if (!slug) {
        return ApiResponse.badRequest(res, 'Invalid slug');
      }

      const base = await sqlQuery<any>(
        `SELECT p.*, 
            s.id as store_id_join, s.store_name, s.store_slug, s.description as store_description, s.support_email, s.support_phone, s.is_active as store_is_active,
            c.id as category_id_join, c.name as category_name, c.slug as category_slug, c.domain as category_domain, c.is_active as category_is_active
         FROM products p  
         JOIN stores s ON s.id = p.store_id
         JOIN categories c ON c.id = p.category_id
         JOIN product_verification v ON v.product_id = p.id
         WHERE p.alias_slug = ? AND p.publish_status = 'publish' AND p.visibility = 'PUBLIC' AND s.is_active = 1 AND s.deleted_at IS NULL AND c.is_active = 1
          AND v.approval_status = 'approved'
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
}

export const publicProductService = PublicProductService.getInstance();
