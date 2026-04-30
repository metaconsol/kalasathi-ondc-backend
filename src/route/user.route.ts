import express from 'express';
import { authMiddleware } from '~/middleware/auth.middleware';
import * as addressController from '~/controller/address.controller';

const router = express.Router();

// All user routes require authentication
router.use(authMiddleware);

/**
 * Address Management
 * GET /api/v1/user/addresses
 * POST /api/v1/user/addresses
 */
router.get('/addresses', addressController.listAddresses);
router.post('/addresses', addressController.createAddress);
router.put('/addresses/:id', addressController.updateAddress);
router.delete('/addresses/:id', addressController.deleteAddress);
router.patch('/addresses/:id/default', addressController.setDefaultAddress);

export { router as userRouter };
