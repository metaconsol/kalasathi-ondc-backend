import type { OndcProvider } from './ondc.types';

/** Shape of catalog data sent in /on_search response */
export interface OndcSearchCatalog {
  'bpp/descriptor': {
    name: string;
    short_desc?: string;
    long_desc?: string;
    images?: string[];
    tags?: Array<{ code: string; list: Array<{ code: string; value: string }> }>;
  };
  'bpp/fulfillments': Array<{ id: string; type: string }>;
  'bpp/payments': Array<{
    '@ondc/org/buyer_app_finder_fee_type': string;
    '@ondc/org/buyer_app_finder_fee_amount': string;
  }>;
  'bpp/offers'?: unknown[];
  'bpp/providers': OndcProvider[];
}
