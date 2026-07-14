/**
 * Admin Catalog Controller — read-only.
 *
 * GET /catalog/items[/:providerId] — flattened list of items that /on_search
 *   would emit live, for admin visibility (no cache).
 * GET /catalog/debug                — pipeline diagnostics, no writes.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { catalogService } from '~/ondc/services/catalog.service';
import { getActiveStores } from '~/ondc/adapters/seller.adapter';
import { ondcQuery } from '~/lib/ondcSql';

interface OndcItem {
  id: string;
  parent_item_id?: string;
  descriptor?: { name?: string };
  price?: { value?: string; maximum_value?: string };
  category_id?: string;
}

/** GET /api/v1/ondc/admin/catalog/items[/:providerId] */
export async function listCatalogItems(req: Request, res: Response): Promise<void> {
  const providerId = req.params.providerId as string | undefined;
  const domain = (req.query.domain as string | undefined) ?? 'ONDC:RET12';

  const catalog = await catalogService.buildSearchCatalog(domain);
  const flat: object[] = [];
  for (const provider of catalog['bpp/providers'] as Array<{
    id: string;
    items: OndcItem[];
    descriptor: { name: string };
  }>) {
    if (providerId && provider.id !== providerId) continue;
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
