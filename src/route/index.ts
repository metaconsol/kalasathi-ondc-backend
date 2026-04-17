import express from 'express';
import { ApiResponse } from '~/lib/response';
import type { Request, Response } from 'express';

import { testRouter } from './test.route';
import { authRouter } from './auth.route';
import sliderRoutes from './cms/slider.route';
import contactRoutes from './contact.route';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  return ApiResponse.success(res, 'API is running', {
    message: 'Welcome to ODOP API',
  });
});

router.use('/auth', authRouter);
router.use('/test', testRouter);
router.use('/slider', sliderRoutes);
router.use('/contact', contactRoutes);

export default router;
