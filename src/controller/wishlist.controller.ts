import type { Request, Response, NextFunction } from 'express';
import { sqlExec, sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';

/**
 * Toggle a product in user's wishlist
 * POST /api/v1/user/wishlist/toggle
 */
export const toggleWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { productId } = req.body;

    if (!productId) {
      return ApiResponse.badRequest(res, 'Product ID is required');
    }

    const [existingRows] = await sqlQuery<any>(
      'SELECT id FROM wishlist WHERE user_id = ? AND product_id = ? LIMIT 1',
      [userId, BigInt(productId)],
    );

    if (existingRows) {
      await sqlExec('DELETE FROM wishlist WHERE id = ?', [existingRows.id]);
      return ApiResponse.success(res, 'Product removed from wishlist', { inWishlist: false });
    } else {
      await sqlExec(
        'INSERT INTO wishlist (user_id, product_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))',
        [userId, BigInt(productId)],
      );
      return ApiResponse.success(res, 'Product added to wishlist', { inWishlist: true });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get user's wishlist
 * GET /api/v1/user/wishlist
 */
export const getWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;

    const wishlistRows = await sqlQuery<any>(
      `SELECT w.*, 
        p.id as p_id, p.product_name, p.default_price, p.mrp, p.stock, p.district, p.store_id, p.category_id
       FROM wishlist w
       JOIN products p ON p.id = w.product_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
      [userId],
    );

    if (!wishlistRows.length) {
      return ApiResponse.success(res, 'Wishlist fetched successfully', []);
    }

    const productIds = wishlistRows.map((r) => r.product_id);
    const inList = productIds.map(() => '?').join(',');

    // Fetch one image per product
    const images = await sqlQuery<any>(
      `
  SELECT pi.*
  FROM product_images pi
  INNER JOIN (
    SELECT product_id, MIN(sort_order) AS first_sort
    FROM product_images
    WHERE product_id IN (${inList})
    GROUP BY product_id
  ) x
    ON x.product_id = pi.product_id
   AND x.first_sort = pi.sort_order
  `,
      productIds,
    );

    const imgMap = new Map(images.map((img) => [img.product_id.toString(), img]));

    const transformedItems = wishlistRows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      productId: row.product_id.toString(),
      createdAt: row.created_at,
      product: {
        id: row.p_id.toString(),
        productName: row.product_name,
        defaultPrice: row.default_price.toString(),
        mrp: row.mrp.toString(),
        stock: row.stock.toString(),
        district: row.district,
        storeId: row.store_id.toString(),
        categoryId: row.category_id.toString(),
        images: imgMap.has(row.product_id.toString())
          ? [imgMap.get(row.product_id.toString())]
          : [],
      },
    }));

    return ApiResponse.success(res, 'Wishlist fetched successfully', transformedItems);
  } catch (error) {
    next(error);
  }
};
