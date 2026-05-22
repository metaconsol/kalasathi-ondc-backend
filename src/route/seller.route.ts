import express from 'express';

import { validate } from '~/middleware/validate';
import { sellerAuthMiddleware } from '~/middleware/seller.middleware';
import { requireApprovedSeller } from '~/middleware/requireApprovedSeller.middleware';

import { RegisterSchema } from '~/service/auth/auth.schema';

import {
  CreatePickupAndReturnBodySchema,
  CreateStoreBodySchema,
  CreateStoreLocationBodySchema,
  OnboardingStep4BodySchema,
  StoreIdParamsSchema,
  UpdateSellerProfileBodySchema,
  UpdateStoreBodySchema,
} from '~/service/seller/seller.schema';

import {
  onboardingStep1Register,
  getSellerProfileHandler,
  putSellerProfileHandler,
  getDashboardSummaryHandler,
  listStoresHandler,
  createStoreHandler,
  getStoreHandler,
  updateStoreHandler,
  deleteStoreHandler,
  createPickupLocationHandler,
  createReturnLocationHandler,
  createDeliveryLocationHandler,
  createBothLocationsHandler,
  onboardingStep2Profile,
  onboardingStep3Store,
  onboardingStep4Pickup,
  getStoreBySellerUserIdHandler,
  getStoreByIdHandler,
} from '~/controller/seller.controller';

import { sellerProductRouter } from './seller/product.route';

import {
  listCatalogCategories,
  listCatalogCategoryFilters,
  listCatalogCategoryTree,
  uploadSellerProductImage,
  uploadSellerSizeChart,
} from '~/controller/seller/product.controller';

import { productImageUpload, sizeChartUpload } from '~/middleware/multer';

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                               PUBLIC ROUTES                                */
/* -------------------------------------------------------------------------- */

router.post(
  '/onboarding/step-1-register',
  validate({ body: RegisterSchema }),
  onboardingStep1Register,
);

router.get('/categories/tree', listCatalogCategoryTree);

/* -------------------------------------------------------------------------- */
/*                        LOGIN + SELLER ROLE REQUIRED                        */
/* -------------------------------------------------------------------------- */

router.use(sellerAuthMiddleware);

/* -------------------------------------------------------------------------- */
/*                PENDING / REJECTED SELLER CAN ACCESS THESE                  */
/* -------------------------------------------------------------------------- */

router.put(
  '/onboarding/step-2-profile',
  validate({ body: UpdateSellerProfileBodySchema }),
  onboardingStep2Profile,
);

router.post(
  '/onboarding/step-3-store',
  validate({ body: CreateStoreBodySchema }),
  onboardingStep3Store,
);

router.post(
  '/onboarding/step-4-pickup',
  validate({ body: OnboardingStep4BodySchema }),
  onboardingStep4Pickup,
);

router.get('/profile', getSellerProfileHandler);

router.put('/profile', validate({ body: UpdateSellerProfileBodySchema }), putSellerProfileHandler);

/* -------------------------------------------------------------------------- */
/*                     ONLY APPROVED SELLER AFTER THIS                        */
/* -------------------------------------------------------------------------- */

router.use(requireApprovedSeller);

router.get('/categories', listCatalogCategories);

router.get('/categories/:category_id/filters', listCatalogCategoryFilters);

router.post('/product-images/upload', productImageUpload.single('file'), uploadSellerProductImage);

router.post('/size-charts/upload', sizeChartUpload.single('file'), uploadSellerSizeChart);

router.get('/dashboard/summary', getDashboardSummaryHandler);

router.post('/stores', validate({ body: CreateStoreBodySchema }), createStoreHandler);

router.get('/stores', listStoresHandler);

router.get('/stores/seller/:sellerUserId', getStoreBySellerUserIdHandler);

router.get('/stores/:storeId', getStoreByIdHandler);

router.get('/stores/:storeId', validate({ params: StoreIdParamsSchema }), getStoreHandler);

router.put(
  '/stores/:storeId',
  validate({
    params: StoreIdParamsSchema,
    body: UpdateStoreBodySchema,
  }),
  updateStoreHandler,
);

router.delete('/stores/:storeId', validate({ params: StoreIdParamsSchema }), deleteStoreHandler);

router.post(
  '/stores/:storeId/locations/pickup',
  validate({
    params: StoreIdParamsSchema,
    body: CreateStoreLocationBodySchema,
  }),
  createPickupLocationHandler,
);

router.post(
  '/stores/:storeId/locations/return',
  validate({
    params: StoreIdParamsSchema,
    body: CreateStoreLocationBodySchema,
  }),
  createReturnLocationHandler,
);

router.post(
  '/stores/:storeId/locations/delivery',
  validate({
    params: StoreIdParamsSchema,
    body: CreateStoreLocationBodySchema,
  }),
  createDeliveryLocationHandler,
);

router.post(
  '/stores/:storeId/locations/both',
  validate({
    params: StoreIdParamsSchema,
    body: CreatePickupAndReturnBodySchema,
  }),
  createBothLocationsHandler,
);

/* -------------------------------------------------------------------------- */
/*                               PRODUCT ROUTES                               */
/* -------------------------------------------------------------------------- */

router.use('/stores/:store_id/products', sellerProductRouter);

router.use('/products', sellerProductRouter);

export { router as sellerRouter };
