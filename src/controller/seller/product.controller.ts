import type { Request, Response } from 'express';
import { env } from '~/config/env.config';
import { productService } from '~/service/product/product.sql.service';
import {
  createProductSchema,
  updateProductSchema,
  updateInventorySchema,
  setServiceabilitySchema,
  listProductsParamsSchema,
  normalizeSellerProductBody,
  normalizeProductNestedInBody,
  normalizeInventoryBody,
} from '~/service/product/product.schema';
import { ApiResponse } from '~/lib/response';
import { parseRequiredBigintParam, resolveSellerStoreContext } from './resolveSellerStore';
import { buildObjectKey, isS3Enabled, putS3Object, resolveS3KeyToUrl } from '~/lib/s3';
import { UserRole } from '~/lib/userRole';

function sellerProductBodyFromRequest(req: Request): Record<string, unknown> {
  return normalizeProductNestedInBody(
    normalizeSellerProductBody(req.body) as Record<string, unknown>,
  );
}

async function mergeProductImageFiles(
  body: Record<string, unknown>,
  files: Express.Multer.File[] | undefined,
): Promise<Record<string, unknown>> {
  if (!files?.length) return body;
  const base = body.images;
  const existing = Array.isArray(base) ? base : [];
  const prefix = env.serverUrl.replace(/\/$/, '');
  const fromFiles = await Promise.all(
    files.map(async (f) => {
      if (isS3Enabled()) {
        const buf = f.buffer;
        if (!buf?.length) {
          throw new Error('S3 uploads require buffered file data (memory storage)');
        }
        const key = buildObjectKey('uploads/productImages', f.originalname);
        await putS3Object(key, buf, f.mimetype);
        return { imageUrl: `s3:${key}` };
      }
      return { imageUrl: `${prefix}/uploads/productImages/${f.filename}` };
    }),
  );
  return { ...body, images: [...existing, ...fromFiles] };
}

/**
 * @desc    List active categories (catalog)
 * @route   GET /api/v1/seller/categories
 */
export const listCatalogCategories = async (req: Request, res: Response) => {
  try {
    return productService.listCatalogCategories(req, res);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error listing categories', error);
  }
};

/**
 * @desc    Catalog category tree (Mrignayanee-style `getUITree`)
 * @route   GET /api/v1/seller/categories/tree
 */
export const listCatalogCategoryTree = async (req: Request, res: Response) => {
  try {
    return productService.listCatalogCategoryTree(req, res);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error listing category tree', error);
  }
};

/**
 * @desc    CMS filters and values assigned to one catalog category
 * @route   GET /api/v1/seller/categories/:category_id/filters
 */
export const listCatalogCategoryFilters = async (req: Request, res: Response) => {
  try {
    const categoryId = parseRequiredBigintParam(req.params.category_id);
    if (categoryId === null) {
      return ApiResponse.badRequest(res, 'Invalid category_id');
    }
    return productService.listCategoryFilters(res, categoryId);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error listing category filters', error);
  }
};

/**
 * @desc    Get one product (seller / admin)
 * @route   GET /api/v1/seller/stores/:store_id/products/:product_id
 *          GET /api/v1/seller/products/:product_id
 */
export const getProduct = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }
    return productService.getStoreProduct(req, res, resolved.storeId, productId);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error fetching product', error);
  }
};

/**
 * @desc    Upload one product/variant image file; returns public `imageUrl` for JSON payloads
 * @route   POST /api/v1/seller/product-images/upload  (multipart field `file`)
 */
export const uploadSellerProductImage = async (req: Request, res: Response) => {
  try {
    const f = (req as Request & { file?: Express.Multer.File }).file;
    if (!f) {
      return ApiResponse.badRequest(res, 'file is required');
    }
    if (isS3Enabled()) {
      const buf = f.buffer;
      if (!buf?.length) {
        return ApiResponse.badRequest(res, 'empty file');
      }
      const key = buildObjectKey('uploads/productImages', f.originalname);
      await putS3Object(key, buf, f.mimetype);
      const storageRef = `s3:${key}`;
      const imageUrl = await resolveS3KeyToUrl(key);
      return ApiResponse.success(res, 'Uploaded', { imageUrl, storageRef });
    }
    const prefix = env.serverUrl.replace(/\/$/, '');
    const imageUrl = `${prefix}/uploads/productImages/${f.filename}`;
    return ApiResponse.success(res, 'Uploaded', { imageUrl, storageRef: imageUrl });
  } catch (error) {
    return ApiResponse.serverError(res, 'Error uploading image', error);
  }
};

/**
 * @desc    Upload one size chart image file; returns public `imageUrl` for sizeChartUrl
 * @route   POST /api/v1/seller/size-charts/upload  (multipart field `file`)
 */
export const uploadSellerSizeChart = async (req: Request, res: Response) => {
  try {
    const f = (req as Request & { file?: Express.Multer.File }).file;
    if (!f) {
      return ApiResponse.badRequest(res, 'file is required');
    }
    if (isS3Enabled()) {
      const buf = f.buffer;
      if (!buf?.length) {
        return ApiResponse.badRequest(res, 'empty file');
      }
      const key = buildObjectKey('uploads/sizeCharts', f.originalname);
      await putS3Object(key, buf, f.mimetype);
      const storageRef = `s3:${key}`;
      const imageUrl = await resolveS3KeyToUrl(key);
      return ApiResponse.success(res, 'Uploaded', { imageUrl, storageRef });
    }
    const prefix = env.serverUrl.replace(/\/$/, '');
    const imageUrl = `${prefix}/uploads/sizeCharts/${f.filename}`;
    return ApiResponse.success(res, 'Uploaded', { imageUrl, storageRef: imageUrl });
  } catch (error) {
    return ApiResponse.serverError(res, 'Error uploading size chart', error);
  }
};

/**
 * @desc    List all products for a store
 * @route   GET /api/v1/seller/stores/:store_id/products
 */
export const listProducts = async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSellerStoreContext(req, {});
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const paramsResult = listProductsParamsSchema.safeParse(req.query);

    if (!paramsResult.success) {
      return ApiResponse.badRequest(res, 'Invalid query parameters', paramsResult.error);
    }

    return productService.listProducts(req, res, resolved.storeId, paramsResult.data);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error listing products', error);
  }
};

/**
 * @desc    Create a new product
 * @route   POST /api/v1/seller/stores/:store_id/products
 */
export const createProduct = async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSellerStoreContext(req, {});
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const merged = await mergeProductImageFiles(
      sellerProductBodyFromRequest(req),
      req.files as Express.Multer.File[] | undefined,
    );
    const bodyResult = createProductSchema.safeParse(merged);

    if (!bodyResult.success) {
      return ApiResponse.badRequest(res, 'Invalid request body', bodyResult.error);
    }

    return productService.createProduct(req, res, resolved.storeId, bodyResult.data);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error creating product', error);
  }
};

export const approveProduct = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return ApiResponse.forbidden(res, 'Super admin access required');
    }

    const { productId } = req.params;

    // ✅ FIX: validate productId
    if (!productId || Array.isArray(productId)) {
      return ApiResponse.badRequest(res, 'Invalid productId');
    }

    return productService.approveProduct(req, res, BigInt(productId));
  } catch (error) {
    return ApiResponse.serverError(res, 'Error approving product', error);
  }
};

export const rejectProduct = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return ApiResponse.forbidden(res, 'Super admin access required');
    }

    const { productId } = req.params;
    const { reason } = req.body;

    // ✅ FIX: validate productId
    if (!productId || Array.isArray(productId)) {
      return ApiResponse.badRequest(res, 'Invalid productId');
    }

    return productService.rejectProduct(req, res, BigInt(productId), reason);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error rejecting product', error);
  }
};

/**
 * @desc    Update a product
 * @route   PATCH/PUT /api/v1/seller/products/:product_id
 */
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const merged = await mergeProductImageFiles(
      sellerProductBodyFromRequest(req),
      req.files as Express.Multer.File[] | undefined,
    );
    const bodyResult = updateProductSchema.safeParse(merged);

    if (!bodyResult.success) {
      return ApiResponse.badRequest(res, 'Invalid request body', bodyResult.error);
    }

    return productService.updateProduct(req, res, resolved.storeId, productId, bodyResult.data);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error updating product', error);
  }
};

/**
 * @desc    Delete a product
 * @route   DELETE /api/v1/seller/products/:product_id
 */
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    return productService.deleteProduct(req, res, resolved.storeId, productId);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error deleting product', error);
  }
};

/**
 * @desc    Delete a product image
 * @route   DELETE /api/v1/seller/products/:product_id/images/:image_id
 */
export const deleteProductImage = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const imageId = parseRequiredBigintParam(req.params.image_id);
    if (imageId === null) {
      return ApiResponse.badRequest(res, 'Invalid image_id');
    }

    return productService.deleteProductImage(req, res, resolved.storeId, productId, imageId);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error deleting product image', error);
  }
};

/**
 * @desc    Delete one variant gallery image (`variant_images`)
 * @route   DELETE /api/v1/seller/.../products/:product_id/variants/:variant_id/images/:image_id
 */
export const deleteVariantImage = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const variantId = parseRequiredBigintParam(req.params.variant_id);
    if (variantId === null) {
      return ApiResponse.badRequest(res, 'Invalid variant_id');
    }

    const imageId = parseRequiredBigintParam(req.params.image_id);
    if (imageId === null) {
      return ApiResponse.badRequest(res, 'Invalid image_id');
    }

    return productService.deleteVariantImage(
      req,
      res,
      resolved.storeId,
      productId,
      variantId,
      imageId,
    );
  } catch (error) {
    return ApiResponse.serverError(res, 'Error deleting variant image', error);
  }
};

/**
 * @desc    Reorder product images
 * @route   PUT /api/v1/seller/products/:product_id/images/reorder
 */
export const reorderProductImages = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const raw = req.body as { image_ids?: unknown; imageIds?: unknown };
    const image_ids = raw.image_ids ?? raw.imageIds;

    if (!Array.isArray(image_ids)) {
      return ApiResponse.badRequest(res, 'image_ids must be an array');
    }

    const imageIds = image_ids.map((id: unknown) => BigInt(String(id)));

    return productService.reorderProductImages(req, res, resolved.storeId, productId, imageIds);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error reordering product images', error);
  }
};

/**
 * @desc    Update inventory
 * @route   PUT /api/v1/seller/products/:product_id/inventory
 */
export const updateInventory = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const bodyResult = updateInventorySchema.safeParse(normalizeInventoryBody(req.body));

    if (!bodyResult.success) {
      return ApiResponse.badRequest(res, 'Invalid request body', bodyResult.error);
    }

    return productService.updateInventory(req, res, resolved.storeId, productId, bodyResult.data);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error updating inventory', error);
  }
};

/**
 * @desc    Set serviceability (cities and pincodes)
 * @route   PUT /api/v1/seller/products/:product_id/serviceability
 */
export const setServiceability = async (req: Request, res: Response) => {
  try {
    const productId = parseRequiredBigintParam(req.params.product_id);
    if (productId === null) {
      return ApiResponse.badRequest(res, 'Invalid product_id');
    }
    const resolved = await resolveSellerStoreContext(req, { productId });
    if (!resolved.ok) {
      return ApiResponse.custom(res, resolved.message, resolved.status);
    }

    const bodyResult = setServiceabilitySchema.safeParse(req.body);

    if (!bodyResult.success) {
      return ApiResponse.badRequest(res, 'Invalid request body', bodyResult.error);
    }

    return productService.setServiceability(req, res, resolved.storeId, productId, bodyResult.data);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error setting serviceability', error);
  }
};
