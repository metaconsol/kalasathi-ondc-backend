import express, { type Request, type Response } from 'express';
import { authRouter } from './auth.route';
import { testRouter } from './test.route';
import { ApiResponse } from '~/lib/response';

// Unified CMS & Feature Routes
import cmsRoutes from './cms/cms.routes';
import { sellerRouter } from './seller.route';
import uiProductRouter from './ui/product.route';
import contactRoutes from './contact.route';
import adminRouter from './admin.route';
import { cartRouter } from './cart.route';
import { orderRouter } from './order.route';
import locationRouter from './location.route';
import { addressRouter } from './address.route';
import { userRouter } from './user.route';
import { districtRouter } from './district.route';
import { wishlistRouter } from './wishlist.route';
import { reviewRouter } from './review.route';
import { ticketRouter } from './ticket.route';

const router = express.Router();

/**
 * API Status Endpoint
 */
router.get('/', (_req: Request, res: Response) => {
  return ApiResponse.success(res, 'ODOP API v1 is operational');
});

/**
 * Authentication Routes
 */
router.use('/auth', authRouter);

/**
 * 🛠 Feature Routes
 */
router.use('/cms', cmsRoutes);
router.use('/seller', sellerRouter);
router.use('/contact', contactRoutes);
router.use('/cart', cartRouter);
router.use('/orders', orderRouter);
router.use('/user', userRouter);
router.use('/user/wishlist', wishlistRouter);
router.use('/addresses', addressRouter);
router.use('/locations', locationRouter);
router.use('/districts', districtRouter);
router.use('/', adminRouter); // Mounted at root as it has prefix in admin.route.ts

/**
 * Utilities & Testing
 */
router.use('/test', testRouter);

router.use('/ui/products', uiProductRouter);

// Review Route.
router.use('/review', reviewRouter);

//ticket
router.use('/tickets', ticketRouter);

//Search

export default router;
