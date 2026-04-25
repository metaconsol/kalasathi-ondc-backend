import type { z } from 'zod';
import {
  createProductSchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema,
  updateInventorySchema,
  setServiceabilitySchema,
  listProductsParamsSchema,
} from './product.schema';

export type CreateProductDTO = z.infer<typeof createProductSchema>;
export type UpdateProductDTO = z.infer<typeof updateProductSchema>;
export type CreateVariantDTO = z.infer<typeof createVariantSchema>;
export type UpdateVariantDTO = z.infer<typeof updateVariantSchema>;

export interface CreateProductImageDTO {
  imageUrl?: string | undefined;
  altText?: string | undefined;
  sortOrder?: number | undefined;
}

export type UpdateInventoryDTO = z.infer<typeof updateInventorySchema>;
export type SetServiceabilityDTO = z.infer<typeof setServiceabilitySchema>;
export type ListProductsParams = z.infer<typeof listProductsParamsSchema>;
