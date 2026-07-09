/**
 * Seller Adapter — reads seller/store data from ondc_odop_db only.
 *
 * Table: stores (ondc_odop_db)
 *   id, seller_id, store_name, store_slug, description,
 *   support_email, support_phone, is_active
 *
 * Table: store_locations (ondc_odop_db)
 *   id, store_id, address_line1, address_line2, city, state, country, pincode,
 *   latitude, longitude, radius_km (already km), time_from, time_to (HHMM smallint),
 *   day_from, day_to, location_type, fulfillment_type, is_active
 */

import { ondcQuery } from '~/lib/ondcSql';
import type { OndcProvider } from '~/ondc/types/ondc.types';
import { ondcEnv } from '~/config/ondc.config';
import { SELLER_PROFILE } from '~/ondc/config/constants';
import {
  buildProviderLocation,
  resolveOndcLocality,
  resolveProviderLongDesc,
  resolveProviderShortDesc,
  type ProviderLocation,
} from '~/ondc/utils/catalog.builders';

export interface MainDbSeller {
  id: number;
  seller_id: number; // stores.seller_id (user ID)
  name: string;
  description: string | null;
  logo: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
}

export interface MainDbStoreLocation {
  id: number;
  store_id: number;
  latitude: number | null;
  longitude: number | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string;
  radius_km: number | null; // already in km (schema: radius_km)
  time_from: number | null; // HHMM smallint (schema: time_from)
  time_to: number | null; // HHMM smallint (schema: time_to)
  day_from: number | null; // 1=Mon
  day_to: number | null; // 7=Sun
  location_type: string;
  fulfillment_type: string;
  is_active: boolean;
}

export interface MainDbSellerProfile {
  user_id: number;
  gstin: string | null;
  pan: string | null;
  business_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  bank_name: string | null;
  branch_name: string | null;
}

const STORE_SELECT = `
  s.id,
  s.seller_user_id,
  s.store_name  AS name,
  s.description,
  NULL          AS logo,
  s.support_phone AS phone,
  s.support_email AS email,
  s.is_active`;

function mapStoreRow(r: any): MainDbSeller {
  return {
    id: r.id,
    seller_id: r.seller_user_id,
    name: r.name,
    description: r.description,
    logo: r.logo,
    phone: r.phone,
    email: r.email,
    is_active: Boolean(r.is_active),
  };
}

/** All active stores — each becomes an ONDC provider */
export async function getActiveStores(): Promise<MainDbSeller[]> {
  const rows = await ondcQuery<any>(
    `SELECT ${STORE_SELECT} FROM stores s WHERE s.is_active = 1 ORDER BY s.id ASC`,
  );
  return rows.map(mapStoreRow);
}

/** Fetch store by seller_user_id (stores.seller_user_id) */
export async function fetchMainDbSeller(sellerUserId: number): Promise<MainDbSeller | null> {
  const rows = await ondcQuery<any>(
    `SELECT ${STORE_SELECT} FROM stores s
     WHERE s.seller_user_id = ? AND s.is_active = 1
     ORDER BY s.id ASC LIMIT 1`,
    [sellerUserId],
  );
  return rows[0] ? mapStoreRow(rows[0]) : null;
}

/** Fetch store by primary key (stores.id) */
export async function fetchStoreById(storeId: number): Promise<MainDbSeller | null> {
  const rows = await ondcQuery<any>(`SELECT ${STORE_SELECT} FROM stores s WHERE s.id = ? LIMIT 1`, [
    storeId,
  ]);
  return rows[0] ? mapStoreRow(rows[0]) : null;
}

export async function fetchSellerProfileByStoreId(
  storeId: number,
): Promise<MainDbSellerProfile | null> {
  const rows = await ondcQuery<any>(
    `SELECT
       sp.user_id,
       sp.gstin,
       sp.pan,
       sp.business_name,
       sp.bank_account_no,
       sp.bank_ifsc,
       sp.upi_id,
       sp.bank_name,
       sp.branch_name
     FROM stores s
     INNER JOIN seller_profiles sp ON sp.user_id = s.seller_user_id
     WHERE s.id = ?
     LIMIT 1`,
    [storeId],
  );

  if (!rows[0]) return null;
  return {
    user_id: rows[0].user_id,
    gstin: rows[0].gstin ?? null,
    pan: rows[0].pan ?? null,
    business_name: rows[0].business_name ?? null,
    bank_account_no: rows[0].bank_account_no ?? null,
    bank_ifsc: rows[0].bank_ifsc ?? null,
    upi_id: rows[0].upi_id ?? null,
    bank_name: rows[0].bank_name ?? null,
    branch_name: rows[0].branch_name ?? null,
  };
}

/** Fetch active locations for a store */
export async function fetchStoreLocations(storeId: number): Promise<MainDbStoreLocation[]> {
  const rows = await ondcQuery<any>(
    `SELECT
       sl.id,
       sl.store_id,
       sl.latitude,
       sl.longitude,
       sl.address_line1,
       sl.address_line2,
       sl.city,
       sl.state,
       sl.country,
       sl.pincode,
       sl.radius_km,
       sl.time_from,
       sl.time_to,
       sl.day_from,
       sl.day_to,
       sl.location_type,
       sl.fulfillment_type,
       sl.is_active
     FROM store_locations sl
     WHERE sl.store_id = ? AND sl.is_active = 1
     ORDER BY sl.id ASC`,
    [storeId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    store_id: r.store_id,
    latitude: r.latitude ? parseFloat(r.latitude) : null,
    longitude: r.longitude ? parseFloat(r.longitude) : null,
    address_line1: r.address_line1 ?? '',
    address_line2: r.address_line2 ?? null,
    city: r.city ?? SELLER_PROFILE.CITY,
    state: r.state ?? SELLER_PROFILE.STATE,
    country: r.country ?? 'IND',
    pincode: r.pincode ?? SELLER_PROFILE.AREA_CODE,
    radius_km: r.radius_km ? parseInt(r.radius_km, 10) : null,
    time_from: r.time_from ? parseInt(r.time_from, 10) : null,
    time_to: r.time_to ? parseInt(r.time_to, 10) : null,
    day_from: r.day_from ? parseInt(r.day_from, 10) : null,
    day_to: r.day_to ? parseInt(r.day_to, 10) : null,
    location_type: r.location_type ?? 'PICKUP',
    fulfillment_type: r.fulfillment_type ?? 'Delivery',
    is_active: Boolean(r.is_active),
  }));
}

/** Convert store_locations row → ONDC ProviderLocation */
export function mapStoreLocationToOndcLocation(loc: MainDbStoreLocation): ProviderLocation {
  const lat = loc.latitude ?? 23.2599;
  const lng = loc.longitude ?? 77.4126;
  const gps = `${lat},${lng}`;
  const radiusKm = Math.max(1, loc.radius_km ?? 10);

  // Store operates 24/7 — location time defaults to 0000-2359, all days
  // (buildProviderLocation applies those defaults). Per-fulfillment service
  // windows are expressed in the provider timing tags instead.
  return buildProviderLocation(
    String(loc.id),
    gps,
    {
      locality: resolveOndcLocality(loc.address_line2, loc.address_line1),
      street: loc.address_line1 ?? SELLER_PROFILE.STREET,
      city: loc.city,
      area_code: loc.pincode,
      state: loc.state,
    },
    radiusKm,
  );
}

export function adaptSellerToOndcProvider(seller: MainDbSeller, providerId: string): OndcProvider {
  const baseUrl = ondcEnv.baseUri.replace('/api/v1/ondc', '');
  const logoUrl = seller.logo
    ? seller.logo.startsWith('http')
      ? seller.logo
      : `${baseUrl}/uploads/${seller.logo}`
    : undefined;

  return {
    id: providerId,
    descriptor: {
      name: seller.name || SELLER_PROFILE.BRAND_NAME,
      short_desc: resolveProviderShortDesc(seller.description?.slice(0, 200), seller.name),
      long_desc: resolveProviderLongDesc(seller.description, seller.name),
      images: logoUrl ? [logoUrl] : [],
    },
    locations: [],
    fulfillments: [
      { id: 'F1', type: 'Delivery' },
      { id: 'F2', type: 'Self-Pickup' },
    ],
    payments: [
      {
        '@ondc/org/buyer_app_finder_fee_type': 'percent',
        '@ondc/org/buyer_app_finder_fee_amount': ondcEnv.buyerFinderFeeDefault,
      },
    ],
    tags: [
      {
        code: 'bpp_terms',
        list: [
          { code: 'max_liability', value: '2' },
          { code: 'max_liability_cap', value: '10000' },
          { code: 'mandatory_arbitration', value: 'false' },
          { code: 'court_jurisdiction', value: SELLER_PROFILE.CITY },
          { code: 'delay_interest', value: '1000' },
        ],
      },
    ],
  };
}
