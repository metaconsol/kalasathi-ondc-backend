import express from 'express';
import { listDistricts } from '~/controller/public/district.controller';

const router = express.Router();

/**
 * GET /api/v1/districts — Get all districts with product counts
 */
router.get('/', listDistricts);

export const districtRouter = router;
