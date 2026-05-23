import express from 'express';
import { validate } from '~/middleware/validate';
import { sellerAuthMiddleware } from '~/middleware/seller.middleware';
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
import { authMiddleware } from '~/middleware/auth.middleware';

const router = express.Router();

router.post(
  '/onboarding/step-1-register',
  validate({ body: RegisterSchema }),
  onboardingStep1Register,
);

router.put(
  '/onboarding/step-2-profile',
  authMiddleware, //  add
  validate({ body: UpdateSellerProfileBodySchema }),
  onboardingStep2Profile,
);
router.post(
  '/onboarding/step-3-store',
  authMiddleware, //
  validate({ body: CreateStoreBodySchema }),
  onboardingStep3Store,
);
router.post(
  '/onboarding/step-4-pickup',
  authMiddleware,
  validate({ body: OnboardingStep4BodySchema }),
  onboardingStep4Pickup,
);

router.get('/categories/tree', listCatalogCategoryTree);

/** Bearer access token or refresh cookie; role must be SELLER or ADMIN */
router.use(sellerAuthMiddleware);

router.get('/categories', listCatalogCategories);

router.get('/categories/:category_id/filters', listCatalogCategoryFilters);
router.post('/product-images/upload', productImageUpload.single('file'), uploadSellerProductImage);
router.post('/size-charts/upload', sizeChartUpload.single('file'), uploadSellerSizeChart);

router.get('/profile', getSellerProfileHandler);
router.put('/profile', validate({ body: UpdateSellerProfileBodySchema }), putSellerProfileHandler);

router.get('/dashboard/summary', getDashboardSummaryHandler);

router.post('/stores', validate({ body: CreateStoreBodySchema }), createStoreHandler);
router.get('/stores', listStoresHandler);

router.get('/stores/seller/:sellerUserId', getStoreBySellerUserIdHandler);
router.get('/stores/:storeId', getStoreByIdHandler);

router.get('/stores/:storeId', validate({ params: StoreIdParamsSchema }), getStoreHandler);
router.put(
  '/stores/:storeId',
  validate({ params: StoreIdParamsSchema, body: UpdateStoreBodySchema }),
  updateStoreHandler,
);
router.delete('/stores/:storeId', validate({ params: StoreIdParamsSchema }), deleteStoreHandler);

router.post(
  '/stores/:storeId/locations/pickup',
  validate({ params: StoreIdParamsSchema, body: CreateStoreLocationBodySchema }),
  createPickupLocationHandler,
);
router.post(
  '/stores/:storeId/locations/return',
  validate({ params: StoreIdParamsSchema, body: CreateStoreLocationBodySchema }),
  createReturnLocationHandler,
);
router.post(
  '/stores/:storeId/locations/delivery',
  validate({ params: StoreIdParamsSchema, body: CreateStoreLocationBodySchema }),
  createDeliveryLocationHandler,
);
router.post(
  '/stores/:storeId/locations/both',
  validate({ params: StoreIdParamsSchema, body: CreatePickupAndReturnBodySchema }),
  createBothLocationsHandler,
);

/** Product CRUD & inventory (same auth as other seller routes) */
router.use('/stores/:store_id/products', sellerProductRouter);
router.use('/products', sellerProductRouter);

export { router as sellerRouter };
