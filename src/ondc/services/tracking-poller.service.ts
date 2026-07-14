/**
 * Background Delhivery tracking poller.
 *
 * Normal ecommerce doesn't wait for a buyer's /status call to learn a
 * shipment moved — it polls the courier and pushes updates as they happen.
 * This service does that: on a fixed interval it checks live Delhivery
 * status for every booked-but-not-yet-terminal ONDC order, and drives the
 * SAME fulfillmentService.mark*() transitions (+ unsolicited on_status) a
 * seller would otherwise click manually — so the API/callback structure is
 * unchanged, only the trigger becomes automatic.
 *
 * Load/storage safeguards (see updateFulfillment's AWB gate + Q&A this was
 * scoped against):
 *  - one tick every POLL_INTERVAL_MS (default 20 min, floor 5 min)
 *  - at most MAX_ORDERS_PER_TICK orders considered per tick
 *  - Delhivery calls run with a small concurrency cap, not all at once
 *  - ondc_orders is only written to when the raw courier status actually
 *    changed (delhivery_last_response is a LONGTEXT column — rewriting it
 *    every tick for shipments sitting idle between scans would be pure
 *    storage churn)
 *  - a STATE_RANK guard makes every applied transition idempotent and
 *    one-directional, so a repeated or late scan is always a safe no-op
 *  - a reentrancy guard skips a tick outright if the previous one is still
 *    running (e.g. Delhivery responding slowly)
 *
 * NOTE on batching: Delhivery's /api/v1/packages/json/ endpoint accepts a
 * comma-separated `waybill` list, but nothing in this codebase (or the
 * sibling odop_backend copy of this integration) has ever exercised that —
 * both existing call sites only look at ShipmentData[0], so the field that
 * would correlate each entry back to its waybill in a multi-waybill
 * response is unverified. Rather than guess and risk every batch silently
 * matching zero orders, this polls one order per HTTP call (same verified
 * shape as delhivery.service.ts's trackShipment) and controls load via the
 * interval/cap/concurrency limits above instead of payload batching.
 */

import axios from 'axios';
import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import { delhiveryEnv } from '~/config/delhivery.config';
import { fulfillmentService } from '~/ondc/services/fulfillment.service';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { OndcFulfillmentState } from '~/ondc/types/order.types';

const DELHIVERY_TIMEOUT_MS = 20_000;
const MIN_POLL_INTERVAL_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 20 * 60_000;
const MAX_ORDERS_PER_TICK = 300;
const CONCURRENCY = 8;

const POLL_INTERVAL_MS = Math.max(
  MIN_POLL_INTERVAL_MS,
  parseInt(process.env['ONDC_TRACKING_POLL_INTERVAL_MS'] ?? '', 10) || DEFAULT_POLL_INTERVAL_MS,
);

interface PollableOrderRow {
  ondc_order_id: string;
  tracking_number: string;
  delhivery_shipment_status: string | null;
}

/**
 * Forward-progress order used for the no-backward-movement guard below.
 * mapDelhiveryStatusToFulfillmentState only ever maps to one of the first 6
 * (forward) states, so those are the only ones that matter for ordering —
 * BUT every branch/terminal OndcFulfillmentState the poller could observe
 * via fulfillmentService.getState() (RTO/cancel/return/liquidated, reached
 * through a seller/admin action while a Delhivery scan for the same order
 * was already in flight) MUST also be listed here, ranked ABOVE every
 * forward state. Otherwise a missing key falls back to rank -1 in pollOrder,
 * which is LOWER than every real forward rank — so the "never move
 * backward" guard couldn't actually block a stale scan from resurrecting a
 * cancelled/RTO'd/returned order's forward progress. This was a real,
 * adversarially-verified bug; keep every OndcFulfillmentState variant
 * represented here (forward OR terminal) when the enum changes.
 */
const STATE_RANK: Partial<Record<OndcFulfillmentState, number>> = {
  Pending: 0,
  Packed: 1,
  'Agent-assigned': 2,
  'Order-picked-up': 3,
  'Out-for-delivery': 4,
  'Order-delivered': 5,
  // Branch/terminal states — always outrank every forward state above so
  // the poller can never move an order out of one of them.
  'RTO-Initiated': 100,
  'RTO-Delivered': 100,
  'RTO-Disposed': 100,
  Cancelled: 100,
  Return_Initiated: 100,
  Return_Approved: 100,
  Return_Picked: 100,
  Return_Delivered: 100,
  Return_Rejected: 100,
  Liquidated: 100,
};

/**
 * Conservative Delhivery-status → ONDC fulfillment-state mapping. Only ever
 * returns the 3 states this poller is allowed to auto-apply (agent
 * assignment stays a manual seller step; cancel/RTO/return stay manual per
 * the scoping this was built against) — anything ambiguous or unrecognized
 * returns null (no auto-action) rather than guessing. `statusType`'s 2-letter
 * codes are the more stable signal; the free-text `statusText` fills in
 * sub-states (e.g. out-for-delivery) that don't have their own code.
 */
export function mapDelhiveryStatusToFulfillmentState(
  statusType: string | null | undefined,
  statusText: string | null | undefined,
): OndcFulfillmentState | null {
  const type = (statusType ?? '').trim().toUpperCase();
  const text = (statusText ?? '').trim().toLowerCase();
  if (!type && !text) return null;

  // RTO/cancellation first — both can contain "delivered" (e.g. "RTO
  // Delivered") and must never be misread as a customer delivery.
  if (type === 'RT' || text.includes('rto') || text.includes('return to origin')) return null;
  if (type === 'CN' || text.includes('cancel')) return null;
  if (type === 'DL' || text.includes('delivered')) return 'Order-delivered';

  // Pre-pickup states ("Not Picked", "Pickup Scheduled/Pending/Failed", ...)
  // must stay null rather than fall into the broad picked/pickup match below
  // — verified by a runtime check that caught exactly this false positive:
  // naive substring matching read "Not Picked" and "Pickup Scheduled" as
  // Order-picked-up, which would have auto-advanced an order that hasn't
  // actually moved yet.
  if (
    /\bnot[\s-]*picked\b/.test(text) ||
    /pickup\s*((re)?scheduled|pending|generated|requested|awaited|failed)/.test(text)
  ) {
    return null;
  }

  // Keyword set below is corroborated by odop_backend's own
  // isShipmentAlreadyMoving() gate (src/service/delhivery.service.ts), the
  // one place in either codebase that already trusts specific Delhivery
  // status substrings — reused here instead of guessing a fresh vocabulary.
  if (
    text.includes('out for delivery') ||
    text.includes('out-for-delivery') ||
    text.includes('ofd')
  ) {
    return 'Out-for-delivery';
  }
  if (
    type === 'PU' ||
    text.includes('picked') ||
    text.includes('pickup') ||
    text.includes('shipped') ||
    text.includes('dispatch') ||
    text.includes('transit')
  ) {
    return 'Order-picked-up';
  }
  return null;
}

let isPolling = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    const i = nextIndex++;
    if (i >= items.length) return;
    await worker(items[i] as T);
    return runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
}

async function pollOrder(order: PollableOrderRow): Promise<void> {
  let data: Record<string, any>;
  try {
    const response = await axios.get(`${delhiveryEnv.baseUrl}/api/v1/packages/json/`, {
      params: { token: delhiveryEnv.token, waybill: order.tracking_number },
      timeout: DELHIVERY_TIMEOUT_MS,
    });
    data = response.data as Record<string, any>;
  } catch (err) {
    ondcLogger.error('tracking-poller: Delhivery call failed', {
      ondcOrderId: order.ondc_order_id,
      err,
    });
    return;
  }

  try {
    const shipment = data?.['ShipmentData']?.[0]?.Shipment;
    const statusText: string | null = shipment?.Status?.Status || null;
    const statusType: string | null = shipment?.Status?.StatusType || null;
    const statusAt: string | null = shipment?.Status?.StatusDateTime || null;
    const rawStatus = statusText || statusType || null;

    if (rawStatus && rawStatus !== order.delhivery_shipment_status) {
      await ondcExec(
        `UPDATE ondc_orders SET
           delhivery_shipment_status = ?, delhivery_last_scan_at = ?,
           delhivery_last_response = ?, updated_at = NOW()
         WHERE ondc_order_id = ?`,
        [
          rawStatus,
          statusAt ? new Date(statusAt) : null,
          JSON.stringify(data),
          order.ondc_order_id,
        ],
      );
    }

    const mapped = mapDelhiveryStatusToFulfillmentState(statusType, statusText);
    if (!mapped) return;

    const currentState = await fulfillmentService.getState(order.ondc_order_id);
    const currentRank = currentState ? (STATE_RANK[currentState] ?? -1) : -1;
    const mappedRank = STATE_RANK[mapped] ?? -1;
    // No-backward-movement / idempotency guard — a late or duplicate scan
    // for a state we've already reached is a no-op, never a re-send.
    if (mappedRank <= currentRank) return;

    if (mapped === 'Order-picked-up') {
      await fulfillmentService.markPickedUp(order.ondc_order_id);
    } else if (mapped === 'Out-for-delivery') {
      await fulfillmentService.markOutForDelivery(order.ondc_order_id);
    } else if (mapped === 'Order-delivered') {
      await fulfillmentService.markDelivered(order.ondc_order_id);
    }
  } catch (err) {
    ondcLogger.error('tracking-poller: failed to apply status for order', {
      ondcOrderId: order.ondc_order_id,
      err,
    });
  }
}

async function runPollTick(): Promise<void> {
  if (isPolling) return; // previous tick still running — skip rather than overlap
  isPolling = true;
  try {
    const orders = await ondcQuery<PollableOrderRow>(
      `SELECT ondc_order_id, tracking_number, delhivery_shipment_status
       FROM ondc_orders
       WHERE tracking_number IS NOT NULL
         AND status NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED')
       ORDER BY updated_at ASC
       LIMIT ?`,
      [MAX_ORDERS_PER_TICK],
    );
    if (orders.length === 0) return;

    await runWithConcurrency(orders, CONCURRENCY, pollOrder);
    ondcLogger.info('tracking-poller: tick complete', { orderCount: orders.length });
  } catch (err) {
    ondcLogger.error('tracking-poller: tick failed', { err });
  } finally {
    isPolling = false;
  }
}

/**
 * Starts the background polling loop. Safe to call unconditionally at
 * startup — it's a no-op (and starts no interval/timer) when Delhivery
 * isn't enabled/configured, and a second call is a no-op if already started.
 */
export function startTrackingPoller(): void {
  if (intervalHandle) return;
  if (!delhiveryEnv.enabled || !delhiveryEnv.token) {
    ondcLogger.info('tracking-poller: Delhivery not configured — poller not started');
    return;
  }
  ondcLogger.info('tracking-poller: started', { intervalMs: POLL_INTERVAL_MS });
  intervalHandle = setInterval(() => {
    void runPollTick();
  }, POLL_INTERVAL_MS);
}
