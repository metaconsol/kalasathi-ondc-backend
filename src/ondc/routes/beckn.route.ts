/**
 * Beckn Protocol Routes — exposed to ONDC network (BAP → BPP).
 * All requests here must pass ondcAuthMiddleware (signature verification)
 * and ondcContextValidator (payload validation).
 *
 * Base: /api/v1/ondc
 */

import express from 'express';
import { ondcAuthMiddleware } from '~/ondc/middleware/ondcAuth.middleware';
import { ondcContextValidator } from '~/ondc/middleware/ondcValidator.middleware';
import { ondcRequestLogger } from '~/ondc/middleware/ondcLogger.middleware';
import { handleSearch } from '~/ondc/controllers/beckn/search.controller';
import { handleSelect } from '~/ondc/controllers/beckn/select.controller';
import { handleInit } from '~/ondc/controllers/beckn/init.controller';
import { handleConfirm } from '~/ondc/controllers/beckn/confirm.controller';
import { handleStatus } from '~/ondc/controllers/beckn/status.controller';
import { handleTrack } from '~/ondc/controllers/beckn/track.controller';
import { handleCancel } from '~/ondc/controllers/beckn/cancel.controller';
import { handleUpdate } from '~/ondc/controllers/beckn/update.controller';
import { handleRating } from '~/ondc/controllers/beckn/rating.controller';
import { handleIssue, handleIssueStatus } from '~/ondc/controllers/issue.controller';
import { handleCatalogRejection } from '~/ondc/controllers/beckn/catalog-rejection.controller';
import {
  handleOnRecon,
  handleOnReceiverRecon,
  handleRecon,
} from '~/ondc/controllers/ppf.controller';

const router = express.Router();

// All Beckn endpoints: log → verify signature → validate context → handle.
// Auth MUST run before validation: the validator can emit outbound NACK
// callbacks to the request's bap_uri, which for an unauthenticated caller
// would be an SSRF + signed-response oracle to an attacker-chosen URL.
const becknMiddleware = [ondcRequestLogger, ondcAuthMiddleware, ondcContextValidator];

/**
 * @route POST /api/v1/ondc/search
 * @desc Handle buyer search intent
 */
router.post('/search', ...becknMiddleware, handleSearch);

/**
 * @route POST /api/v1/ondc/select
 * @desc Buyer selects items from catalog
 */
router.post('/select', ...becknMiddleware, handleSelect);

/**
 * @route POST /api/v1/ondc/init
 * @desc Buyer initializes order with billing & delivery details
 */
router.post('/init', ...becknMiddleware, handleInit);

/**
 * @route POST /api/v1/ondc/confirm
 * @desc Buyer confirms the order
 */
router.post('/confirm', ...becknMiddleware, handleConfirm);

/**
 * @route POST /api/v1/ondc/status
 * @desc Buyer checks order status
 */
router.post('/status', ...becknMiddleware, handleStatus);

/**
 * @route POST /api/v1/ondc/track
 * @desc Buyer tracks shipment
 */
router.post('/track', ...becknMiddleware, handleTrack);

/**
 * @route POST /api/v1/ondc/cancel
 * @desc Buyer cancels order
 */
router.post('/cancel', ...becknMiddleware, handleCancel);

/**
 * @route POST /api/v1/ondc/update
 * @desc Buyer updates order (partial cancel, return initiation)
 */
router.post('/update', ...becknMiddleware, handleUpdate);

/**
 * @route POST /api/v1/ondc/rating
 * @desc Buyer submits rating for order/item/fulfillment/provider (v1.2.5)
 */
router.post('/rating', ...becknMiddleware, handleRating);

/**
 * @route POST /api/v1/ondc/issue
 * @desc Buyer raises IGM issue
 */
router.post('/issue', ...becknMiddleware, handleIssue);

/**
 * @route POST /api/v1/ondc/issue_status
 * @desc Buyer checks issue status
 */
router.post('/issue_status', ...becknMiddleware, handleIssueStatus);

/**
 * @route POST /api/v1/ondc/catalog_rejection
 * @desc BNP reports catalog ingestion/quality errors (Catalog & Store
 *       Rejection Framework). Skips ondcContextValidator: the body carries a
 *       top-level `errors` array, not a `message` object.
 */
router.post('/catalog_rejection', ondcRequestLogger, ondcAuthMiddleware, handleCatalogRejection);

/**
 * @route POST /api/v1/ondc/recon
 * @desc PPF/RSF reconciliation request (ONDC:NTS10 v2.0.0)
 */
router.post('/recon', ondcRequestLogger, ondcAuthMiddleware, handleRecon);

/**
 * @route POST /api/v1/ondc/on_recon
 * @desc PPF/RSF reconciliation response (ONDC:NTS10 v2.0.0)
 */
router.post('/on_recon', ondcRequestLogger, ondcAuthMiddleware, handleOnRecon);

/**
 * @route POST /api/v1/ondc/on_receiver_recon
 * @desc Legacy PPF callback alias → on_recon
 */
router.post('/on_receiver_recon', ondcRequestLogger, ondcAuthMiddleware, handleOnReceiverRecon);

export default router;
