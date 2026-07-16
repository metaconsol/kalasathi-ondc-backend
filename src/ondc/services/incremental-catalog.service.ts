/**
 * ONDC incremental catalog refresh (Discovery Flow).
 * Ref: Retail API contract v1.2.5, "Incremental catalog refresh" — BAP opens
 * a session via /search with intent.tags[catalog_inc].mode="start" (same
 * transaction_id reused for every subsequent push and for the "stop"
 * signal). While a session is open we diff the live catalog against the
 * last-pushed snapshot on a fixed interval and push only changed/new items
 * — never an empty catalog — via an unsolicited on_search tagged
 * `X-ONDC-Search-Response: inc` (the initial post-start snapshot is tagged
 * "full" by search.controller.ts, not here).
 *
 * Scope note: only item-level add/change is detected (matches the contract's
 * "only item(s) that have changed or new item(s) added" wording). New
 * providers require a full refresh per the contract and are intentionally
 * excluded from delta pushes here. Provider/store-level disable-as-delta is
 * not implemented — out of scope until a concrete payload shape is needed.
 */

import { catalogService } from '~/ondc/services/catalog.service';
import { becknService } from '~/ondc/services/beckn.service';
import { buildOnSearch, newMessageId } from '~/ondc/utils/payload.builder';
import type { OnSearchCatalog } from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { observabilityService } from '~/ondc/services/observability.service';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

// ONDC-mandated push cadence for incremental refresh is 1-30 minutes.
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 30 * 60_000;
const DEFAULT_INTERVAL_MS = 60_000;

const POLL_INTERVAL_MS = Math.min(
  MAX_INTERVAL_MS,
  Math.max(
    MIN_INTERVAL_MS,
    parseInt(process.env['ONDC_INCREMENTAL_POLL_INTERVAL_MS'] ?? '', 10) || DEFAULT_INTERVAL_MS,
  ),
);

type CatalogProvider = {
  id: string;
  items?: Array<{ id: string } & Record<string, unknown>>;
} & Record<string, unknown>;

interface IncrementalSession {
  ctx: BecknContext;
  domain: string;
  snapshot: Map<string, string>; // "${providerId}::${itemId}" -> JSON.stringify(item)
  knownProviderIds: Set<string>;
}

const sessions = new Map<string, IncrementalSession>(); // keyed by transaction_id

function flatten(catalog: OnSearchCatalog): {
  snapshot: Map<string, string>;
  providerIds: Set<string>;
} {
  const snapshot = new Map<string, string>();
  const providerIds = new Set<string>();
  const providers = (catalog['bpp/providers'] ?? []) as CatalogProvider[];
  for (const provider of providers) {
    providerIds.add(provider.id);
    for (const item of provider.items ?? []) {
      snapshot.set(`${provider.id}::${item.id}`, JSON.stringify(item));
    }
  }
  return { snapshot, providerIds };
}

/** Registers a session, seeded off the catalog just sent as the initial full on_search. */
function startSession(ctx: BecknContext, domain: string, initialCatalog: OnSearchCatalog): void {
  const { snapshot, providerIds } = flatten(initialCatalog);
  sessions.set(ctx.transaction_id, { ctx, domain, snapshot, knownProviderIds: providerIds });
  ondcLogger.info('Incremental catalog session started', {
    transactionId: ctx.transaction_id,
    bapId: ctx.bap_id,
    domain,
  });
}

/** Closes a session on a matching "stop" signal. Returns whether one was actually open. */
function stopSession(transactionId: string): boolean {
  const existed = sessions.delete(transactionId);
  if (existed) ondcLogger.info('Incremental catalog session stopped', { transactionId });
  return existed;
}

async function pushDelta(transactionId: string, session: IncrementalSession): Promise<void> {
  let fresh: OnSearchCatalog;
  try {
    fresh = await catalogService.buildSearchCatalog(session.domain);
  } catch (err) {
    ondcLogger.error('Incremental catalog: failed to rebuild catalog', { transactionId, err });
    return;
  }

  const providers = (fresh['bpp/providers'] ?? []) as CatalogProvider[];
  const deltaProviders: CatalogProvider[] = [];
  const nextSnapshot = new Map<string, string>();
  const nextProviderIds = new Set<string>();

  for (const provider of providers) {
    nextProviderIds.add(provider.id);
    const changedItems: Array<{ id: string } & Record<string, unknown>> = [];
    for (const item of provider.items ?? []) {
      const key = `${provider.id}::${item.id}`;
      const serialized = JSON.stringify(item);
      nextSnapshot.set(key, serialized);
      // New providers require a full refresh, not an incremental push — only
      // diff items under providers the session already knew about.
      if (session.knownProviderIds.has(provider.id) && session.snapshot.get(key) !== serialized) {
        changedItems.push(item);
      }
    }
    if (changedItems.length > 0) deltaProviders.push({ ...provider, items: changedItems });
  }

  session.snapshot = nextSnapshot;
  session.knownProviderIds = nextProviderIds;

  // Never send an empty incremental catalog per ONDC contract.
  if (deltaProviders.length === 0) return;

  const deltaCatalog: OnSearchCatalog = {
    'bpp/descriptor': fresh['bpp/descriptor'],
    'bpp/fulfillments': fresh['bpp/fulfillments'],
    'bpp/providers': deltaProviders,
  };

  const pushCtx: BecknContext = { ...session.ctx, message_id: newMessageId() };
  const payload = buildOnSearch(pushCtx, deltaCatalog) as any;
  const callbackUrl = becknService.buildCallbackUrl(session.ctx.bap_uri, 'on_search');

  const { statusCode, error } = await becknService.sendCallback(
    callbackUrl,
    'on_search',
    payload,
    transactionId,
    { 'X-ONDC-Search-Response': 'inc' },
  );

  await txnLogModel.insert({
    transaction_id: transactionId,
    message_id: payload.context.message_id,
    action: 'on_search',
    direction: 'outbound',
    bap_id: session.ctx.bap_id ?? null,
    bpp_id: payload.context.bpp_id ?? null,
    domain: session.domain,
    http_status: statusCode ?? null,
    ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
    payload_json: JSON.stringify(payload),
    error_message: error ?? null,
  });

  observabilityService.push('on_search', payload);
  ondcLogger.info('Incremental catalog: delta on_search pushed', {
    transactionId,
    providerCount: deltaProviders.length,
    itemCount: deltaProviders.reduce((n, p) => n + (p.items?.length ?? 0), 0),
  });
}

let isTicking = false;

async function runTick(): Promise<void> {
  if (isTicking || sessions.size === 0) return;
  isTicking = true;
  try {
    for (const [transactionId, session] of sessions) {
      await pushDelta(transactionId, session);
    }
  } finally {
    isTicking = false;
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Starts the incremental-catalog push loop. Safe to call unconditionally at startup; a second call is a no-op. */
function startScheduler(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    void runTick();
  }, POLL_INTERVAL_MS);
  ondcLogger.info('Incremental catalog scheduler started', { intervalMs: POLL_INTERVAL_MS });
}

export const incrementalCatalogService = {
  startSession,
  stopSession,
  startScheduler,
};
