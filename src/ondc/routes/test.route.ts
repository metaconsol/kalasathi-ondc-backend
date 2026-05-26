/**
 * ONDC Test Routes — for developer testing only. Disable in production.
 * Base: /api/v1/ondc/test
 */

import express from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcEnv } from '~/config/ondc.config';
import { catalogService } from '~/ondc/services/catalog.service';
import { registryService } from '~/ondc/services/registry.service';

const router = express.Router();

if (ondcEnv.environment === 'prod') {
  router.use((_req, res) => {
    res.status(404).json({ error: 'Test routes disabled in production' });
  });
} else {
  /** GET /api/v1/ondc/test/ping */
  router.get('/ping', (_req, res) => {
    ApiResponse.success(res, 'ONDC module is running', {
      environment: ondcEnv.environment,
      subscriberId: ondcEnv.subscriberId,
      enabled: ondcEnv.enabled,
    });
  });

  /** GET /api/v1/ondc/test/catalog?domain=ONDC:RET12 */
  router.get('/catalog', async (req, res) => {
    const domain = (req.query['domain'] as string) || 'ONDC:RET12';
    const catalog = await catalogService.buildSearchCatalog(domain);
    ApiResponse.success(res, 'Test catalog', catalog);
  });

  /** POST /api/v1/ondc/test/registry-lookup */
  router.post('/registry-lookup', async (req, res) => {
    const { subscriber_id, unique_key_id } = req.body as Record<string, string>;
    const pubKey = await registryService.lookupPublicKey(subscriber_id!, unique_key_id!);
    ApiResponse.success(res, 'Registry lookup', { pub_key: pubKey });
  });
}

export default router;
