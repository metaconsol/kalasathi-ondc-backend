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
  checkPincode,
  bookShipment,
  trackShipment,
  cancelShipment,
  packingSlip,
  createPickup,
} from '~/ondc/controllers/admin/logistics.controller';
import {
  listProviders,
  getProvider,
  toggleProvider,
} from '~/ondc/controllers/admin/providers.controller';
import { listBapTerms } from '~/ondc/controllers/admin/bap_terms.controller';
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
import {
  listOndcIssues,
  getOndcIssue,
  addOndcIssueMessage,
  updateOndcIssueStatus,
  resolveOndcIssue,
  closeOndcIssue,
} from '~/ondc/controllers/admin/issues.controller';
import { getDashboardStats } from '~/ondc/controllers/admin/stats.controller';
import { getSettings } from '~/ondc/controllers/admin/settings.controller';
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

// ---- BPP settings (read-only non-secret ONDC config from env) ----
router.get('/settings', ...adminGuard, getSettings);

// ---- Catalog (read-only, built live from ondc_odop_db) ----
router.get('/catalog/debug', ...adminGuard, debugCatalog);
router.get('/catalog/items{/:providerId}', ...sellerGuard, listCatalogItems);

// ---- Orders ----
router.get('/orders', ...sellerGuard, listOrders);
// Literal segment registered before /orders/:orderId so it can't be captured.
router.get('/orders/logistics/delhivery/serviceability/:pincode', ...sellerGuard, checkPincode);
router.get('/orders/:orderId', ...sellerGuard, getOrder);
router.post('/orders/:orderId/fulfillment', ...sellerGuard, updateFulfillment);

// ---- Delhivery logistics for ONDC orders (mirrors odop_backend seller flow) ----
router.post('/orders/:orderId/delhivery/book', ...sellerGuard, bookShipment);
router.get('/orders/:orderId/delhivery/track', ...sellerGuard, trackShipment);
router.post('/orders/:orderId/delhivery/cancel', ...sellerGuard, cancelShipment);
router.get('/orders/:orderId/delhivery/packing-slip', ...sellerGuard, packingSlip);
router.post('/orders/:orderId/delhivery/pickup', ...sellerGuard, createPickup);

// ---- Providers (read-only view of stores; provider_id = String(stores.id)) ----
router.get('/providers', ...adminGuard, listProviders);
router.get('/providers/:providerId', ...adminGuard, getProvider);
router.patch('/providers/:providerId/toggle', ...adminGuard, toggleProvider);
router.get('/bap-terms', ...adminGuard, listBapTerms);

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

// ---- IGM (tickets) ----
router.get('/issues', ...sellerGuard, listOndcIssues);
router.get('/issues/:id', ...sellerGuard, getOndcIssue);
router.post('/issues/:id/message', ...sellerGuard, addOndcIssueMessage);
router.patch('/issues/:id/status', ...sellerGuard, updateOndcIssueStatus);
router.patch('/issues/:id/resolve', ...sellerGuard, resolveOndcIssue);
router.patch('/issues/:id/close', ...sellerGuard, closeOndcIssue);

// ---- Ratings ----
router.get('/ratings', ...sellerGuard, getRatings);
router.get('/ratings/:orderId', ...sellerGuard, getOrderRatings);

export default router;
