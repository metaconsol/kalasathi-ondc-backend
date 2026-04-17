import express from 'express';
import { getMessages, updateMessageStatus } from '../controller/contact.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { isAdmin } from '../middleware/admin.middleware';

const router = express.Router();

router.get('/admin/messages', authMiddleware, isAdmin, getMessages);
router.patch('/admin/messages/:id', authMiddleware, isAdmin, updateMessageStatus);

export default router;
