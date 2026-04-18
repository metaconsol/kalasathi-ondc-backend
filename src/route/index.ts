import express from 'express';
import { ApiResponse } from '~/lib/response';
import type { Request, Response } from 'express';

import { testRouter } from './test.route';
import { mediaRouter } from './media.route';
import { authRouter } from './auth.route';
import sliderRoutes from './cms/slider.route';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  return ApiResponse.success(res, 'API is running', {
    message: 'Welcome to ODOP API',
  });
});

router.use('/auth', authRouter);
router.use('/test', testRouter);
router.use('/media', mediaRouter);
router.use('/slider', sliderRoutes);

export default router;
