/**
 * Product serviceability check for /on_select — two independent gates, both
 * must pass:
 *
 *  1. SELLER/PRODUCT restriction — mirrors odop_backend's public `checkPincode`
 *     logic (publicProduct.service.ts) so the ONDC answer matches the storefront:
 *       force_out_of_stock = 1        → not serviceable (out of stock)
 *       ALL_INDIA | SELLER_DEFAULT    → serviceable (no restriction configured)
 *       PINCODES                      → serviceable iff (product_id, pincode) row exists
 *       CITIES                        → serviceable (city-restricted; confirmed at order time)
 *
 *  2. COURIER coverage — Delhivery pincode serviceability (the same check the
 *     storefront calls at /ui/products/logistics/delhivery/serviceability/:pincode).
 *     A product can only be ALL_INDIA-serviceable in theory but still undeliverable
 *     if the courier doesn't cover that specific pincode. Delhivery's response has
 *     no TAT/ETA field, so @ondc/org/TAT is NOT derived from it — the caller keeps
 *     using the product's own time_to_ship (with its existing dummy/fallback).
 *     Skipped (never blocks) when Delhivery isn't configured, or on API/network
 *     error — courier-outage should not make every order look non-serviceable.
 *
 * Tables/config live in the same DB the ONDC module reads (product_serviceable_pincodes,
 * product_serviceable_cities, products.availability_mode / force_out_of_stock).
 */

import axios from 'axios';
import { ondcQuery } from '~/lib/ondcSql';
import { delhiveryEnv } from '~/config/delhivery.config';
import { ondcLogger } from '~/ondc/utils/logger.util';

export type AvailabilityMode = 'SELLER_DEFAULT' | 'ALL_INDIA' | 'CITIES' | 'PINCODES';

export interface ServiceabilityResult {
  serviceable: boolean;
  availabilityMode: AvailabilityMode | 'UNKNOWN';
  /** why not serviceable — 'out_of_stock' | 'pincode_not_served' | 'no_pincode' | 'not_found' | 'courier_not_serviceable' */
  reason?: string;
  note?: string;
}

interface ProductAvailRow {
  availability_mode: AvailabilityMode | null;
  force_out_of_stock: number | null;
}

interface DelhiveryPinCodeResponse {
  delivery_codes?: Array<{ postal_code?: Record<string, unknown> }>;
}

/**
 * Does Delhivery actually service `pincode`? Returns null (unknown/skip) when
 * Delhivery isn't configured or the API call fails — callers must treat null
 * as "don't block on this", not as "not serviceable".
 */
async function checkCourierCoverage(pincode: string): Promise<boolean | null> {
  if (!delhiveryEnv.enabled || !delhiveryEnv.token) return null;

  try {
    const { data } = await axios.get<DelhiveryPinCodeResponse>(
      `${delhiveryEnv.baseUrl}/c/api/pin-codes/json/`,
      {
        headers: {
          Authorization: `Token ${delhiveryEnv.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        params: { filter_codes: pincode },
        timeout: 5000,
      },
    );
    return Array.isArray(data?.delivery_codes) && data.delivery_codes.length > 0;
  } catch (err) {
    ondcLogger.warn('Delhivery serviceability check failed — ignoring (fail-open)', {
      pincode,
      err,
    });
    return null;
  }
}

async function checkSellerRestriction(
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

/**
 * Is `productId` deliverable to `pincode`? Checks the seller's own restriction
 * first (cheap, DB-local); only calls out to Delhivery if that passes and a
 * pincode was given, since there's no courier to check against otherwise.
 * @param pincode buyer delivery area_code from the /select fulfillment end location
 */
export async function checkProductServiceability(
  productId: number,
  pincode: string | null | undefined,
): Promise<ServiceabilityResult> {
  const sellerResult = await checkSellerRestriction(productId, pincode);
  if (!sellerResult.serviceable) return sellerResult;

  const pin = String(pincode ?? '').trim();
  if (!pin) return sellerResult;

  const courierOk = await checkCourierCoverage(pin);
  if (courierOk === false) {
    return {
      serviceable: false,
      availabilityMode: sellerResult.availabilityMode,
      reason: 'courier_not_serviceable',
    };
  }

  return sellerResult;
}
