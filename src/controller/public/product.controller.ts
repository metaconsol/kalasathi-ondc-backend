import type { Request, Response } from 'express';
import { publicProductService } from '~/service/product/publicProduct.service';

export const listPublicProducts = (req: Request, res: Response) =>
  publicProductService.listCatalog(req, res);

//added of admin show Product
export const listAdminProducts = (req: Request, res: Response) => {
  return publicProductService.listProductsForAdmin(req, res);
};

export const getAdminProductById = (req: Request, res: Response) =>
  publicProductService.getByIdForAdmin(req, res);

export const searchPublicProducts = (req: Request, res: Response) =>
  publicProductService.listCatalog(req, res);

export const listPublicProductCategoryTree = (req: Request, res: Response) =>
  publicProductService.listProductCategoryTree(req, res);

export const listPublicProductsByCategory = (req: Request, res: Response) =>
  publicProductService.listByCategorySlug(req, res);

export const getPublicProductById = (req: Request, res: Response) =>
  publicProductService.getById(req, res);

export const getPublicProductBySlug = (req: Request, res: Response) =>
  publicProductService.getBySlug(req, res);

export const getRelatedProducts = (req: Request, res: Response) =>
  publicProductService.listRelated(req, res);

export const listProductReviews = (req: Request, res: Response) =>
  publicProductService.listReviews(req, res);

export const getProductReviewStats = (req: Request, res: Response) =>
  publicProductService.reviewStats(req, res);

export const checkProductPincode = (req: Request, res: Response) =>
  publicProductService.checkPincode(req, res);

export const getVariantStock = (req: Request, res: Response) =>
  publicProductService.variantStock(req, res);

export const addProductReview = (req: Request, res: Response) =>
  publicProductService.addReview(req, res);

export const searchPublicProducts2 = (req: Request, res: Response) =>
  publicProductService.searchProducts2(req, res);
