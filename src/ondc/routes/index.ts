/**
 * ONDC Module Router — mounts all ONDC sub-routers.
 * Mounted in main src/route/index.ts at /ondc.
 * Full base path: /api/v1/ondc
 */

import express from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcEnv } from '~/config/ondc.config';
import becknRouter from './beckn.route';
import adminRouter from './admin.route';
import testRouter from './test.route';

const router = express.Router();

// ONDC feature flag gate
router.use((_req, res, next) => {
  if (!ondcEnv.enabled) {
    res.status(503).json({ error: 'ONDC integration is disabled' });
    return;
  }
  next();
});

/** Health check for ONDC module */
router.get('/', (_req, res) => {
  ApiResponse.success(res, 'ONDC module operational', {
    environment: ondcEnv.environment,
    subscriberId: ondcEnv.subscriberId,
  });
});

// Beckn protocol endpoints (BAP → BPP)
router.use('/', becknRouter);

// Admin management APIs
router.use('/admin', adminRouter);

// Test/dev endpoints
router.use('/test', testRouter);

export default router;
