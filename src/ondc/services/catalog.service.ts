/**
 * Catalog Service — builds /on_search live from ondc_odop_db (no cache).
 *
 * Flow: stores → store_locations → products + product_variants → items.
 * Mirrors the PHP reference (preprod_v1/search.php → build_on_search_min).
 */

import {
  fetchOndcCatalogRows,
  buildOndcItemFromRow,
  type OndcCatalogRow,
  isRowOutOfStock,
} from '~/ondc/adapters/product.adapter';
import {
  getActiveStores,
  fetchStoreLocations,
  mapStoreLocationToOndcLocation,
  storeContactEmail,
  storeContactPhone,
} from '~/ondc/adapters/seller.adapter';
import {
  buildBppDescriptor,
  buildBppFulfillments,
  buildProviderEntry,
  applyVariantGrouping,
  type ProviderBuildInfo,
  type ProviderLocation,
  type ItemWithVariantMeta,
} from '~/ondc/utils/catalog.builders';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { OndcRetailDomain } from '~/ondc/config/domain.config';
import type { OnSearchCatalog } from '~/ondc/utils/payload.builder';

export const catalogService = {
  /**
   * Build /on_search catalog live — one provider per active store, expanded
   * into one item per leaf variant (or one per product if no variants).
   * Skips items whose resolved ONDC domain doesn't match the requested one.
   */
  async buildSearchCatalog(domain: string): Promise<OnSearchCatalog> {
    const providers: object[] = [];
    const requestedDomain = (domain || 'ONDC:RET12') as OndcRetailDomain;

    const stores = await getActiveStores();

    for (const store of stores) {
      const providerId = String(store.id);

      // Locations
      let ondcLocations: ProviderLocation[] = [];
      try {
        const locRows = await fetchStoreLocations(store.id);
        ondcLocations = locRows.map(mapStoreLocationToOndcLocation);
      } catch (err) {
        ondcLogger.warn('Failed to fetch store locations', { storeId: store.id, err });
      }

      const locationId = ondcLocations[0]?.id ?? 'L1';
      const fulfillmentId = '1'; // Delivery — matches bpp/fulfillments[0].id

      // Products + variants
      let rows: OndcCatalogRow[];
      try {
        rows = await fetchOndcCatalogRows(store.id);
      } catch (err) {
        ondcLogger.error('Failed to fetch catalog rows', { storeId: store.id, err });
        continue;
      }
      if (rows.length === 0) continue;

      // Build items. Per ONDC contract /on_search returns the full catalog —
      // buyer-side filters by name, locality, etc. We only enforce the domain
      // match against the requested domain.
      const builtItems: ItemWithVariantMeta[] = [];
      for (const row of rows) {
        // Out of stock items are omitted from the catalog entirely.
        if (isRowOutOfStock(row)) continue;
        try {
          const built = await buildOndcItemFromRow(row, {
            providerId,
            locationId,
            fulfillmentId,
            storeName: store.name,
            storeEmail: storeContactEmail(store),
            storePhone: storeContactPhone(store),
          });
          if (built.domain !== requestedDomain) continue;

          builtItems.push({
            ...(built.item as unknown as ItemWithVariantMeta),
            _variantGroupId: built.variantGroupId,
          });
        } catch (err) {
          ondcLogger.warn('Item build failed', {
            storeId: store.id,
            productId: row.product_id,
            variantId: row.variant_id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (builtItems.length === 0) continue;

      const { items, categories } = applyVariantGrouping(builtItems);

      const providerInfo: ProviderBuildInfo = {
        provider_id: providerId,
        name: store.name,
        short_desc: store.description?.slice(0, 200) ?? '',
        long_desc: store.description ?? '',
        logo_url: store.logo ?? null,
        fssai_license: null,
        support_phone: storeContactPhone(store),
        support_email: storeContactEmail(store),
        updated_at: new Date(),
      };

      providers.push(
        buildProviderEntry(providerInfo, items, requestedDomain, ondcLocations, categories),
      );
    }

    // Per ONDC 1.2.5: NO bpp/payments at catalog level — payment terms live
    // inside each provider as @ondc/org/payments (built in buildProviderEntry).
    return {
      'bpp/descriptor': buildBppDescriptor(),
      'bpp/fulfillments': buildBppFulfillments(),
      'bpp/providers': providers,
    };
  },
};
