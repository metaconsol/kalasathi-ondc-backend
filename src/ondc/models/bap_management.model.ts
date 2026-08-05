/**
 * bap_management — per-buyer-app on/off switch for inbound traffic.
 *
 * Request stats are read from ondc_txn_logs and ondc_orders, which already
 * record every processed request and every order; only filtered requests are
 * written to bap_request_log.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export interface BapManagementRow {
  id: number;
  bap_id: string;
  bap_name: string | null;
  is_active: boolean;
  notes: string | null;
  updated_by: number | null;
  config_updated_at: Date;
  created_at: Date;
}

export interface BapListRow extends BapManagementRow {
  requests_24h: number;
  filtered_24h: number;
  orders_24h: number;
  conversion_rate: number;
  last_request_at: Date | null;
  last_order_at: Date | null;
  in_flight_orders: number;
  last_toggled_by: string | null;
  last_toggled_at: Date | null;
}

/** ONDC subscriber ids are domains. Stored lowercase so a casing change still matches. */
export function normalizeBapId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 255);
}

const mapRow = (r: any): BapManagementRow => ({
  id: r.id != null ? Number(r.id) : 0,
  bap_id: r.bap_id,
  bap_name: r.bap_name ?? null,
  is_active: Boolean(r.is_active),
  notes: r.notes ?? null,
  updated_by: r.updated_by != null ? Number(r.updated_by) : null,
  config_updated_at: r.config_updated_at,
  created_at: r.created_at,
});

// Orders that are still moving. Toggling a BAP off must not strand these.
const IN_FLIGHT = `(SELECT COUNT(*) FROM ondc_orders o
   WHERE o.bap_id = k.bap_id AND o.status NOT IN ('DELIVERED','CANCELLED','RETURNED'))`;

// 24h counters. ondc_txn_logs holds one row per inbound request already.
const REQ_24H = `(SELECT COUNT(*) FROM ondc_txn_logs l
   WHERE l.bap_id = k.bap_id AND l.direction = 'inbound'
     AND l.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))`;
const FILTERED_24H = `(SELECT COUNT(*) FROM bap_request_log f
   WHERE f.bap_id = k.bap_id AND f.was_processed = 0
     AND f.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))`;
const ORDERS_24H = `(SELECT COUNT(*) FROM ondc_orders o
   WHERE o.bap_id = k.bap_id AND o.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))`;
const LAST_REQ = `(SELECT MAX(l.created_at) FROM ondc_txn_logs l
   WHERE l.bap_id = k.bap_id AND l.direction = 'inbound')`;
const LAST_ORDER = `(SELECT MAX(o.created_at) FROM ondc_orders o WHERE o.bap_id = k.bap_id)`;
const LAST_TOGGLE = `(SELECT a.changed_by_name FROM bap_management_audit a
   WHERE a.bap_id = k.bap_id ORDER BY a.id DESC LIMIT 1)`;
const LAST_TOGGLE_AT = `(SELECT a.changed_at FROM bap_management_audit a
   WHERE a.bap_id = k.bap_id ORDER BY a.id DESC LIMIT 1)`;

/**
 * Every buyer app we know of, not only the ones an admin has already configured.
 *
 * bap_terms gets a row on every inbound /search, so it is the real record of who
 * sends us traffic; bap_management only has a row once someone toggles that BAP
 * or the 008 seed ran. Listing from bap_management alone meant a buyer app that
 * appeared after the migration could never show up on the screen — 10 rows
 * listed against 20 buyer apps actually sending requests.
 *
 * COALESCE(m.is_active, 1): no config row means active, the same rule the filter
 * middleware applies.
 */
const KNOWN_BAPS = `FROM (
         SELECT LOWER(TRIM(bap_id)) AS bap_id FROM bap_terms
          WHERE TRIM(COALESCE(bap_id, '')) <> ''
          UNION
         SELECT bap_id FROM bap_management
       ) k
       LEFT JOIN bap_management m ON m.bap_id = k.bap_id`;

export const bapManagementModel = {
  /** Only the ids that are switched OFF — the filter's whole working set. */
  async listInactiveIds(): Promise<string[]> {
    const rows = await ondcQuery<{ bap_id: string }>(
      `SELECT bap_id FROM bap_management WHERE is_active = 0`,
    );
    return rows.map((r) => normalizeBapId(r.bap_id));
  },

  async list(search?: string): Promise<BapListRow[]> {
    const term = String(search ?? '').trim();
    const where = term ? 'WHERE k.bap_id LIKE ? OR m.bap_name LIKE ?' : '';
    const params = term ? [`%${term}%`, `%${term}%`] : [];
    const rows = await ondcQuery<any>(
      `SELECT k.bap_id                       AS bap_id,
              m.id                           AS id,
              COALESCE(m.bap_name, k.bap_id) AS bap_name,
              COALESCE(m.is_active, 1)       AS is_active,
              m.notes                        AS notes,
              m.updated_by                   AS updated_by,
              m.config_updated_at            AS config_updated_at,
              m.created_at                   AS created_at,
              ${REQ_24H}        AS requests_24h,
              ${FILTERED_24H}   AS filtered_24h,
              ${ORDERS_24H}     AS orders_24h,
              ${LAST_REQ}       AS last_request_at,
              ${LAST_ORDER}     AS last_order_at,
              ${IN_FLIGHT}      AS in_flight_orders,
              ${LAST_TOGGLE}    AS last_toggled_by,
              ${LAST_TOGGLE_AT} AS last_toggled_at
       ${KNOWN_BAPS} ${where}
       ORDER BY is_active DESC, requests_24h DESC, k.bap_id ASC`,
      params,
    );
    return rows.map((r) => {
      const requests = Number(r.requests_24h ?? 0);
      const orders = Number(r.orders_24h ?? 0);
      return {
        ...mapRow(r),
        requests_24h: requests,
        filtered_24h: Number(r.filtered_24h ?? 0),
        orders_24h: orders,
        conversion_rate: requests > 0 ? Math.round((orders / requests) * 10000) / 100 : 0,
        last_request_at: r.last_request_at ?? null,
        last_order_at: r.last_order_at ?? null,
        in_flight_orders: Number(r.in_flight_orders ?? 0),
        last_toggled_by: r.last_toggled_by ?? null,
        last_toggled_at: r.last_toggled_at ?? null,
      };
    });
  },

  async findByBapId(bapId: string): Promise<BapManagementRow | null> {
    const rows = await ondcQuery<any>(`SELECT * FROM bap_management WHERE bap_id = ? LIMIT 1`, [
      normalizeBapId(bapId),
    ]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async countInFlightOrders(bapId: string): Promise<number> {
    const rows = await ondcQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ondc_orders
       WHERE bap_id = ? AND status NOT IN ('DELIVERED','CANCELLED','RETURNED')`,
      [normalizeBapId(bapId)],
    );
    return Number(rows[0]?.cnt ?? 0);
  },

  /** Upsert so a buyer app that has never been configured can still be switched off. */
  async setActive(input: {
    bapId: string;
    active: boolean;
    bapName?: string | null;
    notes?: string | null;
    updatedBy?: number | null;
  }): Promise<void> {
    const bapId = normalizeBapId(input.bapId);
    await ondcExec(
      `INSERT INTO bap_management (bap_id, bap_name, is_active, notes, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_active         = VALUES(is_active),
         bap_name          = COALESCE(NULLIF(VALUES(bap_name), ''), bap_name),
         notes             = COALESCE(VALUES(notes), notes),
         updated_by        = VALUES(updated_by),
         config_updated_at = NOW()`,
      [
        bapId,
        input.bapName ?? bapId,
        input.active ? 1 : 0,
        input.notes ?? null,
        input.updatedBy ?? null,
      ],
    );
  },

  async recordAudit(input: {
    bapId: string;
    oldValue: boolean | null;
    newValue: boolean;
    changedBy?: number | null;
    changedByName?: string | null;
    source?: string;
    notes?: string | null;
  }): Promise<void> {
    await ondcExec(
      `INSERT INTO bap_management_audit
         (bap_id, old_value, new_value, changed_by, changed_by_name, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeBapId(input.bapId),
        input.oldValue === null ? null : input.oldValue ? 1 : 0,
        input.newValue ? 1 : 0,
        input.changedBy ?? null,
        input.changedByName ?? null,
        input.source ?? 'toggle',
        input.notes ?? null,
      ],
    );
  },

  async auditTrail(bapId: string, limit = 50): Promise<any[]> {
    return ondcQuery<any>(
      `SELECT id, old_value, new_value, changed_by, changed_by_name, source, notes, changed_at
       FROM bap_management_audit WHERE bap_id = ?
       ORDER BY id DESC LIMIT ?`,
      [normalizeBapId(bapId), limit],
    );
  },

  /** Requests per hour over a window, processed vs filtered, for the drill-down. */
  async hourlyBreakdown(bapId: string, hours: number): Promise<any[]> {
    return ondcQuery<any>(
      `SELECT hour_bucket, SUM(processed) AS processed, SUM(filtered) AS filtered
       FROM (
         SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00') AS hour_bucket, 1 AS processed, 0 AS filtered
           FROM ondc_txn_logs
          WHERE bap_id = ? AND direction = 'inbound'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
         UNION ALL
         SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00'), 0, 1
           FROM bap_request_log
          WHERE bap_id = ? AND was_processed = 0
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
       ) x
       GROUP BY hour_bucket ORDER BY hour_bucket ASC`,
      [normalizeBapId(bapId), hours, normalizeBapId(bapId), hours],
    );
  },

  /** Inbound action counts — the discovery-to-order funnel for one buyer app. */
  async funnel(bapId: string, hours: number): Promise<any[]> {
    return ondcQuery<any>(
      `SELECT action, COUNT(DISTINCT transaction_id) AS transactions, COUNT(*) AS requests
       FROM ondc_txn_logs
       WHERE bap_id = ? AND direction = 'inbound'
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
       GROUP BY action ORDER BY requests DESC`,
      [normalizeBapId(bapId), hours],
    );
  },

  /** Outbound callbacks this buyer app NACKed, plus anything we failed to send. */
  async recentErrors(bapId: string, limit = 25): Promise<any[]> {
    return ondcQuery<any>(
      `SELECT transaction_id, action, direction, http_status, ack_status, error_message, created_at
       FROM ondc_txn_logs
       WHERE bap_id = ?
         AND (ack_status = 'NACK' OR error_message IS NOT NULL OR http_status >= 400)
       ORDER BY id DESC LIMIT ?`,
      [normalizeBapId(bapId), limit],
    );
  },

  /** One row per dropped request. Processed ones are already in ondc_txn_logs. */
  async logFiltered(input: {
    bapId: string;
    requestType: string;
    transactionId?: string | null;
    messageId?: string | null;
  }): Promise<void> {
    await ondcExec(
      `INSERT INTO bap_request_log (bap_id, request_type, was_processed, transaction_id, message_id)
       VALUES (?, ?, 0, ?, ?)`,
      [
        normalizeBapId(input.bapId),
        String(input.requestType ?? '').slice(0, 32),
        input.transactionId ?? null,
        input.messageId ?? null,
      ],
    );
  },
};
