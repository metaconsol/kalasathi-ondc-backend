/**
 * ONDC provider — derived live from `stores` (no separate ondc_providers table).
 *
 * Convention: provider_id = String(stores.id). The PHP reference does the same:
 * every active store becomes a BPP provider in /on_search and downstream flows.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export interface OndcProviderRow {
  id: number;
  provider_id: string;
  seller_id: number;
  store_id: number;
  name: string;
  short_desc: string | null;
  long_desc: string | null;
  logo_url: string | null;
  fssai_license: string | null;
  support_phone: string | null;
  support_email: string | null;
  domain: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const STORE_SELECT = `
  s.id                                   AS id,
  CAST(s.id AS CHAR)                     AS provider_id,
  s.seller_user_id                       AS seller_id,
  s.id                                   AS store_id,
  s.store_name                           AS name,
  SUBSTRING(COALESCE(s.description, ''), 1, 200) AS short_desc,
  s.description                          AS long_desc,
  NULL                                   AS logo_url,
  NULL                                   AS fssai_license,
  s.support_phone                        AS support_phone,
  s.support_email                        AS support_email,
  'ONDC:RET12'                           AS domain,
  s.is_active                            AS is_active,
  s.created_at                           AS created_at,
  s.updated_at                           AS updated_at`;

function mapRow(r: any): OndcProviderRow {
  return {
    id: Number(r.id),
    provider_id: String(r.provider_id),
    seller_id: Number(r.seller_id),
    store_id: Number(r.store_id),
    name: r.name,
    short_desc: r.short_desc ?? null,
    long_desc: r.long_desc ?? null,
    logo_url: r.logo_url ?? null,
    fssai_license: r.fssai_license ?? null,
    support_phone: r.support_phone ?? null,
    support_email: r.support_email ?? null,
    domain: r.domain ?? 'ONDC:RET12',
    is_active: Boolean(r.is_active),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const providerModel = {
  async findById(providerId: string): Promise<OndcProviderRow | null> {
    const storeId = parseInt(providerId, 10);
    if (!Number.isFinite(storeId)) return null;
    const rows = await ondcQuery<any>(
      `SELECT ${STORE_SELECT} FROM stores s WHERE s.id = ? LIMIT 1`,
      [storeId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findBySellerId(sellerId: number): Promise<OndcProviderRow | null> {
    const rows = await ondcQuery<any>(
      `SELECT ${STORE_SELECT} FROM stores s
       WHERE s.seller_user_id = ?
       ORDER BY s.is_active DESC, s.id ASC
       LIMIT 1`,
      [sellerId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /** Every store — active and inactive — so admin can toggle them. */
  async listAll(): Promise<OndcProviderRow[]> {
    const rows = await ondcQuery<any>(
      `SELECT ${STORE_SELECT} FROM stores s ORDER BY s.is_active DESC, s.store_name ASC`,
    );
    return rows.map(mapRow);
  },

  /** Activate/deactivate the underlying store. */
  async setActive(providerId: string, active: boolean): Promise<void> {
    const storeId = parseInt(providerId, 10);
    if (!Number.isFinite(storeId)) return;
    await ondcExec(`UPDATE stores SET is_active = ?, updated_at = NOW() WHERE id = ?`, [
      active ? 1 : 0,
      storeId,
    ]);
  },
};
