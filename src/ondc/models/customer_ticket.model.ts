/**
 * IGM Customer Ticket model — backed by `ondc_customer_ticket`.
 *
 * The chat/transcript is stored in `actions_json` as an array of UI-shaped
 * message objects (the Tickets page renders these directly):
 *   { id, actor, sender_role, sender_name, message, images[], attachments[],
 *     source, action_code, created_at }
 * Resolution offers/decisions are also mirrored into `resolutions_json`.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import { extractTicketMirrorFields, type TicketMirrorFields } from '~/ondc/utils/igm.builder';

export interface TicketMessage {
  id: string;
  actor: 'CONSUMER' | 'SELLER' | 'SYSTEM';
  sender_role: string; // CONSUMER | SELLER | SUPPORT | SYSTEM (UI side-detection)
  sender_name?: string;
  message: string;
  images?: Array<string | { url: string; name?: string }>;
  attachments?: Array<string | { name: string; url?: string }>;
  source?: string;
  action_code?: string; // ONDC action e.g. OPEN, GET_INFO, INFO_PROVIDED, RESOLVED...
  created_at: string;
}

export interface CustomerTicketRow {
  id: number;
  ticket_id: string;
  txn_id: string;
  order_id: string | null;
  provider_id: string | null;
  seller_id: number | null;
  domain: string;
  display_status: string;
  igm_status_raw: string | null;
  priority: string;
  issue_category_code: string | null;
  issue_category_label: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  reason_name: string | null;
  reason_short_desc: string | null;
  reason_long_desc: string | null;
  descriptor_json: string | null;
  bap_id: string | null;
  bap_uri: string | null;
  bpp_id: string | null;
  bpp_uri: string | null;
  country: string | null;
  city: string | null;
  core_version: string | null;
  ttl: string | null;
  descriptor_attachments_json: string | null;
  actions_json: string | null;
  resolutions_json: string | null;
  payload_json: string | null;
  refs_json: string | null;
  actors_json: string | null;
  last_action_id: string | null;
  last_action_code: string | null;
  selected_resolution_code: string | null;
  actions_count: number;
  created_at: string | null;
  updated_at: string | null;
}

function parseMessages(row: Pick<CustomerTicketRow, 'actions_json'>): TicketMessage[] {
  try {
    const arr = JSON.parse(row.actions_json ?? '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export const customerTicketModel = {
  parseMessages,

  async list(
    filters: { status?: string; sellerId?: number; limit?: number; offset?: number } = {},
  ): Promise<CustomerTicketRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push('display_status = ?');
      params.push(filters.status);
    }
    if (filters.sellerId !== undefined) {
      where.push('seller_id = ?');
      params.push(filters.sellerId);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return ondcQuery<CustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket ${clause}
       ORDER BY COALESCE(updated_at, db_updated_at) DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 50, filters.offset ?? 0],
    );
  },

  async getById(id: number): Promise<CustomerTicketRow | null> {
    const rows = await ondcQuery<CustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async findByTicketId(ticketId: string): Promise<CustomerTicketRow | null> {
    const rows = await ondcQuery<CustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket WHERE ticket_id = ? LIMIT 1`,
      [ticketId],
    );
    return rows[0] ?? null;
  },

  /** Create the ticket on the first inbound /issue (OPEN). */
  async create(data: {
    ticket_id: string;
    txn_id: string;
    order_id?: string | null;
    provider_id?: string | null;
    seller_id?: number | null;
    domain?: string;
    display_status?: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    bap_id?: string | null;
    bap_uri?: string | null;
    bpp_id?: string | null;
    bpp_uri?: string | null;
    country?: string | null;
    city?: string | null;
    core_version?: string | null;
    ttl?: string | null;
    descriptor_attachments_json?: string | null;
    descriptor_json?: string | null;
    payload_json?: string | null;
    refs_json?: string | null;
    actors_json?: string | null;
    resolutions_json?: string | null;
    messages: TicketMessage[];
    mirror?: TicketMirrorFields;
  }): Promise<number> {
    const mirror =
      data.mirror ??
      extractTicketMirrorFields(
        data.payload_json ? (JSON.parse(data.payload_json) as Record<string, unknown>) : {},
      );
    const res = await ondcExec(
      `INSERT INTO ondc_customer_ticket
        (ticket_id, txn_id, order_id, provider_id, seller_id, domain,
         issue_level, display_status, igm_status_raw, priority,
         issue_type_code, issue_type_label, issue_category_code, issue_category_label,
         issue_source_type_code, issue_source_type_label,
         provider_type_code, provider_type_label, gro_type_code, gro_type_label,
         complainant_action_code, complainant_action_label,
         resolution_action_code, resolution_action_label,
         customer_actor_id, customer_name, customer_phone, customer_email,
         source_id, complainant_id, respondent_ids_json, resolver_ids_json,
         bap_id, bap_uri, bpp_id, bpp_uri, country, city, core_version, ttl,
         reason_code, reason_name, reason_short_desc, reason_long_desc,
         descriptor_json, descriptor_attachments_json,
         payload_json, refs_json, actors_json,
         actions_json, resolutions_json,
         last_action_id, last_action_code, last_action_by, last_actor_name,
         selected_resolution_id, selected_resolution_code, selected_resolution_label,
         actions_count, resolutions_count, open_info_request_count,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, NOW(), NOW())`,
      [
        data.ticket_id,
        data.txn_id,
        data.order_id ?? null,
        data.provider_id ?? null,
        data.seller_id ?? null,
        data.domain ?? 'ONDC:RET12',
        mirror.issue_level ?? 'ISSUE',
        data.display_status ?? 'OPEN',
        mirror.igm_status_raw ?? data.display_status ?? 'OPEN',
        'MEDIUM',
        mirror.issue_type_code,
        mirror.issue_type_label,
        mirror.issue_category_code,
        mirror.issue_category_label,
        mirror.issue_source_type_code,
        mirror.issue_source_type_label,
        mirror.provider_type_code,
        mirror.provider_type_label,
        mirror.gro_type_code,
        mirror.gro_type_label,
        mirror.complainant_action_code,
        mirror.complainant_action_label,
        mirror.resolution_action_code,
        mirror.resolution_action_label,
        mirror.customer_actor_id,
        data.customer_name ?? null,
        data.customer_phone ?? null,
        data.customer_email ?? null,
        mirror.source_id,
        mirror.complainant_id,
        mirror.respondent_ids_json,
        mirror.resolver_ids_json,
        data.bap_id ?? null,
        data.bap_uri ?? null,
        data.bpp_id ?? null,
        data.bpp_uri ?? null,
        data.country ?? null,
        data.city ?? null,
        data.core_version ?? null,
        data.ttl ?? null,
        mirror.reason_code,
        mirror.reason_name,
        mirror.reason_short_desc,
        mirror.reason_long_desc,
        data.descriptor_json ?? null,
        data.descriptor_attachments_json ?? null,
        data.payload_json ?? null,
        data.refs_json ?? null,
        data.actors_json ?? null,
        JSON.stringify(data.messages ?? []),
        data.resolutions_json ?? '[]',
        mirror.last_action_id,
        mirror.last_action_code ?? data.messages.at(-1)?.action_code ?? null,
        mirror.last_action_by,
        mirror.last_actor_name,
        mirror.selected_resolution_id,
        mirror.selected_resolution_code,
        mirror.selected_resolution_label,
        data.messages.length,
        mirror.resolutions_count,
        mirror.open_info_request_count,
      ],
    );
    return res.insertId;
  },

  /** Persist full IGM 2.0 issue state (payload_json + all mirror columns). */
  async saveIgmIssueState(
    id: number,
    issue: Record<string, unknown>,
    opts: {
      displayStatus?: string;
      igmStatusRaw?: string;
      resolutions?: unknown[];
      country?: string;
      city?: string;
      coreVersion?: string;
      ttl?: string;
    } = {},
  ): Promise<void> {
    const mirror = extractTicketMirrorFields(issue);
    const desc = (issue['descriptor'] as Record<string, unknown>) ?? {};
    const sets = [
      'payload_json = ?',
      'refs_json = ?',
      'actors_json = ?',
      'descriptor_json = ?',
      'issue_level = ?',
      'issue_type_code = ?',
      'issue_type_label = ?',
      'issue_category_code = ?',
      'issue_category_label = ?',
      'issue_source_type_code = ?',
      'issue_source_type_label = ?',
      'provider_type_code = ?',
      'provider_type_label = ?',
      'gro_type_code = ?',
      'gro_type_label = ?',
      'complainant_action_code = ?',
      'complainant_action_label = ?',
      'resolution_action_code = ?',
      'resolution_action_label = ?',
      'customer_actor_id = ?',
      'source_id = ?',
      'complainant_id = ?',
      'respondent_ids_json = ?',
      'resolver_ids_json = ?',
      'reason_code = ?',
      'reason_name = ?',
      'reason_short_desc = ?',
      'reason_long_desc = ?',
      'last_action_id = ?',
      'last_action_code = ?',
      'last_action_by = ?',
      'last_actor_name = ?',
      'resolutions_count = ?',
      'open_info_request_count = ?',
      'selected_resolution_id = ?',
      'selected_resolution_code = ?',
      'selected_resolution_label = ?',
      'country = COALESCE(?, country)',
      'city = COALESCE(?, city)',
      'core_version = COALESCE(?, core_version)',
      'ttl = COALESCE(?, ttl)',
      'updated_at = NOW()',
    ];
    const params: unknown[] = [
      JSON.stringify(issue),
      JSON.stringify(issue['refs'] ?? []),
      JSON.stringify(issue['actors'] ?? []),
      JSON.stringify(desc),
      mirror.issue_level,
      mirror.issue_type_code,
      mirror.issue_type_label,
      mirror.issue_category_code,
      mirror.issue_category_label,
      mirror.issue_source_type_code,
      mirror.issue_source_type_label,
      mirror.provider_type_code,
      mirror.provider_type_label,
      mirror.gro_type_code,
      mirror.gro_type_label,
      mirror.complainant_action_code,
      mirror.complainant_action_label,
      mirror.resolution_action_code,
      mirror.resolution_action_label,
      mirror.customer_actor_id,
      mirror.source_id,
      mirror.complainant_id,
      mirror.respondent_ids_json,
      mirror.resolver_ids_json,
      mirror.reason_code,
      mirror.reason_name,
      mirror.reason_short_desc,
      mirror.reason_long_desc,
      mirror.last_action_id,
      mirror.last_action_code,
      mirror.last_action_by,
      mirror.last_actor_name,
      mirror.resolutions_count,
      mirror.open_info_request_count,
      mirror.selected_resolution_id,
      mirror.selected_resolution_code,
      mirror.selected_resolution_label,
      opts.country ?? null,
      opts.city ?? null,
      opts.coreVersion ?? null,
      opts.ttl ?? null,
    ];
    if (opts.resolutions) {
      sets.splice(sets.length - 1, 0, 'resolutions_json = ?');
      params.splice(params.length, 0, JSON.stringify(opts.resolutions));
    }
    if (opts.displayStatus) {
      sets.splice(sets.length - 1, 0, 'display_status = ?');
      params.splice(params.length, 0, opts.displayStatus);
    }
    const igmStatus = opts.igmStatusRaw ?? mirror.igm_status_raw;
    if (igmStatus) {
      sets.splice(sets.length - 1, 0, 'igm_status_raw = ?');
      params.splice(params.length, 0, igmStatus);
    }
    params.push(id);
    await ondcExec(`UPDATE ondc_customer_ticket SET ${sets.join(', ')} WHERE id = ?`, params);
  },

  /** Append a chat message to a ticket (by numeric id or ticket_id). */
  async appendMessage(
    ref: { id?: number; ticketId?: string },
    msg: TicketMessage,
    opts: { displayStatus?: string; igmStatusRaw?: string } = {},
  ): Promise<void> {
    const row = ref.id
      ? await this.getById(ref.id)
      : ref.ticketId
        ? await this.findByTicketId(ref.ticketId)
        : null;
    if (!row) return;
    const messages = parseMessages(row);
    messages.push(msg);
    const sets = [
      'actions_json = ?',
      'actions_count = ?',
      'last_action_code = ?',
      'updated_at = NOW()',
    ];
    const params: unknown[] = [JSON.stringify(messages), messages.length, msg.action_code ?? null];
    if (opts.displayStatus) {
      sets.push('display_status = ?');
      params.push(opts.displayStatus);
    }
    if (opts.igmStatusRaw) {
      sets.push('igm_status_raw = ?');
      params.push(opts.igmStatusRaw);
    }
    params.push(row.id);
    await ondcExec(`UPDATE ondc_customer_ticket SET ${sets.join(', ')} WHERE id = ?`, params);
  },

  async setSelectedResolution(id: number, code: string, label?: string): Promise<void> {
    await ondcExec(
      `UPDATE ondc_customer_ticket
       SET selected_resolution_code = ?, selected_resolution_label = ?, updated_at = NOW()
       WHERE id = ?`,
      [code, label ?? code, id],
    );
  },

  async setStatus(id: number, displayStatus: string, igmStatusRaw?: string): Promise<void> {
    await ondcExec(
      `UPDATE ondc_customer_ticket
       SET display_status = ?, igm_status_raw = COALESCE(?, igm_status_raw), updated_at = NOW()
       WHERE id = ?`,
      [displayStatus, igmStatusRaw ?? null, id],
    );
  },
};
