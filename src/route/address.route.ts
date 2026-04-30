import express from 'express';
import * as addressController from '~/controller/address.controller';
import { authMiddleware } from '~/middleware/auth.middleware';

const router = express.Router();

router.use(authMiddleware);

router.get('/', addressController.listAddresses);
router.post('/', addressController.createAddress);
router.put('/:id', addressController.updateAddress);
router.delete('/:id', addressController.deleteAddress);
router.patch('/:id/default', addressController.setDefaultAddress);

export { router as addressRouter };
