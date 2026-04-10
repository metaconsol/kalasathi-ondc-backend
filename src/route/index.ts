import express from 'express';
import { ApiResponse } from '~/lib/response';
import type { Request, Response } from 'express';

import { testRouter } from './test.route';

// import authRouter from "./auth.route";

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  return ApiResponse.success(res, 'API is running', {
    message: 'Welcome to ODOP API',
  });
});

router.use('/test', testRouter);

export default router;
