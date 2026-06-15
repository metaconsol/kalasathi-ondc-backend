/**
 * Core Beckn protocol types.
 * Ref: https://docs.becknprotocol.io/
 */

export interface BecknContext {
  domain: string;
  country: string;
  city: string;
  action: BecknAction;
  core_version: string;
  bap_id: string;
  bap_uri: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id: string;
  message_id: string;
  timestamp: string; // ISO-8601
  key?: string;
  ttl?: string; // ISO-8601 duration e.g. "PT30S"
}

export type BecknAction =
  | 'search'
  | 'on_search'
  | 'select'
  | 'on_select'
  | 'init'
  | 'on_init'
  | 'confirm'
  | 'on_confirm'
  | 'status'
  | 'on_status'
  | 'track'
  | 'on_track'
  | 'cancel'
  | 'on_cancel'
  | 'update'
  | 'on_update'
  | 'rating'
  | 'on_rating'
  | 'support'
  | 'on_support'
  | 'issue'
  | 'on_issue'
  | 'issue_status'
  | 'on_issue_status'
  | 'get_cancellation_reasons'
  | 'cancellation_reasons';

export interface BecknRequest<T = unknown> {
  context: BecknContext;
  message: T;
  error?: BecknError;
}

export interface BecknAck {
  ack: { status: 'ACK' | 'NACK' };
}

export interface BecknError {
  type: 'CONTEXT-ERROR' | 'CORE-ERROR' | 'DOMAIN-ERROR' | 'POLICY-ERROR' | 'JSON-SCHEMA-ERROR';
  code: string;
  path?: string;
  message?: string;
}

export interface BecknPrice {
  currency: string;
  value: string;
  estimated_value?: string;
  computed_value?: string;
  listed_value?: string;
  offered_value?: string;
  minimum_value?: string;
  maximum_value?: string;
}

export interface BecknDescriptor {
  name?: string;
  code?: string;
  short_desc?: string;
  long_desc?: string;
  images?: string[];
  audio?: string;
  '3d_render'?: string;
}

export interface BecknLocation {
  id?: string;
  descriptor?: BecknDescriptor;
  gps?: string; // "lat,lng"
  address?: BecknAddress;
  station_code?: string;
  city?: BecknCity;
  country?: BecknCountry;
  circle?: { gps: string; radius: { type: string; value: string; unit: string } };
  polygon?: string;
  '3dspace'?: string;
}

export interface BecknAddress {
  door?: string;
  name?: string;
  building?: string;
  street?: string;
  locality?: string;
  ward?: string;
  city?: string;
  state?: string;
  country?: string;
  area_code?: string;
}

export interface BecknCity {
  name?: string;
  code?: string;
}

export interface BecknCountry {
  name?: string;
  code?: string;
}

export interface BecknTime {
  label?: string;
  timestamp?: string;
  duration?: string;
  range?: { start: string; end: string };
  days?: string;
  schedule?: { frequency?: string; holidays?: string[]; times?: string[] };
}

export interface BecknContact {
  phone?: string;
  email?: string;
  tags?: BecknTagGroup[];
}

export interface BecknPerson {
  id?: string;
  name?: string;
  image?: string;
  dob?: string;
  gender?: string;
  cred?: string;
  tags?: BecknTagGroup[];
}

export interface BecknTagGroup {
  display?: boolean;
  code?: string;
  name?: string;
  list?: Array<{ code?: string; name?: string; value?: string }>;
}

export interface BecknPayment {
  uri?: string;
  tl_method?: string;
  params?: Record<string, string>;
  type?: 'ON-ORDER' | 'PRE-FULFILLMENT' | 'ON-FULFILLMENT' | 'POST-FULFILLMENT';
  status?: 'PAID' | 'NOT-PAID';
  time?: BecknTime;
  collected_by?: 'BAP' | 'BPP';
  '@ondc/org/buyer_app_finder_fee_type'?: string;
  '@ondc/org/buyer_app_finder_fee_amount'?: string;
  '@ondc/org/settlement_basis'?: string;
  '@ondc/org/settlement_window'?: string;
  '@ondc/org/withholding_amount'?: string;
  '@ondc/org/settlement_details'?: OndcSettlementDetail[];
}

export interface OndcSettlementDetail {
  settlement_counterparty?: string;
  settlement_phase?: string;
  settlement_type?: string;
  upi_address?: string;
  settlement_bank_account_no?: string;
  settlement_ifsc_code?: string;
  beneficiary_name?: string;
  bank_name?: string;
  branch_name?: string;
  settlement_id?: string;
  settlement_amount?: string | number;
  settlement_status?: string;
  settlement_timestamp?: string;
  settlement_reference?: string;
}

export interface BecknFulfillment {
  id?: string;
  type?: string;
  provider_id?: string;
  rating?: number;
  state?: { descriptor?: BecknDescriptor; updated_at?: string; updated_by?: string };
  tracking?: boolean;
  agent?: BecknPerson & { phone?: string; email?: string };
  vehicle?: {
    category?: string;
    capacity?: number;
    make?: string;
    model?: string;
    size?: string;
    variant?: string;
    color?: string;
    energy_type?: string;
    registration?: string;
  };
  start?: BecknFulfillmentStop;
  end?: BecknFulfillmentStop;
  rateable?: boolean;
  tags?: BecknTagGroup[];
  '@ondc/org/provider_name'?: string;
  '@ondc/org/category'?: string;
  '@ondc/org/TAT'?: string;
  '@ondc/org/tracking'?: boolean;
}

export interface BecknFulfillmentStop {
  location?: BecknLocation;
  time?: BecknTime;
  instructions?: BecknDescriptor;
  contact?: BecknContact;
  person?: BecknPerson;
  authorization?: {
    type?: string;
    token?: string;
    valid_from?: string;
    valid_to?: string;
  };
}
