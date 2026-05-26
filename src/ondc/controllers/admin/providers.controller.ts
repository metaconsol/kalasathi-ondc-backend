/**
 * Admin Providers Controller — read-only view over active stores.
 * Every row in `stores` is an ONDC provider (provider_id = String(stores.id));
 * there is no separate ondc_providers table.
 */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { providerModel } from '~/ondc/models/provider.model';

/** GET /api/v1/ondc/admin/providers */
export async function listProviders(_req: Request, res: Response): Promise<void> {
  const providers = await providerModel.listAll();
  ApiResponse.success(res, 'Providers', providers);
}

/** GET /api/v1/ondc/admin/providers/:providerId */
export async function getProvider(req: Request, res: Response): Promise<void> {
  const provider = await providerModel.findById(req.params['providerId'] as string);
  if (!provider) throw new AppError('Provider not found', 404);
  ApiResponse.success(res, 'Provider', provider);
}

/** PATCH /api/v1/ondc/admin/providers/:providerId/toggle — flips stores.is_active */
export async function toggleProvider(req: Request, res: Response): Promise<void> {
  const { active } = req.body as { active: boolean };
  await providerModel.setActive(req.params['providerId'] as string, active);
  ApiResponse.success(res, `Provider ${active ? 'activated' : 'deactivated'}`);
}
