/**
 * Beckn/ONDC payload builders.
 * All outgoing callbacks (on_search, on_select, on_init, on_confirm, on_status, etc.)
 * are assembled here, matching the PHP reference implementation exactly.
 */

import { randomUUID } from 'crypto';
import type { BecknContext, BecknError } from '~/ondc/types/beckn.types';
import type { OndcAckResponse } from '~/ondc/types/api.types';
import { ondcEnv } from '~/config/ondc.config';

// ─── Context builders ──────────────────────────────────────────────────────

/**
 * Build the response context for both sync (ACK/NACK) and async (on_X) responses.
 *
 * Beckn rule: the response context MIRRORS the incoming context exactly, with
 * only these well-defined deltas:
 *   - action       : swapped to the response action (e.g. search → on_search)
 *   - bpp_id/uri   : added (we identify ourselves to the BAP)
 *   - timestamp    : refreshed to our send time
 *
 * core_version MUST echo the incoming version — never override it. Some BAPs
 * (and Pramaan) reject responses that don't match the version they sent.
 * Same for country, city, ttl, domain, transaction_id, message_id — all
 * inherited verbatim from the spread.
 */
export function buildResponseContext(incomingCtx: BecknContext, action: string): BecknContext {
  return {
    ...incomingCtx,
    action: action as BecknContext['action'],
    bpp_id: ondcEnv.subscriberId,
    bpp_uri: ondcEnv.baseUri,
    timestamp: nowIso(),
  };
}

// ─── Sync ACK / NACK ──────────────────────────────────────────────────────

export function buildAck(context: BecknContext, error?: BecknError): OndcAckResponse {
  const ctx = buildResponseContext(context, context.action);
  const r: OndcAckResponse = { context: ctx, message: { ack: { status: error ? 'NACK' : 'ACK' } } };
  if (error) r.error = error;
  return r;
}

export function buildNack(context: BecknContext, error: BecknError): OndcAckResponse {
  return buildAck(context, error);
}

// ─── /on_search ────────────────────────────────────────────────────────────

// Per ONDC 1.2.5 MSN contract: bpp/payments is NOT at catalog level.
// Payment terms echo back inside each provider as @ondc/org/payments.
export interface OnSearchCatalog {
  'bpp/descriptor': object;
  'bpp/fulfillments': object[];
  'bpp/offers'?: unknown[];
  'bpp/providers': object[];
}

export function buildOnSearch(incomingCtx: BecknContext, catalog: OnSearchCatalog): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_search'),
    message: { catalog },
  };
}

// ─── /on_select ────────────────────────────────────────────────────────────

export function buildOnSelect(
  incomingCtx: BecknContext,
  order: {
    provider: object;
    items: object[];
    fulfillments: object[];
    quote: object;
  },
  error?: BecknError,
): object {
  const payload: Record<string, unknown> = {
    context: buildResponseContext(incomingCtx, 'on_select'),
    message: { order },
  };
  if (error) payload['error'] = error;
  return payload;
}

// ─── /on_init ──────────────────────────────────────────────────────────────

export function buildOnInit(
  incomingCtx: BecknContext,
  order: {
    provider: object;
    items: object[];
    billing: object;
    fulfillments: object[];
    quote: object;
    payment: object;
    tags?: object[];
  },
): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_init'),
    message: { order },
  };
}

// ─── /on_confirm ───────────────────────────────────────────────────────────

export function buildOnConfirm(
  incomingCtx: BecknContext,
  order: {
    id: string;
    state: string;
    provider: object;
    items: object[];
    billing: object;
    fulfillments: object[];
    quote: object;
    payment: object;
    tags?: object[];
    created_at?: string;
    updated_at?: string;
  },
): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_confirm'),
    message: { order },
  };
}

// ─── /on_status ────────────────────────────────────────────────────────────

export function buildOnStatus(incomingCtx: BecknContext, order: object): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_status'),
    message: { order },
  };
}

// ─── /on_cancel ────────────────────────────────────────────────────────────

export function buildOnCancel(
  incomingCtx: BecknContext,
  order: object,
  error?: BecknError,
): object {
  const payload: Record<string, unknown> = {
    context: buildResponseContext(incomingCtx, 'on_cancel'),
    message: { order },
  };
  if (error) payload['error'] = error;
  return payload;
}

// ─── /on_track ─────────────────────────────────────────────────────────────

export function buildOnTrack(incomingCtx: BecknContext, tracking: object): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_track'),
    message: { tracking },
  };
}

// ─── /on_update ────────────────────────────────────────────────────────────

export function buildOnUpdate(incomingCtx: BecknContext, order: object): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_update'),
    message: { order },
  };
}

// ─── /on_rating (v1.2.5) ───────────────────────────────────────────────────

/**
 * BPP sends on_rating after receiving a /rating from BAP.
 * Per ONDC v1.2.5 spec, message contains an optional feedback_form.
 * We return an empty message ({}) which is the minimal valid response.
 */
export function buildOnRating(incomingCtx: BecknContext): object {
  return {
    context: buildResponseContext(incomingCtx, 'on_rating'),
    message: {},
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function newMessageId(): string {
  return randomUUID();
}
/** ONDC timestamps are millisecond-zeroed ISO-8601 (e.g. 2025-01-08T07:00:30.000Z). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export function formatPrice(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

export function toOndcPrice(amount: number, currency = 'INR'): { currency: string; value: string } {
  return { currency, value: formatPrice(amount) };
}

export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Standard cancellation terms covering all fulfillment phases */
export const STANDARD_CANCELLATION_TERMS = [
  {
    fulfillment_state: { descriptor: { code: 'Pending', short_desc: '001' } },
    reason_required: false,
    cancel_by: { duration: 'PT1H' },
    cancellation_fee: { percentage: '0' },
  },
  {
    fulfillment_state: { descriptor: { code: 'Packed', short_desc: '001' } },
    reason_required: true,
    cancellation_fee: { percentage: '0' },
  },
  {
    fulfillment_state: { descriptor: { code: 'Order-picked-up', short_desc: '001' } },
    reason_required: true,
    cancellation_fee: { percentage: '10' },
  },
  {
    fulfillment_state: { descriptor: { code: 'Out-for-delivery', short_desc: '001' } },
    reason_required: true,
    cancellation_fee: { percentage: '10' },
  },
];
