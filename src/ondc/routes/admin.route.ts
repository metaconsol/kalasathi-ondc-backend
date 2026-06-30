/**
 * ONDC Admin API Routes — protected by existing admin middleware.
 * Base: /api/v1/ondc/admin
 */

import express from 'express';
import { authMiddleware } from '~/middleware/auth.middleware';
import { isAdmin, isAdminOrSeller } from '~/middleware/admin.middleware';
import { listCatalogItems, debugCatalog } from '~/ondc/controllers/admin/catalog.controller';
import {
  listOrders,
  getOrder,
  updateFulfillment,
} from '~/ondc/controllers/admin/orders.controller';
import {
  listProviders,
  getProvider,
  toggleProvider,
} from '~/ondc/controllers/admin/providers.controller';
import {
  listLogs,
  getLogsByTransaction,
  deleteLogs,
} from '~/ondc/controllers/admin/logs.controller';
import {
  listTransactions,
  deleteTransactions,
} from '~/ondc/controllers/admin/transactions.controller';
import {
  getActionCounts,
  listByAction,
  getTimeline,
  listBuyerApps,
} from '~/ondc/controllers/admin/request_monitor.controller';
import { listOndcIssues } from '~/ondc/controllers/admin/issues.controller';
import { getDashboardStats } from '~/ondc/controllers/admin/stats.controller';
import {
  listPpfRecon,
  getPpfReconByOrder,
  triggerPpfRecon,
} from '~/ondc/controllers/ppf.controller';
import { getRatings, getOrderRatings } from '~/ondc/controllers/admin/ratings.controller';

const router = express.Router();

const adminGuard = [authMiddleware, isAdmin];
const sellerGuard = [authMiddleware, isAdminOrSeller];

// ---- Dashboard (aggregate stats; role-scoped for sellers) ----
router.get('/dashboard/stats', ...sellerGuard, getDashboardStats);

// ---- Catalog (read-only, built live from ondc_odop_db) ----
router.get('/catalog/debug', ...adminGuard, debugCatalog);
router.get('/catalog/items{/:providerId}', ...sellerGuard, listCatalogItems);

// ---- Orders ----
router.get('/orders', ...sellerGuard, listOrders);
router.get('/orders/:orderId', ...sellerGuard, getOrder);
router.post('/orders/:orderId/fulfillment', ...sellerGuard, updateFulfillment);

// ---- Providers (read-only view of stores; provider_id = String(stores.id)) ----
router.get('/providers', ...adminGuard, listProviders);
router.get('/providers/:providerId', ...adminGuard, getProvider);
router.patch('/providers/:providerId/toggle', ...adminGuard, toggleProvider);

// ---- PPF (Payment Protection Framework) ----
router.get('/ppf', ...sellerGuard, listPpfRecon);
router.get('/ppf/order/:orderId', ...sellerGuard, getPpfReconByOrder);
router.post('/ppf/trigger', ...sellerGuard, triggerPpfRecon);

// ---- Logs ----
router.get('/logs', ...adminGuard, listLogs);
router.delete('/logs', ...adminGuard, deleteLogs);
router.get('/logs/:transactionId', ...adminGuard, getLogsByTransaction);

// ---- Transactions (funnel from overall_txns) ----
router.get('/transactions', ...adminGuard, listTransactions);
router.delete('/transactions', ...adminGuard, deleteTransactions);

// ---- Request Monitor (per-action view of ondc_txn_logs) ----
router.get('/request-monitor/counts', ...adminGuard, getActionCounts);
router.get('/request-monitor', ...adminGuard, listByAction);
router.get('/request-monitor/:transactionId', ...adminGuard, getTimeline);

// ---- Buyer Apps (distinct bap_ids that have made requests) ----
router.get('/buyer-apps', ...adminGuard, listBuyerApps);

// ---- IGM ----
router.get('/issues', ...sellerGuard, listOndcIssues);

// ---- Ratings ----
router.get('/ratings', ...sellerGuard, getRatings);
router.get('/ratings/:orderId', ...sellerGuard, getOrderRatings);

export default router;
