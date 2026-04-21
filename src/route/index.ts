import express, { type Request, type Response } from 'express';
import { authRouter } from './auth.route';
import { testRouter } from './test.route';
import { ApiResponse } from '~/lib/response';

// Unified CMS Routes
import cmsRoutes from './cms/cms.routes';

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
 * 🛠 CMS Unified Routes (/api/v1/cms/...)
 * Groups: Slider, Media, Announcements, etc.
 */
router.use('/cms', cmsRoutes);

/**
 * Utilities & Testing
 */
router.use('/test', testRouter);

export default router;
