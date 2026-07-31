/**
 * ONDC-specific extension types on top of core Beckn.
 * Covers retail domain (RET) specifics and ONDC network constructs.
 */

export type OndcDomain =
  | 'ONDC:RET10' // Grocery
  | 'ONDC:RET11' // F&B
  | 'ONDC:RET12' // Fashion
  | 'ONDC:RET13' // BPC (Beauty, Personal Care)
  | 'ONDC:RET14' // Electronics
  | 'ONDC:RET15' // Appliances
  | 'ONDC:RET16' // Home & Kitchen
  | 'ONDC:RET17' // Auto
  | 'ONDC:RET18' // Agriculture
  | 'ONDC:RET19' // Pharma
  | 'ONDC:RET20'; // Toys

export type OndcCity = 'std:080' | 'std:011' | 'std:022' | 'std:040' | 'std:0755' | '*';

export interface OndcProvider {
  id: string;
  descriptor: {
    name: string;
    code?: string;
    /** Store logo. Buyer apps read this AND images[0] as the storefront logo. */
    symbol?: string;
    short_desc?: string;
    long_desc?: string;
    images?: string[];
  };
  rating?: string;
  ttl?: string;
  locations?: OndcProviderLocation[];
  items?: OndcItem[];
  categories?: OndcCategory[];
  fulfillments?: OndcProviderFulfillment[];
  payments?: OndcProviderPayment[];
  offers?: unknown[];
  tags?: OndcTagGroup[];
  '@ondc/org/fssai_license_no'?: string;
}

export interface OndcProviderLocation {
  id: string;
  gps: string;
  address: {
    locality: string;
    street: string;
    city: string;
    area_code: string;
    state: string;
  };
  circle?: { gps: string; radius: { type: string; value: string; unit: string } };
  time?: {
    label: string;
    timestamp?: string;
    days: string;
    schedule: { holidays: string[] };
    range: { start: string; end: string };
  };
}

export interface OndcItem {
  id: string;
  parent_item_id?: string;
  descriptor: {
    name: string;
    code?: string;
    short_desc?: string;
    long_desc?: string;
    images?: string[];
  };
  quantity: {
    unitized?: {
      measure: { unit: string; value: string };
    };
    available: { count: string };
    maximum: { count: string };
  };
  price: {
    currency: string;
    value: string;
    offered_value?: string;
    maximum_value?: string;
    minimum_value?: string;
  };
  category_id?: string;
  fulfillment_id?: string;
  location_id?: string;
  time?: unknown;
  matched?: boolean;
  related?: boolean;
  recommended?: boolean;
  tags?: OndcTagGroup[];
  '@ondc/org/returnable'?: boolean;
  '@ondc/org/cancellable'?: boolean;
  '@ondc/org/return_window'?: string;
  '@ondc/org/seller_pickup_return'?: boolean;
  '@ondc/org/time_to_ship'?: string;
  '@ondc/org/available_on_cod'?: boolean;
  '@ondc/org/contact_details_consumer_care'?: string;
  '@ondc/org/statutory_reqs_packaged_commodities'?: OndcStatutoryPackaged;
  '@ondc/org/statutory_reqs_prepackaged_food'?: OndcStatutoryFood;
}

export interface OndcStatutoryPackaged {
  manufacturer_or_packer_name?: string;
  manufacturer_or_packer_address?: string;
  common_or_generic_name_of_commodity?: string;
  month_year_of_manufacture_packing_import?: string;
  imported_product_country_of_origin?: string;
  multiple_products_name_number_or_qty?: string;
}

export interface OndcStatutoryFood {
  ingredients_info?: string;
  nutritional_info?: string;
  additives_info?: string;
  manufacturer_or_packer_name?: string;
  manufacturer_or_packer_address?: string;
  brand_owner_name?: string;
  brand_owner_address?: string;
  brand_owner_FSSAI_logo?: string;
  brand_owner_FSSAI_license?: string;
  other_FSSAI_license_no?: string;
  net_quantity?: string;
  importer_name?: string;
  importer_address?: string;
  importer_FSSAI_logo?: string;
  importer_FSSAI_license?: string;
  imported_product_country_of_origin?: string;
  other_importer_name?: string;
  other_importer_address?: string;
  other_premises?: string;
  other_importer_country_of_origin?: string;
}

export interface OndcCategory {
  id: string;
  parent_category_id?: string;
  descriptor?: { name?: string; code?: string };
  time?: unknown;
  tags?: OndcTagGroup[];
}

export interface OndcProviderFulfillment {
  id: string;
  type: string;
  contact?: { phone?: string; email?: string };
}

export interface OndcProviderPayment {
  '@ondc/org/buyer_app_finder_fee_type': string;
  '@ondc/org/buyer_app_finder_fee_amount': string;
}

export interface OndcTagGroup {
  display?: boolean;
  code: string;
  name?: string;
  list: Array<{ code: string; name?: string; value: string }>;
}

export interface OndcQuote {
  price: { currency: string; value: string };
  breakup: OndcQuoteBreakupItem[];
  ttl?: string;
}

export interface OndcQuoteBreakupItem {
  '@ondc/org/item_id': string;
  '@ondc/org/item_quantity': { count: number };
  title: string;
  '@ondc/org/title_type': 'item' | 'delivery' | 'packing' | 'tax' | 'misc' | 'discount';
  price: { currency: string; value: string };
  item?: { price: { currency: string; value: string } };
}

export interface OndcBilling {
  name: string;
  address: {
    name?: string;
    building?: string;
    street?: string;
    locality?: string;
    ward?: string;
    city?: string;
    state?: string;
    country?: string;
    area_code?: string;
  };
  email?: string;
  phone: string;
  time?: unknown;
  tax_number?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OndcCancellationTerm {
  fulfillment_state: { descriptor: { code: string; short_desc?: string } };
  reason_required: boolean;
  cancel_by?: unknown;
  cancellation_fee?: { percentage?: string; amount?: { currency: string; value: string } };
}

export interface OndcRegistryLookupResponse {
  subscriber_id: string;
  ukId?: string; // registry response field (PHP: $r['ukId'])
  unique_key_id?: string; // alias some registry versions return
  signing_public_key: string;
  encr_public_key?: string;
  valid_from?: string;
  valid_until?: string;
  status?: string;
}
