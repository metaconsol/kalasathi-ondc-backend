import express from 'express';
import {
  createAnnouncement,
  getAllAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncement,
  getActiveAnnouncements,
} from '../../../controller/cms/AnnocementBar/announcement.controller';

import { authMiddleware } from '../../../middleware/auth.middleware';
import { isAdmin } from '../../../middleware/admin.middleware';

const router = express.Router();

/**
 * 🔐 Admin Routes (requires auth + ADMIN role)
 */
router.post('/admin/announcements', authMiddleware, isAdmin, createAnnouncement);

router.get('/admin/announcements', authMiddleware, isAdmin, getAllAnnouncements);

router.patch('/admin/announcements/:id', authMiddleware, isAdmin, updateAnnouncement);

router.delete('/admin/announcements/:id', authMiddleware, isAdmin, deleteAnnouncement);

router.patch('/admin/announcements/:id/toggle', authMiddleware, isAdmin, toggleAnnouncement);

/**
 * 🌍 Public Route
 */
router.get('/announcements/active', getActiveAnnouncements);

export default router;
