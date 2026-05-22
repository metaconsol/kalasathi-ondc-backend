import express from 'express';
import { optionalAccessToken } from '~/middleware/optionalAccess.middleware';
import { authMiddleware } from '~/middleware/auth.middleware';
import { isAdmin } from '~/middleware/admin.middleware';
import {
  listPublicProducts,
  listAdminProducts,
  searchPublicProducts,
  listPublicProductCategoryTree,
  listPublicProductsByCategory,
  getPublicProductById,
  getPublicProductBySlug,
  getRelatedProducts,
  listProductReviews,
  getProductReviewStats,
  getAdminProductById,
  checkProductPincode,
  getVariantStock,
  addProductReview,
  searchPublicProducts2,
} from '~/controller/public/product.controller';

const router = express.Router();

/**
 * GET /ui/products — catalog list (filters: page, limit, sort, categoryId, storeId, search, minPrice, maxPrice)
 */
router.get('/', listPublicProducts);
router.get('/admin/products', authMiddleware, isAdmin, listAdminProducts);
router.get('/admin/products/:product_id', authMiddleware, isAdmin, getAdminProductById);

/**
 * GET /ui/products/search — same behavior as list (category / price filters)
 */
router.get('/search', searchPublicProducts);

/**
 * GET /ui/products/categories/tree — category tree pruned to categories that have public products
 */
router.get('/categories/tree', listPublicProductCategoryTree);

/**
 * GET /ui/products/category/:slug — public products in a category slug or its descendants
 */
router.get('/category/:slug', listPublicProductsByCategory);

/**
 * GET /ui/products/variants/:variant_id/stock
 */
router.get('/variants/:variant_id/stock', getVariantStock);

/**
 * GET /ui/products/slug/:slug
 */
router.get('/slug/:slug', optionalAccessToken, getPublicProductBySlug);

/**
 * GET /ui/products/:product_id/reviews/stats
 */
router.get('/:product_id/reviews/stats', getProductReviewStats);

/**
 * GET /ui/products/:product_id/related
 */
router.get('/:product_id/related', getRelatedProducts);

/**
 * GET /ui/products/:product_id/check-pincode?pincode=
 */
router.get('/:product_id/check-pincode', checkProductPincode);

/**
 * GET /ui/products/:product_id/reviews
 */
router.get('/:product_id/reviews', listProductReviews);

/**
 * POST /ui/products/:product_id/reviews — optional Bearer token attaches review to user
 */
router.post('/:product_id/reviews', optionalAccessToken, addProductReview);

/**
 * GET /ui/products/:product_id
 */
router.get('/:product_id', optionalAccessToken, getPublicProductById);

// ✅ add this BEFORE router.get('/:product_id', ...)

router.get('/search/bar', searchPublicProducts2);

export default router;
