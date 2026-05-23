import express from 'express';
import { getMessages, updateMessageStatus } from '../controller/contact.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { isAdmin, isSuperAdmin } from '../middleware/admin.middleware';
import {
  assignAdminDistrict,
  createAdmin,
  deleteAdmin,
  listAdmins,
} from '~/controller/adminManagement.controller';

const router = express.Router();

router.get('/admin/messages', authMiddleware, isAdmin, getMessages);
router.patch('/admin/messages/:id', authMiddleware, isAdmin, updateMessageStatus);

router.get('/admin/admins', authMiddleware, isSuperAdmin, listAdmins);
router.post('/admin/admins', authMiddleware, isSuperAdmin, createAdmin);
router.patch('/admin/admins/:adminId/district', authMiddleware, isSuperAdmin, assignAdminDistrict);
router.delete('/admin/admins/:adminId', authMiddleware, isSuperAdmin, deleteAdmin);

export default router;
