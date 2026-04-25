import { Prisma } from '~/generated/prisma/client';
import { db } from '~/lib/db';
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

const catalogBaseWhere: Prisma.ProductWhereInput = {
  publishStatus: 'publish',
  visibility: 'PUBLIC',
  store: { isActive: true, deletedAt: null },
  category: { isActive: true },
};

function orderByForSort(
  sort: string,
): Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return { createdAt: 'desc' };
    case 'price_asc':
      return { defaultPrice: 'asc' };
    case 'price_desc':
      return { defaultPrice: 'desc' };
    case 'popular':
    default:
      return [{ reviewCount: 'desc' }, { avgRating: 'desc' }, { createdAt: 'desc' }];
  }
}

const listInclude = {
  category: true,
  attributes: true,
  store: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      description: true,
      isActive: true,
    },
  },
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: {
    where: { isActive: true },
    orderBy: { id: 'asc' as const },
    take: 12,
    include: {
      variantImages: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
} satisfies Prisma.ProductInclude;

const detailInclude = {
  category: true,
  attributes: true,
  store: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      description: true,
      supportEmail: true,
      supportPhone: true,
      isActive: true,
    },
  },
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: {
    where: { isActive: true },
    orderBy: { id: 'asc' as const },
    include: {
      variantImages: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  serviceableCities: true,
  serviceablePincodes: true,
} satisfies Prisma.ProductInclude;

class PublicProductService {
  private constructor() {}

  public static getInstance(): PublicProductService {
    return new PublicProductService();
  }

  private buildListWhere(q: {
    categoryId?: string | undefined;
    storeId?: string | undefined;
    search?: string | undefined;
    minPrice?: number | undefined;
    maxPrice?: number | undefined;
  }): Prisma.ProductWhereInput | null {
    const where: Prisma.ProductWhereInput = { ...catalogBaseWhere };

    const catId = parseOptionalBigintParam(q.categoryId);
    if (q.categoryId !== undefined && q.categoryId !== '' && catId === null) {
      return null;
    }
    if (catId != null) {
      where.categoryId = catId;
    }

    const sid = parseOptionalBigintParam(q.storeId);
    if (q.storeId !== undefined && q.storeId !== '' && sid === null) {
      return null;
    }
    if (sid != null) {
      where.storeId = sid;
    }

    if (q.search !== undefined && q.search.trim() !== '') {
      const term = q.search.trim();
      where.OR = [
        { productName: { contains: term } },
        { description: { contains: term } },
        { brand: { contains: term } },
      ];
    }

    const priceFilter: Prisma.DecimalFilter = {};
    if (q.minPrice != null && !Number.isNaN(q.minPrice)) {
      priceFilter.gte = new Prisma.Decimal(String(q.minPrice));
    }
    if (q.maxPrice != null && !Number.isNaN(q.maxPrice)) {
      priceFilter.lte = new Prisma.Decimal(String(q.maxPrice));
    }
    if (Object.keys(priceFilter).length > 0) {
      where.defaultPrice = priceFilter;
    }

    return where;
  }

  public listCatalog = async (req: Request, res: Response) => {
    try {
      const parsed = publicCatalogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', parsed.error);
      }
      const q = parsed.data;

      const where = this.buildListWhere(q);
      if (!where) {
        return ApiResponse.badRequest(res, 'Invalid categoryId or storeId');
      }

      const page = q.page;
      const limit = q.limit;
      const skip = (page - 1) * limit;

      const [rows, total] = await Promise.all([
        db.product.findMany({
          where,
          skip,
          take: limit,
          orderBy: orderByForSort(q.sort),
          include: listInclude,
        }),
        db.product.count({ where }),
      ]);

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

      const product = await db.product.findFirst({
        where: {
          id,
          ...catalogBaseWhere,
        },
        include: detailInclude,
      });

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

      const product = await db.product.findFirst({
        where: {
          aliasSlug: slug,
          ...catalogBaseWhere,
        },
        include: detailInclude,
      });

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

      const base = await db.product.findFirst({
        where: { id, ...catalogBaseWhere },
        select: { id: true, categoryId: true },
      });

      if (!base) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const related = await db.product.findMany({
        where: {
          ...catalogBaseWhere,
          id: { not: base.id },
          categoryId: base.categoryId,
        },
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: listInclude,
      });

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

      const exists = await db.product.findFirst({
        where: { id: productId, ...catalogBaseWhere },
        select: { id: true },
      });
      if (!exists) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const qParsed = publicReviewsQuerySchema.safeParse(req.query);
      if (!qParsed.success) {
        return ApiResponse.badRequest(res, 'Invalid query parameters', qParsed.error);
      }
      const { page, limit } = qParsed.data;
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        db.productReview.findMany({
          where: { productId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        db.productReview.count({ where: { productId } }),
      ]);

      const userIds = [
        ...new Set(reviews.map((r) => r.userId).filter((u): u is number => u != null)),
      ];
      const users =
        userIds.length > 0
          ? await db.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true, avatar: true },
            })
          : [];
      const userMap = new Map(users.map((u) => [u.id, u]));

      const data = reviews.map((r) => ({
        ...r,
        user: r.userId != null ? (userMap.get(r.userId) ?? null) : null,
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

      const exists = await db.product.findFirst({
        where: { id: productId, ...catalogBaseWhere },
        select: { id: true, avgRating: true, reviewCount: true },
      });
      if (!exists) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const grouped = await db.productReview.groupBy({
        by: ['rating'],
        where: { productId },
        _count: { rating: true },
      });

      const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      for (const row of grouped) {
        counts[String(row.rating)] = row._count.rating;
      }

      return ApiResponse.success(res, 'Review stats fetched successfully', {
        averageRating: exists.avgRating,
        totalReviews: exists.reviewCount,
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

      const product = await db.product.findFirst({
        where: { id: productId, ...catalogBaseWhere },
        select: {
          id: true,
          forceOutOfStock: true,
          availabilityMode: true,
        },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.forceOutOfStock) {
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: false,
          pincode,
          reason: 'out_of_stock',
          availabilityMode: product.availabilityMode,
        });
      }

      const mode = product.availabilityMode;

      if (mode === 'ALL_INDIA' || mode === 'SELLER_DEFAULT') {
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: true,
          pincode,
          availabilityMode: mode,
        });
      }

      if (mode === 'PINCODES') {
        const row = await db.productServiceablePincode.findUnique({
          where: {
            productId_pincode: { productId, pincode },
          },
        });
        return ApiResponse.success(res, 'Pincode check completed', {
          serviceable: !!row,
          pincode,
          availabilityMode: mode,
        });
      }

      if (mode === 'CITIES') {
        const cities = await db.productServiceableCity.findMany({
          where: { productId },
          select: { city: true },
        });
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

      const variant = await db.productVariant.findFirst({
        where: {
          id: variantId,
          isActive: true,
          product: { is: catalogBaseWhere },
        },
        select: {
          id: true,
          isActive: true,
          productId: true,
          inventory: {
            select: { qtyOnHand: true, qtyReserved: true },
          },
        },
      });

      if (!variant) {
        return ApiResponse.notFound(res, 'Variant not found');
      }

      let available = 0;
      for (const row of variant.inventory) {
        // available += Math.max(0, row.qtyOnHand - row.qtyReserved);
        available += Math.max(0, row.qtyOnHand);
      }

      return ApiResponse.success(res, 'Stock fetched successfully', {
        variantId: variant.id,
        productId: variant.productId,
        availableQty: available,
        inStock: available > 0,
        isActive: variant.isActive,
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

      const product = await db.product.findFirst({
        where: { id: productId, ...catalogBaseWhere },
        select: { id: true },
      });
      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      const userId = req.user?.id ?? null;

      await db.$transaction(async (tx) => {
        await tx.productReview.create({
          data: {
            productId,
            userId,
            rating,
            reviewText: reviewText ?? null,
          },
        });

        const agg = await tx.productReview.aggregate({
          where: { productId },
          _avg: { rating: true },
          _count: true,
        });

        await tx.product.update({
          where: { id: productId },
          data: {
            reviewCount: agg._count,
            avgRating:
              agg._avg.rating != null
                ? new Prisma.Decimal(String(agg._avg.rating))
                : new Prisma.Decimal(0),
          },
        });
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
