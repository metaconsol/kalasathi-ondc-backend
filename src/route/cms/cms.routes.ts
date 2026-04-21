import express, { type Request, type Response, type NextFunction } from 'express';
import { upload, memoryUpload } from '~/middleware/multer';
import { authMiddleware } from '~/middleware/auth.middleware';
import { isAdmin } from '~/middleware/admin.middleware';
import { asyncHandler } from '~/lib/response';

// Import Controllers
import * as announcementController from '~/controller/cms/announcement.controller';
import * as sliderController from '~/controller/cms/slider.controller';
import * as mediaController from '~/controller/cms/media.controller';
import * as testimonialController from '~/controller/cms/testimonial.controller';

const router = express.Router();

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ANNOUNCEMENT ROUTES
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Admin Routes
router.post(
  '/admin/announcements',
  authMiddleware,
  isAdmin,
  announcementController.createAnnouncement,
);
router.get(
  '/admin/announcements',
  authMiddleware,
  isAdmin,
  announcementController.getAllAnnouncements,
);
router.patch(
  '/admin/announcements/:id',
  authMiddleware,
  isAdmin,
  announcementController.updateAnnouncement,
);
router.delete(
  '/admin/announcements/:id',
  authMiddleware,
  isAdmin,
  announcementController.deleteAnnouncement,
);
router.patch(
  '/admin/announcements/:id/toggle',
  authMiddleware,
  isAdmin,
  announcementController.toggleAnnouncement,
);

// Public Routes
router.get('/active/announcements', announcementController.getActiveAnnouncements);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 🖼️ SLIDER ROUTES
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Slider helpers
const cpUpload = memoryUpload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'imageMobile', maxCount: 1 },
]);

router.get('/slider', sliderController.getSliders);
router.post('/slider', authMiddleware, isAdmin, cpUpload, sliderController.createSlider);
router.put('/slider/:id', authMiddleware, isAdmin, cpUpload, sliderController.updateSlider);
router.delete('/slider/:id', authMiddleware, isAdmin, sliderController.deleteSlider);
router.patch('/slider/:id/toggle', authMiddleware, isAdmin, sliderController.toggleSlider);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 📂 MEDIA ROUTES
 * ─────────────────────────────────────────────────────────────────────────────
 */

router.post(
  '/media/upload',
  authMiddleware,
  isAdmin,
  upload.array('files', 10),
  asyncHandler(mediaController.uploadMedia),
);

router.get('/media', authMiddleware, isAdmin, asyncHandler(mediaController.getMediaFiles));

router.delete('/media/:id', authMiddleware, isAdmin, asyncHandler(mediaController.deleteMediaFile));

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  TESTIMONIAL ROUTES
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Admin Routes
router.post(
  '/admin/testimonials',
  authMiddleware,
  isAdmin,
  memoryUpload.single('customerPhoto'),
  testimonialController.createTestimonial,
);
router.get('/admin/testimonials', authMiddleware, isAdmin, testimonialController.getTestimonials);
router.patch(
  '/admin/testimonials/:id',
  authMiddleware,
  isAdmin,
  memoryUpload.single('customerPhoto'),
  testimonialController.updateTestimonial,
);
router.delete(
  '/admin/testimonials/:id',
  authMiddleware,
  isAdmin,
  testimonialController.deleteTestimonial,
);
router.patch(
  '/admin/testimonials/:id/toggle',
  authMiddleware,
  isAdmin,
  testimonialController.toggleTestimonial,
);

// Public Routes
router.get('/testimonials', testimonialController.getTestimonials);

export default router;
