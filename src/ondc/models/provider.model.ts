/**
 * ONDC provider — derived live from `stores` (no separate ondc_providers table).
 *
 * Convention: provider_id = String(stores.id). The PHP reference does the same:
 * every active store becomes a BPP provider in /on_search and downstream flows.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import { parseStoreOndcDomains, type OndcRetailDomain } from '~/ondc/config/domain.config';

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
  domains: OndcRetailDomain[];
  /** ONDC-only toggle (ondc_provider_settings) — independent of the ecom site's own on/off switch. */
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
  s.ondc_domain                          AS ondc_domain_raw,
  COALESCE(ops.is_active, 1)             AS is_active,
  s.created_at                           AS created_at,
  s.updated_at                           AS updated_at`;

// Used by findById/findBySellerId only — deliberately lenient. These back the
// live /confirm order flow (see confirm.controller.ts), which must keep
// resolving an already-placed order's provider even if the seller's approval
// or product catalog changes afterward. ondc_provider_settings has no row for
// stores never explicitly toggled — absent means active (default).
const STORE_JOIN = `
  FROM stores s
  LEFT JOIN ondc_provider_settings ops ON ops.store_id = s.id`;

// Used by the admin listing only (listAll/listPaginated/countAll) — a store
// only shows here once its seller is Super Admin-approved; sellers pending
// approval never appear at all. Having a product is NOT a hard exclusion here
// (unlike getActiveStores, the real /on_search gate) — approved sellers with
// zero products still show, filterable via hasProducts, so admins can see
// them and follow up. is_active on this row is still the ONDC-only toggle.
const LISTING_JOIN = `
  FROM stores s
  JOIN seller_profiles sp ON sp.user_id = s.seller_user_id AND sp.approval_status = 'APPROVED'
  LEFT JOIN ondc_provider_settings ops ON ops.store_id = s.id`;

const HAS_PRODUCTS_EXISTS = 'EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id)';

interface ProviderFilterOpts {
  q?: string | undefined;
  /** ONDC-only toggle state (ondc_provider_settings), not the ecom stores.is_active. */
  status?: 'active' | 'inactive' | undefined;
  hasProducts?: 'yes' | 'no' | undefined;
}

function buildFilters(opts?: ProviderFilterOpts): { clause: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  const term = opts?.q?.trim();
  if (term) {
    conditions.push('s.store_name LIKE ?');
    params.push(`%${term}%`);
  }

  if (opts?.status === 'active') {
    conditions.push('COALESCE(ops.is_active, 1) = 1');
  } else if (opts?.status === 'inactive') {
    conditions.push('COALESCE(ops.is_active, 1) = 0');
  }

  if (opts?.hasProducts === 'yes') {
    conditions.push(HAS_PRODUCTS_EXISTS);
  } else if (opts?.hasProducts === 'no') {
    conditions.push(`NOT ${HAS_PRODUCTS_EXISTS}`);
  }

  return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/** Conditions for the has-products breakdown. Excludes hasProducts (so the
 *  counts are never narrowed by the very filter they describe) and status (so
 *  they stay a stable fact about the approved seller base while the admin
 *  flips between Active/Inactive). A search term still applies. */
function buildBreakdownFilters(opts?: ProviderFilterOpts): {
  clause: string;
  params: string[];
} {
  const { hasProducts: _hasProducts, status: _status, ...rest } = opts ?? {};
  return buildFilters(rest);
}

function mapRow(r: any): OndcProviderRow {
  const domains = parseStoreOndcDomains(r.ondc_domain_raw);
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
    domains,
    domain: domains[0] ?? 'ONDC:RET12',
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
      `SELECT ${STORE_SELECT} ${STORE_JOIN} WHERE s.id = ? LIMIT 1`,
      [storeId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findBySellerId(sellerId: number): Promise<OndcProviderRow | null> {
    const rows = await ondcQuery<any>(
      `SELECT ${STORE_SELECT} ${STORE_JOIN}
       WHERE s.seller_user_id = ?
       ORDER BY COALESCE(ops.is_active, 1) DESC, s.id ASC
       LIMIT 1`,
      [sellerId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /** Every APPROVED store — active and inactive, with or without products — so admin can manage them. */
  async listAll(): Promise<OndcProviderRow[]> {
    const rows = await ondcQuery<any>(
      `SELECT ${STORE_SELECT} ${LISTING_JOIN} ORDER BY s.store_name ASC`,
    );
    return rows.map(mapRow);
  },

  async countAll(opts?: ProviderFilterOpts): Promise<number> {
    const { clause, params } = buildFilters(opts);
    const rows = await ondcQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt ${LISTING_JOIN} ${clause}`,
      params,
    );
    return Number(rows[0]?.cnt ?? 0);
  },

  /** Has-products split across the whole approved seller base — independent of
   *  the active/inactive toggle, so it reads as information, not a filter echo. */
  async getProductBreakdown(
    opts?: ProviderFilterOpts,
  ): Promise<{ withProducts: number; withoutProducts: number }> {
    const { clause, params } = buildBreakdownFilters(opts);
    const rows = await ondcQuery<{ withProducts: number; withoutProducts: number }>(
      `SELECT
         SUM(CASE WHEN ${HAS_PRODUCTS_EXISTS} THEN 1 ELSE 0 END) AS withProducts,
         SUM(CASE WHEN NOT ${HAS_PRODUCTS_EXISTS} THEN 1 ELSE 0 END) AS withoutProducts
       ${LISTING_JOIN} ${clause}`,
      params,
    );
    return {
      withProducts: Number(rows[0]?.withProducts) || 0,
      withoutProducts: Number(rows[0]?.withoutProducts) || 0,
    };
  },

  /** Every provider_id matching the given filters, unpaginated — for "select all matching" bulk actions. */
  async listAllIds(opts?: ProviderFilterOpts): Promise<string[]> {
    const { clause, params } = buildFilters(opts);
    const rows = await ondcQuery<{ provider_id: string }>(
      `SELECT CAST(s.id AS CHAR) AS provider_id ${LISTING_JOIN} ${clause} ORDER BY s.id ASC`,
      params,
    );
    return rows.map((r) => String(r.provider_id));
  },

  async listPaginated(
    opts: ProviderFilterOpts & { limit: number; offset: number },
  ): Promise<OndcProviderRow[]> {
    const { clause, params } = buildFilters(opts);
    const rows = await ondcQuery<any>(
      `SELECT ${STORE_SELECT} ${LISTING_JOIN} ${clause}
       ORDER BY COALESCE(ops.is_active, 1) DESC, s.store_name ASC
       LIMIT ? OFFSET ?`,
      [...params, opts.limit, opts.offset],
    );
    return rows.map(mapRow);
  },

  /** ONDC-only toggle — never touches the ecom-owned `stores` table. */
  async setActive(providerId: string, active: boolean): Promise<void> {
    const storeId = parseInt(providerId, 10);
    if (!Number.isFinite(storeId)) return;
    await ondcExec(
      `INSERT INTO ondc_provider_settings (store_id, is_active) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), updated_at = NOW()`,
      [storeId, active ? 1 : 0],
    );
  },

  /** Same as setActive, for many providers in one statement. */
  async setActiveBulk(providerIds: string[], active: boolean): Promise<number> {
    const storeIds = providerIds.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id));
    if (storeIds.length === 0) return 0;

    const values = storeIds.map(() => '(?, ?)').join(', ');
    const params = storeIds.flatMap((id) => [id, active ? 1 : 0]);
    await ondcExec(
      `INSERT INTO ondc_provider_settings (store_id, is_active) VALUES ${values}
       ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), updated_at = NOW()`,
      params,
    );
    return storeIds.length;
  },
};
