/**
 * IGM (Issue & Grievance Management) — ondc_issues table.
 * TODO: Implement full IGM v1.0 spec per ONDC guidelines.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export type IssueStatus = 'OPEN' | 'PROCESSING' | 'RESOLVED' | 'CLOSED';
export type IssueCategory = 'ITEM' | 'FULFILLMENT' | 'PAYMENT' | 'AGENT' | 'GRIEVANCE';
export type IssueDisplayStatus =
  | 'OPEN'
  | 'PROCESSING'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED';

export interface OndcIssueRow {
  id: number;
  issue_id: string;
  transaction_id: string;
  order_id: string;
  bap_id: string;
  category: IssueCategory;
  sub_category: string | null;
  short_desc: string;
  long_desc: string | null;
  status: IssueStatus;
  expected_resolution_time: string | null; // ISO datetime
  expected_response_time: string | null;
  resolution_json: string | null;
  actions_json: string; // JSON array of actions taken
  created_at: Date;
  updated_at: Date;
}

export interface OndcIssueAction {
  type:
    | 'created'
    | 'message'
    | 'info_request'
    | 'status'
    | 'resolution_options'
    | 'resolved'
    | 'closed';
  actor: string;
  actor_role: string;
  message?: string | null;
  note?: string | null;
  status?: IssueDisplayStatus | null;
  created_at: string;
}

export const issueModel = {
  async create(data: Omit<OndcIssueRow, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const result = await ondcExec(
      `INSERT INTO ondc_issues
        (issue_id, transaction_id, order_id, bap_id, category, sub_category,
         short_desc, long_desc, status, expected_resolution_time,
         expected_response_time, resolution_json, actions_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.issue_id,
        data.transaction_id,
        data.order_id,
        data.bap_id,
        data.category,
        data.sub_category,
        data.short_desc,
        data.long_desc,
        data.status,
        data.expected_resolution_time,
        data.expected_response_time,
        data.resolution_json,
        data.actions_json,
      ],
    );
    return result.insertId;
  },

  async findByIssueId(issueId: string): Promise<OndcIssueRow | null> {
    const rows = await ondcQuery<OndcIssueRow>(
      `SELECT * FROM ondc_issues WHERE issue_id = ? LIMIT 1`,
      [issueId],
    );
    return rows[0] ?? null;
  },

  async findById(id: number, sellerId?: number): Promise<OndcIssueRow | null> {
    const rows = await ondcQuery<OndcIssueRow>(
      `SELECT i.*
       FROM ondc_issues i
       WHERE i.id = ?
         ${
           sellerId !== undefined
             ? `AND EXISTS (
                SELECT 1
                FROM ondc_orders o
                WHERE o.ondc_order_id = i.order_id
                  AND o.seller_id = ?
              )`
             : ''
         }
       LIMIT 1`,
      sellerId !== undefined ? [id, sellerId] : [id],
    );
    return rows[0] ?? null;
  },

  async createIfMissing(
    data: Omit<OndcIssueRow, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<OndcIssueRow> {
    const existing = await this.findByIssueId(data.issue_id);
    if (existing) return existing;

    await this.create(data);
    const created = await this.findByIssueId(data.issue_id);
    if (!created) {
      throw new Error(`Issue row not found after create: ${data.issue_id}`);
    }
    return created;
  },

  async updateStatus(issueId: string, status: IssueStatus, resolution?: string): Promise<void> {
    const sets = ['status = ?', 'updated_at = NOW()'];
    const params: unknown[] = [status];
    if (resolution) {
      sets.push('resolution_json = ?');
      params.push(resolution);
    }
    params.push(issueId);
    await ondcExec(`UPDATE ondc_issues SET ${sets.join(', ')} WHERE issue_id = ?`, params);
  },

  parseActions(actionsJson: string | null | undefined): OndcIssueAction[] {
    if (!actionsJson || actionsJson.trim() === '') return [];
    try {
      const parsed = JSON.parse(actionsJson);
      return Array.isArray(parsed) ? (parsed as OndcIssueAction[]) : [];
    } catch {
      return [];
    }
  },

  async appendAction(issueId: string, action: OndcIssueAction): Promise<void> {
    const issue = await this.findByIssueId(issueId);
    if (!issue) return;
    const current = this.parseActions(issue.actions_json);
    current.push(action);
    await ondcExec(
      `UPDATE ondc_issues
       SET actions_json = ?, updated_at = NOW()
       WHERE issue_id = ?`,
      [JSON.stringify(current), issueId],
    );
  },

  async list(
    filters: { status?: IssueStatus; sellerId?: number; limit?: number; offset?: number } = {},
  ): Promise<OndcIssueRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      conditions.push('i.status = ?');
      params.push(filters.status);
    }
    if (filters.sellerId) {
      conditions.push(
        'EXISTS (SELECT 1 FROM ondc_orders o WHERE o.ondc_order_id = i.order_id AND o.seller_id = ?)',
      );
      params.push(filters.sellerId);
    }
    const alias = filters.sellerId ? 'ondc_issues i' : 'ondc_issues';
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return ondcQuery<OndcIssueRow>(
      `SELECT ${filters.sellerId ? 'i.*' : '*'} FROM ${alias} ${where} ORDER BY ${filters.sellerId ? 'i.' : ''}created_at DESC LIMIT ? OFFSET ?`,
      [...params, filters.limit ?? 50, filters.offset ?? 0],
    );
  },
};
