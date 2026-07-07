/**
 * Product serviceability check for /on_select — mirrors the odop_backend
 * public `checkPincode` logic (publicProduct.service.ts) so the ONDC answer
 * matches what the storefront tells buyers.
 *
 * Decision by products.availability_mode:
 *   force_out_of_stock = 1        → not serviceable (out of stock)
 *   ALL_INDIA | SELLER_DEFAULT    → serviceable
 *   PINCODES                      → serviceable iff (product_id, pincode) row exists
 *   CITIES                        → serviceable (city-restricted; confirmed at order time)
 *
 * Tables live in the same DB the ONDC module reads (product_serviceable_pincodes,
 * product_serviceable_cities, products.availability_mode / force_out_of_stock).
 */

import { ondcQuery } from '~/lib/ondcSql';

export type AvailabilityMode = 'SELLER_DEFAULT' | 'ALL_INDIA' | 'CITIES' | 'PINCODES';

export interface ServiceabilityResult {
  serviceable: boolean;
  availabilityMode: AvailabilityMode | 'UNKNOWN';
  /** why not serviceable — 'out_of_stock' | 'pincode_not_served' | 'no_pincode' | 'not_found' */
  reason?: string;
  note?: string;
}

interface ProductAvailRow {
  availability_mode: AvailabilityMode | null;
  force_out_of_stock: number | null;
}

/**
 * Is `productId` deliverable to `pincode`?
 * @param pincode buyer delivery area_code from the /select fulfillment end location
 */
export async function checkProductServiceability(
  productId: number,
  pincode: string | null | undefined,
): Promise<ServiceabilityResult> {
  const rows = await ondcQuery<ProductAvailRow>(
    `SELECT availability_mode, force_out_of_stock FROM products WHERE id = ? LIMIT 1`,
    [productId],
  );
  const p = rows[0];
  if (!p) return { serviceable: false, availabilityMode: 'UNKNOWN', reason: 'not_found' };

  const mode: AvailabilityMode = p.availability_mode ?? 'SELLER_DEFAULT';

  if (Number(p.force_out_of_stock) === 1) {
    return { serviceable: false, availabilityMode: mode, reason: 'out_of_stock' };
  }

  if (mode === 'ALL_INDIA' || mode === 'SELLER_DEFAULT') {
    return { serviceable: true, availabilityMode: mode };
  }

  if (mode === 'PINCODES') {
    const pin = String(pincode ?? '').trim();
    if (!pin) return { serviceable: false, availabilityMode: mode, reason: 'no_pincode' };
    const hit = await ondcQuery<{ ok: number }>(
      `SELECT 1 AS ok FROM product_serviceable_pincodes WHERE product_id = ? AND pincode = ? LIMIT 1`,
      [productId, pin],
    );
    return hit.length > 0
      ? { serviceable: true, availabilityMode: mode }
      : { serviceable: false, availabilityMode: mode, reason: 'pincode_not_served' };
  }

  // CITIES — buyer /select carries a pincode, not a city; defer like the storefront.
  return {
    serviceable: true,
    availabilityMode: mode,
    note: 'city-restricted availability; confirmed at order time',
  };
}
