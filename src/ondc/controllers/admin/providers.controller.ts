/**
 * Admin Providers Controller — read-only view over active stores.
 * Every row in `stores` is an ONDC provider (provider_id = String(stores.id));
 * there is no separate ondc_providers table.
 */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { providerModel } from '~/ondc/models/provider.model';

function parseProviderFilters(req: Request): {
  q: string | undefined;
  status: 'active' | 'inactive' | undefined;
  hasProducts: 'yes' | 'no' | undefined;
} {
  const { q, status, hasProducts } = req.query as Record<string, string>;
  return {
    q: q?.trim() || undefined,
    status: status === 'active' ? 'active' : status === 'inactive' ? 'inactive' : undefined,
    hasProducts: hasProducts === 'yes' ? 'yes' : hasProducts === 'no' ? 'no' : undefined,
  };
}

/** GET /api/v1/ondc/admin/providers — unpaginated when no page/limit; else 12 per page by default.
 *  ?status=active|inactive filters by the ONDC-only toggle (ondc_provider_settings).
 *  ?hasProducts=yes|no filters approved sellers by whether they have any product yet. */
export async function listProviders(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as Record<string, string>;
  const filterOpts = parseProviderFilters(req);

  if (page === undefined && limit === undefined) {
    const providers = await providerModel.listAll(filterOpts);
    const [total, productBreakdown] = await Promise.all([
      providerModel.countAll(filterOpts),
      providerModel.getProductBreakdown(filterOpts),
    ]);
    ApiResponse.success(res, 'Providers', providers, {
      page: 1,
      limit: providers.length || 1,
      total,
      totalPages: 1,
      withProductsCount: productBreakdown.withProducts,
      withoutProductsCount: productBreakdown.withoutProducts,
    });
    return;
  }

  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '12', 10) || 12));
  const offset = (pageNum - 1) * limitNum;

  const listOpts = { ...filterOpts, limit: limitNum, offset };

  const [providers, total, productBreakdown] = await Promise.all([
    providerModel.listPaginated(listOpts),
    providerModel.countAll(filterOpts),
    providerModel.getProductBreakdown(filterOpts),
  ]);

  ApiResponse.success(res, 'Providers', providers, {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.max(1, Math.ceil(total / limitNum)),
    withProductsCount: productBreakdown.withProducts,
    withoutProductsCount: productBreakdown.withoutProducts,
  });
}

/** GET /api/v1/ondc/admin/providers/ids — every provider_id matching the same filters as listProviders,
 *  unpaginated. Used by "select all matching" bulk actions so they aren't limited to one page. */
export async function listProviderIds(req: Request, res: Response): Promise<void> {
  const filterOpts = parseProviderFilters(req);
  const ids = await providerModel.listAllIds(filterOpts);
  ApiResponse.success(res, 'Provider ids', ids);
}

/** GET /api/v1/ondc/admin/providers/:providerId */
export async function getProvider(req: Request, res: Response): Promise<void> {
  const provider = await providerModel.findById(req.params['providerId'] as string);
  if (!provider) throw new AppError('Provider not found', 404);
  ApiResponse.success(res, 'Provider', provider);
}

/** PATCH /api/v1/ondc/admin/providers/:providerId/toggle — flips the ONDC-only toggle (ondc_provider_settings) */
export async function toggleProvider(req: Request, res: Response): Promise<void> {
  const { active } = req.body as { active: boolean };
  await providerModel.setActive(req.params['providerId'] as string, active);
  ApiResponse.success(res, `Provider ${active ? 'activated' : 'deactivated'}`);
}

/** PATCH /api/v1/ondc/admin/providers/bulk-toggle — body: { providerIds: string[], active: boolean } */
export async function bulkToggleProviders(req: Request, res: Response): Promise<void> {
  const { providerIds, active } = req.body as { providerIds: unknown; active: boolean };
  if (!Array.isArray(providerIds) || providerIds.length === 0) {
    throw new AppError('providerIds must be a non-empty array', 400);
  }
  const count = await providerModel.setActiveBulk(providerIds.map(String), active);
  ApiResponse.success(
    res,
    `${count} provider${count !== 1 ? 's' : ''} ${active ? 'activated' : 'deactivated'}`,
  );
}
