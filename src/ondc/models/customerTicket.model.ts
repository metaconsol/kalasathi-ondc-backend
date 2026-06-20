import { ondcExec, ondcQuery } from '~/lib/ondcSql';

const toMysqlDateTime = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

export interface OndcCustomerTicketRow {
  id: number;
  ticket_id: string;
  txn_id: string;
  order_id: string | null;
  provider_id: string | null;
  seller_id: number | null;
  domain: string;
  issue_level: string | null;
  igm_status_raw: string | null;
  display_status: string;
  priority: string;
  issue_category_code: string | null;
  issue_category_label: string | null;
  customer_actor_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  source_id: string | null;
  complainant_id: string | null;
  respondent_ids_json: string | null;
  bap_id: string | null;
  bap_uri: string | null;
  bpp_id: string | null;
  bpp_uri: string | null;
  country: string | null;
  city: string | null;
  core_version: string | null;
  ttl: string | null;
  reason_code: string | null;
  reason_name: string | null;
  reason_short_desc: string | null;
  reason_long_desc: string | null;
  descriptor_json: string | null;
  descriptor_attachments_json: string | null;
  refs_json: string | null;
  actors_json: string | null;
  actions_json: string | null;
  payload_json: string | null;
  last_action_id: string | null;
  last_action_code: string | null;
  last_action_by: string | null;
  last_actor_name: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const customerTicketModel = {
  async findByTicketId(ticketId: string): Promise<OndcCustomerTicketRow | null> {
    const rows = await ondcQuery<OndcCustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket WHERE ticket_id = ? LIMIT 1`,
      [ticketId],
    );
    return rows[0] ?? null;
  },

  async upsert(data: {
    ticket_id: string;
    txn_id: string;
    order_id?: string | null;
    provider_id?: string | null;
    domain: string;
    issue_level?: string | null;
    igm_status_raw?: string | null;
    display_status?: string | null;
    priority?: string | null;
    issue_category_code?: string | null;
    issue_category_label?: string | null;
    customer_actor_id?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    source_id?: string | null;
    complainant_id?: string | null;
    respondent_ids_json?: string | null;
    bap_id?: string | null;
    bap_uri?: string | null;
    bpp_id?: string | null;
    bpp_uri?: string | null;
    country?: string | null;
    city?: string | null;
    core_version?: string | null;
    ttl?: string | null;
    reason_code?: string | null;
    reason_name?: string | null;
    reason_short_desc?: string | null;
    reason_long_desc?: string | null;
    descriptor_json?: string | null;
    descriptor_attachments_json?: string | null;
    refs_json?: string | null;
    actors_json?: string | null;
    actions_json?: string | null;
    payload_json?: string | null;
    last_action_id?: string | null;
    last_action_code?: string | null;
    last_action_by?: string | null;
    last_actor_name?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }): Promise<void> {
    await ondcExec(
      `INSERT INTO ondc_customer_ticket
      (ticket_id, txn_id, order_id, provider_id, domain, issue_level, igm_status_raw, display_status,
       priority, issue_category_code, issue_category_label, customer_actor_id, customer_name, customer_phone,
       customer_email, source_id, complainant_id, respondent_ids_json, bap_id, bap_uri, bpp_id, bpp_uri,
       country, city, core_version, ttl, reason_code, reason_name, reason_short_desc, reason_long_desc,
       descriptor_json, descriptor_attachments_json, refs_json, actors_json, actions_json, payload_json, last_action_id, last_action_code,
       last_action_by, last_actor_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        txn_id = VALUES(txn_id),
        order_id = VALUES(order_id),
        provider_id = VALUES(provider_id),
        domain = VALUES(domain),
        issue_level = VALUES(issue_level),
        igm_status_raw = VALUES(igm_status_raw),
        display_status = VALUES(display_status),
        priority = VALUES(priority),
        issue_category_code = VALUES(issue_category_code),
        issue_category_label = VALUES(issue_category_label),
        customer_actor_id = VALUES(customer_actor_id),
        customer_name = VALUES(customer_name),
        customer_phone = VALUES(customer_phone),
        customer_email = VALUES(customer_email),
        source_id = VALUES(source_id),
        complainant_id = VALUES(complainant_id),
        respondent_ids_json = VALUES(respondent_ids_json),
        bap_id = VALUES(bap_id),
        bap_uri = VALUES(bap_uri),
        bpp_id = VALUES(bpp_id),
        bpp_uri = VALUES(bpp_uri),
        country = VALUES(country),
        city = VALUES(city),
        core_version = VALUES(core_version),
        ttl = VALUES(ttl),
        reason_code = VALUES(reason_code),
        reason_name = VALUES(reason_name),
        reason_short_desc = VALUES(reason_short_desc),
        reason_long_desc = VALUES(reason_long_desc),
        descriptor_json = VALUES(descriptor_json),
        descriptor_attachments_json = VALUES(descriptor_attachments_json),
        refs_json = VALUES(refs_json),
        actors_json = VALUES(actors_json),
        actions_json = VALUES(actions_json),
        payload_json = VALUES(payload_json),
        last_action_id = VALUES(last_action_id),
        last_action_code = VALUES(last_action_code),
        last_action_by = VALUES(last_action_by),
        last_actor_name = VALUES(last_actor_name),
        created_at = VALUES(created_at),
        updated_at = VALUES(updated_at)`,
      [
        data.ticket_id,
        data.txn_id,
        data.order_id ?? null,
        data.provider_id ?? null,
        data.domain,
        data.issue_level ?? 'ISSUE',
        data.igm_status_raw ?? null,
        data.display_status ?? 'OPEN',
        data.priority ?? 'MEDIUM',
        data.issue_category_code ?? null,
        data.issue_category_label ?? null,
        data.customer_actor_id ?? null,
        data.customer_name ?? null,
        data.customer_phone ?? null,
        data.customer_email ?? null,
        data.source_id ?? null,
        data.complainant_id ?? null,
        data.respondent_ids_json ?? null,
        data.bap_id ?? null,
        data.bap_uri ?? null,
        data.bpp_id ?? null,
        data.bpp_uri ?? null,
        data.country ?? null,
        data.city ?? null,
        data.core_version ?? null,
        data.ttl ?? null,
        data.reason_code ?? null,
        data.reason_name ?? null,
        data.reason_short_desc ?? null,
        data.reason_long_desc ?? null,
        data.descriptor_json ?? null,
        data.descriptor_attachments_json ?? null,
        data.refs_json ?? null,
        data.actors_json ?? null,
        data.actions_json ?? null,
        data.payload_json ?? null,
        data.last_action_id ?? null,
        data.last_action_code ?? null,
        data.last_action_by ?? null,
        data.last_actor_name ?? null,
        toMysqlDateTime(data.created_at),
        toMysqlDateTime(data.updated_at),
      ],
    );
  },

  async listAll(limit = 100, offset = 0): Promise<OndcCustomerTicketRow[]> {
    const rows = await ondcQuery<OndcCustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    return rows;
  },

  async listByProvider(
    providerId: string,
    limit = 100,
    offset = 0,
  ): Promise<OndcCustomerTicketRow[]> {
    const rows = await ondcQuery<OndcCustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket WHERE provider_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [providerId, limit, offset],
    );
    return rows;
  },

  async listByStatus(status: string, limit = 100, offset = 0): Promise<OndcCustomerTicketRow[]> {
    const rows = await ondcQuery<OndcCustomerTicketRow>(
      `SELECT * FROM ondc_customer_ticket WHERE display_status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [status, limit, offset],
    );
    return rows;
  },
};
