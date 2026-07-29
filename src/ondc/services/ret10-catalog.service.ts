/**
 * Catalog Service — RET10 (Grocery) specific.
 * Builds /on_search live from ondc_odop_db dynamically.
 */

import {
  fetchOndcCatalogRows,
  buildOndcItemFromRow,
  type OndcCatalogRow,
} from '~/ondc/adapters/product.adapter';
import {
  getActiveStores,
  fetchStoreLocations,
  mapStoreLocationToOndcLocation,
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

export const ret10CatalogService = {
  /**
   * Build /on_search catalog live for RET10 domain.
   */
  async buildSearchCatalog(): Promise<OnSearchCatalog> {
    const providers: object[] = [];
    const requestedDomain: OndcRetailDomain = 'ONDC:RET10';

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
      const fulfillmentId = '1'; // Delivery

      // Products + variants
      let rows: OndcCatalogRow[];
      try {
        rows = await fetchOndcCatalogRows(store.id);
      } catch (err) {
        ondcLogger.error('Failed to fetch catalog rows', { storeId: store.id, err });
        continue;
      }
      if (rows.length === 0) continue;

      const builtItems: ItemWithVariantMeta[] = [];
      for (const row of rows) {
        try {
          const built = await buildOndcItemFromRow(row, {
            providerId,
            locationId,
            fulfillmentId,
            storeName: store.name,
            storeEmail: store.email,
            storePhone: store.phone,
          });

          // STRICTLY filter for RET10 items
          if (built.domain !== requestedDomain) continue;

          builtItems.push({
            ...(built.item as unknown as ItemWithVariantMeta),
            _variantGroupId: built.variantGroupId,
          });
        } catch (err) {
          ondcLogger.warn('Item build failed for RET10', {
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
        support_phone: store.phone,
        support_email: store.email,
        updated_at: new Date(),
      };

      providers.push(
        buildProviderEntry(providerInfo, items, requestedDomain, ondcLocations, categories),
      );
    }

    return {
      'bpp/descriptor': buildBppDescriptor(),
      'bpp/fulfillments': buildBppFulfillments(),
      'bpp/providers': providers,
    };
  },
};
