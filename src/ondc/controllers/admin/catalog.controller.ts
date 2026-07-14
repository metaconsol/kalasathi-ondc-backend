/**
 * Admin Catalog Controller — read-only.
 *
 * GET /catalog/items[/:providerId] — flattened list of items that /on_search
 *   would emit live, for admin/seller visibility (no cache).
 * GET /catalog/debug                — pipeline diagnostics, no writes.
 *
 * Role scoping (mirrors orders / dashboard stats):
 *   ADMIN / SUPER_ADMIN → all active providers (optional providerId filter).
 *   SELLER              → only stores where stores.seller_user_id = req.user.id.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { catalogService } from '~/ondc/services/catalog.service';
import { getActiveStores } from '~/ondc/adapters/seller.adapter';
import { ondcQuery } from '~/lib/ondcSql';
import { SUPPORTED_DOMAINS, type OndcRetailDomain } from '~/ondc/config/domain.config';

interface OndcItem {
  id: string;
  parent_item_id?: string;
  descriptor?: { name?: string };
  price?: { value?: string; maximum_value?: string };
  category_id?: string;
}

/** Resolve provider ids (store ids) owned by the authenticated seller. */
async function getSellerProviderIds(sellerId: number): Promise<string[]> {
  const storeRows = await ondcQuery<{ id: number }>(
    `SELECT id FROM stores WHERE seller_user_id = ? AND (deleted_at IS NULL)`,
    [sellerId],
  );
  return storeRows.map((r) => String(r.id));
}

/**
 * Domains to build. Default remains RET12 (existing callers).
 * Pass domain=all to build every supported retail domain (seller/admin catalog UI).
 */
function resolveCatalogDomains(raw: string | undefined): OndcRetailDomain[] {
  if (!raw) return ['ONDC:RET12'];
  if (raw.toLowerCase() === 'all') return [...SUPPORTED_DOMAINS];
  return [raw as OndcRetailDomain];
}

/** Empty path segment from `/catalog/items/` must not become a provider filter. */
function normalizeProviderId(raw: string | undefined): string | undefined {
  const id = raw?.trim();
  return id ? id : undefined;
}

/** GET /api/v1/ondc/admin/catalog/items[/:providerId] */
export async function listCatalogItems(req: Request, res: Response): Promise<void> {
  const providerId = normalizeProviderId(req.params.providerId as string | undefined);
  const domains = resolveCatalogDomains(req.query.domain as string | undefined);

  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? Number(req.user?.id) : undefined;

  // Sellers may only see their own stores. Admins see the full network catalog.
  let allowedProviderIds: string[] | null = null;
  if (sellerId !== undefined && Number.isFinite(sellerId)) {
    allowedProviderIds = await getSellerProviderIds(sellerId);
    if (providerId && !allowedProviderIds.includes(providerId)) {
      ApiResponse.success(res, 'Catalog items (live)', []);
      return;
    }
    if (allowedProviderIds.length === 0) {
      ApiResponse.success(res, 'Catalog items (live)', []);
      return;
    }
  }

  // Build only the stores we will emit — sellers were timing out because every
  // catalog preview rebuilt the full multi-store BPP catalog first.
  let buildStoreIds: number[] | undefined;
  if (providerId) {
    buildStoreIds = [parseInt(providerId, 10)].filter((n) => Number.isFinite(n));
  } else if (allowedProviderIds) {
    buildStoreIds = allowedProviderIds
      .map((id) => parseInt(id, 10))
      .filter((n) => Number.isFinite(n));
  }

  const flat: object[] = [];
  for (const domain of domains) {
    const catalog = await catalogService.buildSearchCatalog(domain, buildStoreIds);
    for (const provider of catalog['bpp/providers'] as Array<{
      id: string;
      items: OndcItem[];
      descriptor: { name: string };
    }>) {
      if (providerId && provider.id !== providerId) continue;
      if (allowedProviderIds && !allowedProviderIds.includes(provider.id)) continue;
      for (const item of provider.items ?? []) {
        flat.push({
          ondc_item_id: item.id,
          parent_item_id: item.parent_item_id ?? null,
          name: item.descriptor?.name ?? '',
          price: item.price?.value ?? null,
          mrp: item.price?.maximum_value ?? null,
          ondc_category_code: item.category_id ?? null,
          provider_id: provider.id,
          provider_name: provider.descriptor?.name ?? '',
          domain,
        });
      }
    }
  }
  ApiResponse.success(res, 'Catalog items (live)', flat);
}

/**
 * GET /api/v1/ondc/admin/catalog/debug
 * Diagnoses the live build pipeline — no writes.
 */
export async function debugCatalog(_req: Request, res: Response): Promise<void> {
  const report: Record<string, unknown> = {};

  const stores = await getActiveStores();
  report.ondc_stores = stores.map((s) => ({ id: s.id, seller_user_id: s.seller_id, name: s.name }));

  for (const store of stores) {
    const key = `store_${store.id}`;

    let publishedCount = 0;
    let publishStatusBreakdown: unknown[] = [];
    let variantCount = 0;
    let variantLeafCount = 0;
    try {
      const pubRows = await ondcQuery<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM products WHERE store_id = ? AND publish_status = 'publish'`,
        [store.id],
      );
      publishedCount = Number(pubRows[0]?.cnt ?? 0);

      publishStatusBreakdown = await ondcQuery(
        `SELECT publish_status, COUNT(*) AS cnt FROM products WHERE store_id = ? GROUP BY publish_status`,
        [store.id],
      );

      const varRows = await ondcQuery<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE p.store_id = ? AND COALESCE(pv.is_active, 1) = 1`,
        [store.id],
      );
      variantCount = Number(varRows[0]?.cnt ?? 0);

      const leafRows = await ondcQuery<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE p.store_id = ? AND COALESCE(pv.is_active, 1) = 1
           AND pv.id NOT IN (
             SELECT parent_variant_id FROM product_variants WHERE parent_variant_id IS NOT NULL
           )`,
        [store.id],
      );
      variantLeafCount = Number(leafRows[0]?.cnt ?? 0);
    } catch (e: any) {
      report[key] = { error: e?.message ?? String(e) };
      continue;
    }

    let liveItemCount = 0;
    let liveBuildError: string | null = null;
    try {
      const catalog = await catalogService.buildSearchCatalog('ONDC:RET12');
      const provider = (catalog['bpp/providers'] as Array<{ id: string; items?: unknown[] }>).find(
        (p) => p.id === String(store.id),
      );
      liveItemCount = provider?.items?.length ?? 0;
    } catch (e: any) {
      liveBuildError = e?.message ?? String(e);
    }

    report[key] = {
      published_products: publishedCount,
      publish_status_breakdown: publishStatusBreakdown,
      variants_total: variantCount,
      variant_leaves: variantLeafCount,
      live_items_for_RET12: liveBuildError ?? liveItemCount,
    };
  }

  ApiResponse.success(res, 'Catalog debug', report);
}
