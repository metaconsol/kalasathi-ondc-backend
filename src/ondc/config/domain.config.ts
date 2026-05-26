/**
 * Domain-specific ONDC contract configuration.
 * Captures the differences between RET10 (Grocery), RET12 (Fashion), RET16 (Home & Kitchen).
 *
 * Reference: ONDC Retail API Contract v1.2.0
 *   - RET10: Grocery — requires FSSAI, veg_nonveg tag, statutory_reqs_prepackaged_food (g3)
 *   - RET12: Fashion — requires size, colour, gender attributes, size chart for apparel
 *   - RET16: Home & Kitchen — requires dimension, material, weight attributes
 */

export type OndcRetailDomain = 'ONDC:RET10' | 'ONDC:RET12' | 'ONDC:RET16';

export interface DomainConfig {
  domain: OndcRetailDomain;
  displayName: string;
  /** Whether items in this domain require FSSAI license number on provider */
  requiresFssai: boolean;
  /** Whether items require veg/non-veg tag */
  requiresVegNonveg: boolean;
  /** Whether statutory_reqs_prepackaged_food (g3 tag) is mandatory */
  requiresFoodStatutory: boolean;
  /** Standard ONDC category codes (subcategories) for this domain */
  defaultCategoryCode: string;
  /** Common attribute codes (mandatory in item tags) */
  mandatoryAttributes: string[];
  /** Standard return window for the domain */
  defaultReturnWindow: string; // ISO 8601 duration
  /** Standard time-to-ship for the domain */
  defaultTimeToShip: string;
}

export const DOMAIN_CONFIGS: Record<OndcRetailDomain, DomainConfig> = {
  'ONDC:RET10': {
    domain: 'ONDC:RET10',
    displayName: 'Grocery',
    requiresFssai: true,
    requiresVegNonveg: true,
    requiresFoodStatutory: true,
    defaultCategoryCode: 'Foodgrains',
    mandatoryAttributes: ['brand'],
    defaultReturnWindow: 'PT0H', // grocery typically non-returnable
    defaultTimeToShip: 'PT2H',
  },
  'ONDC:RET12': {
    domain: 'ONDC:RET12',
    displayName: 'Fashion',
    requiresFssai: false,
    requiresVegNonveg: false,
    requiresFoodStatutory: false,
    defaultCategoryCode: 'Apparel',
    mandatoryAttributes: ['brand', 'colour', 'size', 'gender'],
    defaultReturnWindow: 'P7D',
    defaultTimeToShip: 'PT48H',
  },
  'ONDC:RET16': {
    domain: 'ONDC:RET16',
    displayName: 'Home & Kitchen',
    requiresFssai: false,
    requiresVegNonveg: false,
    requiresFoodStatutory: false,
    defaultCategoryCode: 'Home Decor',
    mandatoryAttributes: ['brand', 'material'],
    defaultReturnWindow: 'P3D',
    defaultTimeToShip: 'PT48H',
  },
};

export const SUPPORTED_DOMAINS: OndcRetailDomain[] = ['ONDC:RET10', 'ONDC:RET12', 'ONDC:RET16'];

export function getDomainConfig(domain: string): DomainConfig {
  const cfg = DOMAIN_CONFIGS[domain as OndcRetailDomain];
  if (!cfg) throw new Error(`Unsupported ONDC domain: ${domain}`);
  return cfg;
}

/** ONDC fulfillment categories per type (used in on_init/on_confirm) */
export const FULFILLMENT_CATEGORIES = {
  Delivery: {
    Standard: 'Standard Delivery',
    Express: 'Express Delivery',
    SameDay: 'Same Day Delivery',
    NextDay: 'Next Day Delivery',
  },
  SelfPickup: {
    Standard: 'Self-Pickup',
  },
} as const;

/** ONDC city codes — used in context.city */
export const ONDC_CITY_CODES = {
  Bangalore: 'std:080',
  Delhi: 'std:011',
  Mumbai: 'std:022',
  Hyderabad: 'std:040',
  Bhopal: 'std:0755',
  ALL: '*',
} as const;

/** Cancellation reason IDs per ONDC spec (used in /cancel and /update) */
export const CANCELLATION_REASONS = {
  '001':
    'Price of one or more items have changed due to which buyer was asked to make additional payment',
  '002': 'One or more items in the Order not available',
  '003': 'Product available at lower than order price',
  '004': 'Order in pending shipment / delivery state for too long',
  '005': 'Merchant rejected the order',
  '006': 'Order not received as per buyer app TAT SLA',
  '007': 'Order / fulfillment not ready for pickup',
  '008': 'Wrong product delivered',
  '009': 'Buyer wants to modify address / other order details',
  '010': 'Buyer not found or cannot be contacted',
  '011': 'Buyer does not want product any more',
  '012': 'Buyer refused product due to quality issue',
  '013': 'Buyer wants to modify the order',
  '014': 'Buyer not available at delivery location',
  '015': 'Accident / rain / strike / vehicle issues',
  '016': 'Order delivery delayed or not possible',
  '017': 'Differential price requested by seller',
  '018': 'Order lost in transit',
  '019': 'Pickup not satisfactory',
  '020': 'Order cancelled by buyer after order pickup',
  '021': 'Order cancelled due to courier service issues',
  '022': 'Order cancelled by merchant after pickup',
  '023': 'Wrong product range selection',
  '024': 'Address not serviceable',
} as const;

/** Return reason IDs per ONDC spec */
export const RETURN_REASONS = {
  '001': 'Buyer does not want product anymore',
  '002': 'Product available at lower than order price',
  '003': 'Product damaged or not in working condition',
  '004': 'Product is of incorrect quantity or size',
  '005': 'Product delivered is different from what was shown and ordered',
} as const;
