/**
 * Drops inbound traffic from buyer apps an admin has switched off, before the
 * request is parsed, expanded into a catalog or allowed near the seller tables.
 *
 * Runs after ondcAuthMiddleware, so the bap_id has been proven by signature —
 * an unauthenticated caller can neither be filtered nor probe who is.
 *
 * Rollout is two-stage by design: FEATURE_BAP_TOGGLE_MANAGER_ENABLED turns the
 * whole thing on, and while BAP_FILTER_AUDIT_ONLY is set every decision is
 * recorded but nothing is actually dropped, so a week of real traffic can be
 * reviewed before any buyer app stops being served.
 */

import type { Request, Response, NextFunction } from 'express';
import { buildAck } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { bapManagementModel, normalizeBapId } from '~/ondc/models/bap_management.model';
import { bapFilterConfig, isFilterableAction } from '~/ondc/config/bap-filter.config';
import { inactiveBapIds } from '~/ondc/utils/bap-filter.cache';

/** The action being served, from the mount path — /search, /select, … */
function actionOf(req: Request): string {
  const fromContext = String((req.body as any)?.context?.action ?? '').trim();
  if (fromContext) return fromContext;
  return String(req.path ?? '').replace(/^\/+/, '') || 'unknown';
}

export async function bapFilterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!bapFilterConfig.enabled) return next();

  const ctx = (req.body as any)?.context ?? {};
  const bapId = normalizeBapId(ctx.bap_id);
  const action = actionOf(req);
  if (!bapId) return next();

  let inactive: Set<string>;
  try {
    inactive = await inactiveBapIds();
  } catch (err) {
    // Never let the switch itself take the network down: serve the request.
    ondcLogger.error('bap filter: could not read the inactive list — serving anyway', {
      bapId,
      err,
    });
    return next();
  }

  if (!inactive.has(bapId)) return next();

  // Switched off, but this action is one we always serve (transaction endpoints):
  // dropping /confirm or /status would strand an order already in progress.
  if (!isFilterableAction(action)) {
    ondcLogger.warn('bap filter: buyer app is off but this action is always served', {
      bapId,
      action,
    });
    return next();
  }

  // Filtering a buyer app that still has orders moving would break those orders.
  try {
    const inFlight = await bapManagementModel.countInFlightOrders(bapId);
    if (inFlight > 0) {
      ondcLogger.warn('bap filter: buyer app is off but has orders in flight — serving', {
        bapId,
        action,
        inFlight,
      });
      return next();
    }
  } catch (err) {
    ondcLogger.error('bap filter: in-flight check failed — serving', { bapId, action, err });
    return next();
  }

  // Fire-and-forget: the audit row must never delay or fail the response.
  bapManagementModel
    .logFiltered({
      bapId,
      requestType: action,
      transactionId: ctx.transaction_id ?? null,
      messageId: ctx.message_id ?? null,
    })
    .catch((err) => ondcLogger.error('bap filter: audit write failed', { bapId, action, err }));

  if (bapFilterConfig.auditOnly) {
    ondcLogger.info('bap filter: would have dropped this request (audit-only mode)', {
      bapId,
      action,
    });
    return next();
  }

  ondcLogger.info('bap filter: request dropped', { bapId, action });
  // 200 + ACK, not 202: Beckn requires an ACK/NACK envelope and a bare 202 is
  // not a valid response. We acknowledge receipt and simply never call back.
  res.status(200).json(buildAck(ctx));
}
