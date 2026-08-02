/**
 * Admin Dashboard Stats Controller — aggregate counts for the ONDC dashboard.
 *
 * GET /api/v1/ondc/admin/dashboard/stats
 *   Returns a single OndcDashboardStats object the dashboard renders as stat cards.
 *
 * Role scoping (mirrors orders/issues list controllers):
 *   ADMIN / SUPER_ADMIN → network-wide counts.
 *   SELLER              → scoped to the seller's own orders / stores / items.
 *
 * Order status enum (ondc_orders.status):
 *   CREATED | CONFIRMED | PACKED | AGENT_ASSIGNED | ORDER_PICKED_UP
 *   | OUT_FOR_DELIVERY | DELIVERED | RETURNED | CANCELLED
 * "pending" = everything not yet in a terminal state (not DELIVERED/CANCELLED/RETURNED).
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcQuery } from '~/lib/ondcSql';

interface OndcDashboardStats {
  totalOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  totalRevenue: string;
  activeProviders: number;
  syncedItems: number;
  openTickets: number;
  totalTransactions: number;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

// A store reaches ONDC only when every gate passes: ecom-active, seller
// Super Admin-approved, ONDC toggle on (no row = on), and holding a product.
// Must stay in sync with getActiveStores() in seller.adapter.ts.
const HAS_PRODUCTS = `EXISTS (
  SELECT 1 FROM products p 
  JOIN product_verification pv ON pv.product_id = p.id AND pv.approval_status = 'approved'
  WHERE p.store_id = s.id AND p.publish_status = 'publish'
)`;
const LIVE_STORE_IDS = `
  SELECT s.id
  FROM stores s
  JOIN seller_profiles sp ON sp.user_id = s.seller_user_id AND sp.approval_status = 'APPROVED'
  LEFT JOIN ondc_provider_settings ops ON ops.store_id = s.id
  WHERE s.is_active = 1 AND COALESCE(ops.is_active, 0) = 1 AND ${HAS_PRODUCTS}`;

/** GET /api/v1/ondc/admin/dashboard/stats */
export async function getDashboardStats(req: Request, res: Response): Promise<void> {
  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? req.user?.id : undefined;

  // A seller's store ids double as their ONDC provider ids (provider_id = String(stores.id)).
  // Needed to scope transactions, providers and catalog items to that seller.
  let providerIds: string[] = [];
  if (sellerId !== undefined) {
    const storeRows = await ondcQuery<{ id: number }>(
      `SELECT id FROM stores WHERE seller_user_id = ?`,
      [sellerId],
    );
    providerIds = storeRows.map((r) => String(r.id));
  }

  // ---- Orders: total / status breakdown / revenue in one aggregate ----
  const orderWhere = sellerId !== undefined ? 'WHERE seller_id = ?' : '';
  const orderParams = sellerId !== undefined ? [sellerId] : [];
  const orderRows = await ondcQuery<{
    total: number;
    delivered: number;
    cancelled: number;
    pending: number;
    revenue: string | null;
  }>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS delivered,
       COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled,
       COALESCE(SUM(CASE WHEN status NOT IN ('DELIVERED','CANCELLED','RETURNED') THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN order_total ELSE 0 END), 0) AS revenue
     FROM ondc_orders ${orderWhere}`,
    orderParams,
  );
  const orderAgg = orderRows[0];

  // ---- Providers live on ONDC (scoped to the seller's own stores) ----
  // NOT `stores.is_active` alone: that is the ecom site's own switch, it is set
  // on every store, so counting it reported the entire store table as active
  // providers no matter their ONDC eligibility.
  const providerWhere = sellerId !== undefined ? 'AND s.seller_user_id = ?' : '';
  const providerParams = sellerId !== undefined ? [sellerId] : [];
  const providerRows = await ondcQuery<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM (${LIVE_STORE_IDS} ${providerWhere}) live`,
    providerParams,
  );

  // ---- Open tickets (OPEN + PROCESSING = not yet resolved/closed) ----
  // Seller scoping mirrors issueModel.list: tickets whose order belongs to the seller.
  const ticketSellerClause =
    sellerId !== undefined
      ? `AND EXISTS (SELECT 1 FROM ondc_orders o
                     WHERE o.ondc_order_id = ondc_issues.order_id AND o.seller_id = ?)`
      : '';
  const ticketParams = sellerId !== undefined ? [sellerId] : [];
  const ticketRows = await ondcQuery<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ondc_issues
     WHERE status IN ('OPEN','PROCESSING') ${ticketSellerClause}`,
    ticketParams,
  );

  // ---- Total transactions (overall_txns funnel; archived excluded) ----
  let totalTransactions = 0;
  if (sellerId === undefined) {
    const txnRows = await ondcQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM overall_txns WHERE is_archived = 0`,
    );
    totalTransactions = num(txnRows[0]?.cnt);
  } else if (providerIds.length) {
    const placeholders = providerIds.map(() => '?').join(',');
    const txnRows = await ondcQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM overall_txns
       WHERE is_archived = 0 AND provider_id IN (${placeholders})`,
      providerIds,
    );
    totalTransactions = num(txnRows[0]?.cnt);
  }

  // ---- Synced catalog items ----
  // Counted in SQL rather than by building the catalog payload: the old version
  // built ONLY the RET12 catalog, so every RET10 and RET16 item was missing, and
  // building each domain's payload per dashboard load does not scale past a
  // handful of providers. One row per leaf variant, or one per product when it
  // has none — the same expansion fetchOndcCatalogRows performs.
  const itemWhere = sellerId !== undefined ? 'AND s.seller_user_id = ?' : '';
  const itemParams = sellerId !== undefined ? [sellerId] : [];
  const itemRows = await ondcQuery<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM products p
     JOIN product_verification pv ON pv.product_id = p.id AND pv.approval_status = 'approved'
     LEFT JOIN product_variants v
       ON v.product_id = p.id
      AND NOT EXISTS (SELECT 1 FROM product_variants c WHERE c.parent_variant_id = v.id)
     WHERE p.publish_status = 'publish'
       AND p.store_id IN (${LIVE_STORE_IDS} ${itemWhere})`,
    itemParams,
  );
  const syncedItems = num(itemRows[0]?.cnt);

  const stats: OndcDashboardStats = {
    totalOrders: num(orderAgg?.total),
    pendingOrders: num(orderAgg?.pending),
    deliveredOrders: num(orderAgg?.delivered),
    cancelledOrders: num(orderAgg?.cancelled),
    totalRevenue: num(orderAgg?.revenue).toFixed(2),
    activeProviders: num(providerRows[0]?.cnt),
    syncedItems,
    openTickets: num(ticketRows[0]?.cnt),
    totalTransactions,
  };

  ApiResponse.success(res, 'ONDC dashboard stats', stats);
}
