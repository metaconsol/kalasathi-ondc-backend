/**
 * Admin Providers Controller — read-only view over active stores.
 * Every row in `stores` is an ONDC provider (provider_id = String(stores.id));
 * there is no separate ondc_providers table.
 */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { providerModel } from '~/ondc/models/provider.model';

/** GET /api/v1/ondc/admin/providers — unpaginated when no page/limit; else 12 per page by default */
export async function listProviders(req: Request, res: Response): Promise<void> {
  const { page, limit, q } = req.query as Record<string, string>;

  if (page === undefined && limit === undefined) {
    const providers = await providerModel.listAll();
    ApiResponse.success(res, 'Providers', providers);
    return;
  }

  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '12', 10) || 12));
  const offset = (pageNum - 1) * limitNum;

  const search = q?.trim() || undefined;
  const listOpts = { limit: limitNum, offset, ...(search ? { q: search } : {}) };
  const countOpts = search ? { q: search } : {};

  const [providers, total] = await Promise.all([
    providerModel.listPaginated(listOpts),
    providerModel.countAll(countOpts),
  ]);

  ApiResponse.success(res, 'Providers', providers, {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.max(1, Math.ceil(total / limitNum)),
  });
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
