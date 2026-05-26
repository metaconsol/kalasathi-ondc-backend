import type { BecknContext, BecknAck, BecknError } from './beckn.types';

/** Standard wrapper for every ONDC protocol response */
export interface OndcApiResponse<T = unknown> {
  context: BecknContext;
  message: T;
  error?: BecknError;
}

/** The immediate ACK we send back on every incoming request */
export interface OndcAckResponse {
  context: BecknContext;
  message: BecknAck;
  error?: BecknError;
}

/** ONDC admin API pagination meta */
export interface OndcPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Generic paginated list response for admin APIs */
export interface OndcListResponse<T> {
  success: boolean;
  data: T[];
  meta: OndcPaginationMeta;
}

/** Payload for sending a callback (on_search, on_select, etc.) */
export interface OndcCallbackJob {
  action: string;
  callbackUrl: string;
  transactionId: string;
  messageId: string;
  payload: OndcApiResponse;
  retries?: number;
}

/** ONDC digital signature header parsed shape */
export interface OndcAuthHeader {
  keyId: string; // "{subscriber_id}|{unique_key_id}|{algo}"
  algorithm: string;
  created: number;
  expires: number;
  headers: string;
  signature: string;
}

/** Transaction log stored in ondc_odop_db.ondc_txn_logs */
export interface OndcTxnLog {
  id: number;
  transaction_id: string;
  message_id: string;
  action: string;
  direction: 'inbound' | 'outbound';
  bap_id: string | null;
  bpp_id: string | null;
  domain: string | null;
  http_status: number | null;
  ack_status: 'ACK' | 'NACK' | null;
  payload_json: string;
  error_message: string | null;
  created_at: Date;
}
