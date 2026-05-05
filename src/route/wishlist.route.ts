import express from 'express';
import { authMiddleware } from '~/middleware/auth.middleware';
import * as wishlistController from '~/controller/wishlist.controller';

const router = express.Router();

// All wishlist routes require authentication
router.use(authMiddleware);

router.get('/', wishlistController.getWishlist);
router.post('/toggle', wishlistController.toggleWishlist);

export { router as wishlistRouter };
