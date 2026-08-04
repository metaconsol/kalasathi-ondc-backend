/**
 * Admin BAP Management — which buyer apps we serve.
 *
 * Every write is SUPER_ADMIN only (see admin.route.ts), audited, and invalidates
 * the filter cache so a toggle takes effect on the next request rather than
 * after the TTL.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '~/lib/response';
import { bapManagementModel, normalizeBapId } from '~/ondc/models/bap_management.model';
import { invalidateBapFilterCache } from '~/ondc/utils/bap-filter.cache';
import { bapFilterConfig } from '~/ondc/config/bap-filter.config';
import { ondcLogger } from '~/ondc/utils/logger.util';

const bapIdSchema = z.string().trim().min(1).max(255);

const toggleSchema = z.object({
  is_active: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
  /** Set to switch off a buyer app that still has orders moving. */
  force: z.boolean().optional(),
});

const bulkToggleSchema = z.object({
  bap_ids: z.array(bapIdSchema).min(1).max(200),
  is_active: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
  force: z.boolean().optional(),
});

const importRowSchema = z.object({
  bap_id: bapIdSchema,
  bap_name: z.string().trim().max(255).optional(),
  should_activate: z.boolean().optional(),
});
const importSchema = z.object({ rows: z.array(importRowSchema).min(1).max(500) });

const actor = (req: Request) => ({
  changedBy: req.user?.id ?? null,
  changedByName: (req.user as any)?.name ?? (req.user as any)?.email ?? null,
});

/** GET /api/v1/ondc/admin/bap-management */
export async function listBapManagement(req: Request, res: Response): Promise<void> {
  const rows = await bapManagementModel.list(String(req.query['q'] ?? ''));
  ApiResponse.success(res, 'Buyer apps', rows, {
    total: rows.length,
    active: rows.filter((r) => r.is_active).length,
    inactive: rows.filter((r) => !r.is_active).length,
    feature_enabled: bapFilterConfig.enabled,
    audit_only: bapFilterConfig.auditOnly,
  } as any);
}

/**
 * Applies one toggle. Returns a reason string when it was refused so the caller
 * can surface it, rather than throwing for an expected outcome.
 */
async function applyToggle(
  req: Request,
  bapId: string,
  active: boolean,
  opts: { notes?: string | undefined; force?: boolean | undefined },
): Promise<{ ok: true } | { ok: false; reason: string; inFlight: number }> {
  const existing = await bapManagementModel.findByBapId(bapId);

  // Switching OFF a buyer app whose orders are still moving would strand them.
  if (!active && !opts.force) {
    const inFlight = await bapManagementModel.countInFlightOrders(bapId);
    if (inFlight > 0) {
      return {
        ok: false,
        inFlight,
        reason: `${bapId} has ${inFlight} order${inFlight === 1 ? '' : 's'} in flight`,
      };
    }
  }

  const who = actor(req);
  await bapManagementModel.setActive({
    bapId,
    active,
    bapName: existing?.bap_name ?? bapId,
    notes: opts.notes ?? null,
    updatedBy: who.changedBy,
  });
  await bapManagementModel.recordAudit({
    bapId,
    oldValue: existing ? existing.is_active : null,
    newValue: active,
    source: opts.force ? 'toggle-forced' : 'toggle',
    notes: opts.notes ?? null,
    ...who,
  });
  ondcLogger.info('bap management: toggled', {
    bapId,
    from: existing?.is_active ?? null,
    to: active,
    by: who.changedByName,
  });
  return { ok: true };
}

/** POST /api/v1/ondc/admin/bap-management/:bapId/toggle */
export async function toggleBapManagement(req: Request, res: Response): Promise<void> {
  const parsed = toggleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    ApiResponse.badRequest(res, 'is_active (boolean) is required');
    return;
  }
  const bapId = normalizeBapId(req.params['bapId']);
  if (!bapId) {
    ApiResponse.badRequest(res, 'bap_id is required');
    return;
  }

  const result = await applyToggle(req, bapId, parsed.data.is_active, parsed.data);
  if (!result.ok) {
    ApiResponse.badRequest(
      res,
      `${result.reason}. Wait for them to finish, or resend with force to switch it off anyway.`,
    );
    return;
  }
  invalidateBapFilterCache();
  ApiResponse.success(res, `Buyer app ${parsed.data.is_active ? 'activated' : 'deactivated'}`, {
    bap_id: bapId,
    is_active: parsed.data.is_active,
  });
}

/** POST /api/v1/ondc/admin/bap-management/bulk-toggle */
export async function bulkToggleBapManagement(req: Request, res: Response): Promise<void> {
  const parsed = bulkToggleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    ApiResponse.badRequest(res, 'bap_ids[] and is_active (boolean) are required');
    return;
  }
  const { bap_ids, is_active, notes, force } = parsed.data;

  const updated: string[] = [];
  const skipped: Array<{ bap_id: string; reason: string }> = [];
  for (const raw of bap_ids) {
    const bapId = normalizeBapId(raw);
    if (!bapId) continue;
    const result = await applyToggle(req, bapId, is_active, { notes, force });
    if (result.ok) updated.push(bapId);
    else skipped.push({ bap_id: bapId, reason: result.reason });
  }

  invalidateBapFilterCache();
  ApiResponse.success(
    res,
    `Updated ${updated.length} buyer app${updated.length === 1 ? '' : 's'}`,
    {
      updated,
      skipped,
    },
  );
}

/** GET /api/v1/ondc/admin/bap-management/:bapId/analytics */
export async function bapManagementAnalytics(req: Request, res: Response): Promise<void> {
  const bapId = normalizeBapId(req.params['bapId']);
  if (!bapId) {
    ApiResponse.badRequest(res, 'bap_id is required');
    return;
  }
  const hours = Math.min(720, Math.max(1, parseInt(String(req.query['hours'] ?? '24'), 10) || 24));

  const [record, hourly, funnel, errors, audit, inFlight] = await Promise.all([
    bapManagementModel.findByBapId(bapId),
    bapManagementModel.hourlyBreakdown(bapId, hours),
    bapManagementModel.funnel(bapId, hours),
    bapManagementModel.recentErrors(bapId),
    bapManagementModel.auditTrail(bapId),
    bapManagementModel.countInFlightOrders(bapId),
  ]);

  ApiResponse.success(res, 'Buyer app analytics', {
    bap_id: bapId,
    // A buyer app with no row has never been configured, which means active.
    is_active: record ? record.is_active : true,
    configured: Boolean(record),
    notes: record?.notes ?? null,
    hours,
    in_flight_orders: inFlight,
    hourly,
    funnel,
    errors,
    audit,
  });
}

/**
 * POST /api/v1/ondc/admin/bap-management/import
 * Rows come from the UI's CSV parse, so the wire format stays JSON and the
 * server never has to guess an encoding or delimiter.
 */
export async function importBapManagement(req: Request, res: Response): Promise<void> {
  const parsed = importSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    ApiResponse.badRequest(res, 'rows[] with bap_id is required');
    return;
  }

  const who = actor(req);
  const imported: string[] = [];
  for (const row of parsed.data.rows) {
    const bapId = normalizeBapId(row.bap_id);
    if (!bapId) continue;
    const existing = await bapManagementModel.findByBapId(bapId);
    const active = row.should_activate ?? existing?.is_active ?? true;
    await bapManagementModel.setActive({
      bapId,
      active,
      bapName: row.bap_name ?? existing?.bap_name ?? bapId,
      updatedBy: who.changedBy,
    });
    if (!existing || existing.is_active !== active) {
      await bapManagementModel.recordAudit({
        bapId,
        oldValue: existing ? existing.is_active : null,
        newValue: active,
        source: 'csv-import',
        ...who,
      });
    }
    imported.push(bapId);
  }

  invalidateBapFilterCache();
  ApiResponse.success(
    res,
    `Imported ${imported.length} buyer app${imported.length === 1 ? '' : 's'}`,
    {
      imported,
    },
  );
}
