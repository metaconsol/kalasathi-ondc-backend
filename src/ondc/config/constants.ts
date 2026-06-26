/** Beckn core version used in our outgoing responses */
export const BECKN_CORE_VERSION = '1.2.5';

/** Beckn core versions we accept on inbound requests */
export const SUPPORTED_CORE_VERSIONS = ['1.2.0', '1.2.5'] as const;

/** Default country & currency */
export const DEFAULT_COUNTRY = 'IND';
export const DEFAULT_CURRENCY = 'INR';

/** ONDC domain for retail (handicrafts/fashion fit RET12) */
export const DEFAULT_DOMAIN = 'ONDC:RET12';

/** Cancellation reason IDs (as per ONDC spec) */
export const CANCEL_REASON = {
  BUYER_CANCELLED: '001',
  WRONG_PRODUCT: '002',
  PRODUCT_NOT_AVAILABLE: '003',
  SELLER_CANCELLED: '005',
  FULFILLMENT_FAILED: '006',
  CANNOT_DELIVER: '009',
  PRODUCT_OUT_OF_STOCK: '010',
  BUYER_NOT_FOUND: '011',
  RETURN_INITIATED: '013',
} as const;

/** ONDC error codes */
export const ONDC_ERROR = {
  INVALID_REQUEST: { type: 'CORE-ERROR', code: '20000' },
  INVALID_SIGNATURE: { type: 'CORE-ERROR', code: '20001' },
  SUBSCRIBER_NOT_FOUND: { type: 'CORE-ERROR', code: '20002' },
  ITEM_NOT_FOUND: { type: 'DOMAIN-ERROR', code: '30004' },
  ITEM_OUT_OF_STOCK: { type: 'DOMAIN-ERROR', code: '40002' },
  ORDER_NOT_FOUND: { type: 'DOMAIN-ERROR', code: '30005' },
  CANNOT_CANCEL: { type: 'DOMAIN-ERROR', code: '30007' },
  PAYMENT_FAILED: { type: 'DOMAIN-ERROR', code: '30010' },
} as const;

/** Fulfillment types */
export const FULFILLMENT_TYPE = {
  DELIVERY: 'Delivery',
  SELF_PICKUP: 'Self-Pickup',
  COURIER: 'Courier',
} as const;

/** Payment collection options */
export const PAYMENT_COLLECTOR = {
  BAP: 'BAP',
  BPP: 'BPP',
} as const;

/** TTL for /on_search responses */
export const SEARCH_CATALOG_TTL = 'PT30S';

/** Maximum items per catalog page in search */
export const CATALOG_PAGE_SIZE = 20;

/** Out-of-stock error constants (matches PHP ONDC_ERR_OOS_*) */
export const OOS = {
  TYPE: 'DOMAIN-ERROR',
  CODE: '40002',
  MSG: 'M1',
} as const;

/** Seller details — populated from lib.php reference */
export const SELLER_PROFILE = {
  BRAND_NAME: process.env['ONDC_SELLER_BRAND_NAME'] ?? '',
  SUPPORT_NAME: process.env['ONDC_SELLER_SUPPORT_NAME'] ?? '',
  COMPANY_NAME: process.env['ONDC_SELLER_COMPANY_NAME'] ?? '',
  SUPPORT_PHONE: process.env['ONDC_SELLER_SUPPORT_PHONE'] ?? '',
  SUPPORT_EMAIL: process.env['ONDC_SELLER_SUPPORT_EMAIL'] ?? '',
  STREET: process.env['ONDC_SELLER_STREET'] ?? '',
  LOCALITY: process.env['ONDC_SELLER_LOCALITY'] ?? '',
  CITY: process.env['ONDC_SELLER_CITY'] ?? '',
  STATE: process.env['ONDC_SELLER_STATE'] ?? '',
  COUNTRY: process.env['ONDC_SELLER_COUNTRY'] ?? 'IND',
  AREA_CODE: process.env['ONDC_SELLER_AREA_CODE'] ?? '',
  PROVIDER_ID: process.env['ONDC_SELLER_PROVIDER_ID'] ?? '',
  ONDC_RATING_FEEDBACK_URL: process.env['ONDC_RATING_FEEDBACK_URL'] ?? '',
} as const;
