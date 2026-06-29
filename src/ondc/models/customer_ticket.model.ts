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
  bap_id: string | null;
  bap_uri: string | null;
  bpp_id: string | null;
  bpp_uri: string | null;
  country: string | null;
  city: string | null;
  core_version: string | null;
  descriptor_attachments_json: string | null;
  actions_json: string | null;
  resolutions_json: string | null;
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
    igm_status_raw?: string | null;
    issue_category_code?: string | null;
    issue_category_label?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    reason_name?: string | null;
    reason_short_desc?: string | null;
    bap_id?: string | null;
    bap_uri?: string | null;
    bpp_id?: string | null;
    bpp_uri?: string | null;
    country?: string | null;
    city?: string | null;
    core_version?: string | null;
    descriptor_attachments_json?: string | null;
    messages: TicketMessage[];
  }): Promise<number> {
    const res = await ondcExec(
      `INSERT INTO ondc_customer_ticket
        (ticket_id, txn_id, order_id, provider_id, seller_id, domain,
         display_status, igm_status_raw, issue_category_code, issue_category_label,
         customer_name, customer_phone, customer_email, reason_name, reason_short_desc,
         bap_id, bap_uri, bpp_id, bpp_uri, country, city, core_version,
         descriptor_attachments_json, actions_json, resolutions_json,
         last_action_code, actions_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?, ?,?, NOW(), NOW())`,
      [
        data.ticket_id,
        data.txn_id,
        data.order_id ?? null,
        data.provider_id ?? null,
        data.seller_id ?? null,
        data.domain ?? 'ONDC:RET12',
        data.display_status ?? 'OPEN',
        data.igm_status_raw ?? null,
        data.issue_category_code ?? null,
        data.issue_category_label ?? null,
        data.customer_name ?? null,
        data.customer_phone ?? null,
        data.customer_email ?? null,
        data.reason_name ?? null,
        data.reason_short_desc ?? null,
        data.bap_id ?? null,
        data.bap_uri ?? null,
        data.bpp_id ?? null,
        data.bpp_uri ?? null,
        data.country ?? null,
        data.city ?? null,
        data.core_version ?? null,
        data.descriptor_attachments_json ?? null,
        JSON.stringify(data.messages ?? []),
        '[]',
        data.messages.at(-1)?.action_code ?? null,
        data.messages.length,
      ],
    );
    return res.insertId;
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
