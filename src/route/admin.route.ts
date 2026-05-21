import express from 'express';
import {
  approveSeller,
  getMessages,
  getSellerRequests,
  rejectSeller,
  updateMessageStatus,
} from '../controller/contact.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { isAdmin } from '../middleware/admin.middleware';

const router = express.Router();

router.get('/admin/messages', authMiddleware, isAdmin, getMessages);
router.patch('/admin/messages/:id', authMiddleware, isAdmin, updateMessageStatus);

/**
 * GET ALL SELLER REQUESTS
 */
router.get('/admin/sellers', authMiddleware, isAdmin, getSellerRequests);

/**
 * APPROVE SELLER
 */
router.patch('/admin/sellers/:userId/approve', authMiddleware, isAdmin, approveSeller);

/**
 * REJECT SELLER
 */
router.patch('/admin/sellers/:userId/reject', authMiddleware, isAdmin, rejectSeller);

export default router;
