import express from 'express';
import { productImageUpload } from '~/middleware/multer';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  reorderProductImages,
  updateInventory,
  setServiceability,
  approveProduct,
  rejectProduct,
} from '~/controller/seller/product.controller';

const router = express.Router({ mergeParams: true });

const uploadMany = productImageUpload.array('images', 20);

// ─── Store Products Routes ────────────────────────────────────────────────────
// Prefixed with /seller/stores/:store_id/products

/**
 * GET /seller/stores/:store_id/products
 * List all products for a store
 */
router.get('/', listProducts);

/**
 * GET /seller/.../products/:product_id
 * Get one product (for edit)
 */
router.get('/:product_id', getProduct);

/**
 * POST /seller/stores/:store_id/products
 * Create product (JSON or multipart). Optional `images` in body and/or file field `images[]`.
 * Optional `variants` to create a multi-variant product; omit for a single default variant.
 */
router.post('/', uploadMany, createProduct);
router.patch('/:productId/approve', approveProduct);
router.patch('/:productId/reject', rejectProduct);

// ─── Product routes (also under /seller/products) ────────────────────────────
// update/delete are mounted at /seller/stores/:store_id/products/:product_id and /seller/products/:product_id

/**
 * PATCH/PUT /seller/.../products/:product_id
 * Update product; optional `images` (append), `variants` (new rows or `{ id, ... }` patches), `removeVariantIds`
 */
router.patch('/:product_id', uploadMany, updateProduct);
router.put('/:product_id', uploadMany, updateProduct);

/**
 * DELETE /seller/.../products/:product_id
 */
router.delete('/:product_id', deleteProduct);

// ─── Product images (dedicated) ─────────────────────────────────────────────

/**
 * DELETE /seller/.../products/:product_id/images/:image_id
 */
router.delete('/:product_id/images/:image_id', deleteProductImage);

/**
 * PUT /seller/.../products/:product_id/images/reorder
 * Body: { image_ids: bigint[] } or { imageIds: [] }
 */
router.put('/:product_id/images/reorder', reorderProductImages);

// ─── Inventory & serviceability ─────────────────────────────────────────────

/**
 * PUT /seller/.../products/:product_id/inventory
 */
router.put('/:product_id/inventory', updateInventory);

/**
 * PUT /seller/.../products/:product_id/serviceability
 */
router.put('/:product_id/serviceability', setServiceability);

export const sellerProductRouter = router;
