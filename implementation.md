### Branch 034

**Date:** 2026-07-06

**Status:** Completed — backend tsc clean, `npm run build` OK. Pending deploy to preprod + Pramaan Flow 10B re-run.

**Area:** ONDC PPF / RSF 2.0 (Flow 10A/10B) — Pramaan `on_recon` validation, auth, logging, settlement schema

**What:**

Fixed Pramaan reconciliation failures where `on_recon` report showed `context` as undefined, `recon`/`on_recon` did not appear in admin transaction logs, and Flow 10A returned `"orders[0].settlements[0].counterparty_id" is not allowed`:

1. **NTS10 sync ACK/NACK:** `/recon` and `/on_recon` sync responses now use `buildNtsAck()` / `buildNtsNack()` with `location` + `version` instead of retail `buildAck()` (`country`/`city`/`core_version`).
2. **`on_recon` payload:** `buildOnReconMessage()` sends schema-minimal orders (`id`, `amount`, `recon_accord`, `settlements`) with full NTS10 `context`; strips `counterparty_id` from settlements (valid on `recon`, not on `on_recon`).
3. **Auth for NTS10:** `ondcAuth.middleware` reads city from `context.location.city.code` for registry lookup; returns NTS-shaped NACK on auth errors for `ONDC:NTS10` requests without changing retail success path.
4. **Logging:** `ondcLogger.middleware` extracts `domain`, `action`, `bpp_id` correctly for NTS10 inbound requests; outbound `recon`/`on_recon` logged in `ppf.service.ts`.
5. **Registry retry:** `registry.service` retries public-key lookup with `domain: '*'` when first lookup fails (Pramaan/collector keys).
6. **Trigger guard:** `POST /admin/ppf/trigger` returns 404 when order not found instead of fake success.

**Why:**

- Pramaan Flow 10B sends inbound `/recon` (NTS10); BPP must ACK in NTS shape and auto-reply `/on_recon` with valid `context` — report failed with all `context.*` tests undefined because payload was wrong or never sent.
- Old `ppf.controller` used retail `buildAck()` for `/recon` ACK; Pramaan accepted sync ACK but `on_recon` validation failed.
- `ondcAuth` used `context.city` only — missing on NTS10 — causing registry lookup/signature failures before `handleInboundRecon` ran (no logs, no `on_recon`).
- `counterparty_id` is allowed in `recon` request settlements but Pramaan rejects it in `on_recon` response settlements.
- Settlement reconcile could return empty array; fallback to order settlements ensures `on_recon` always has settlement rows.

**Changes:** file name and description of file change:

- `src/ondc/utils/ppf.builder.ts`
  Added `buildNtsAck()`, `buildNtsNack()`, `isNts10Context()`. City default `*` (not `std:080`). `buildOnReconMessage()` emits minimal order + full NTS context. Added `formatSettlementForOnRecon()` to strip `counterparty_id`, `_unknown`, empty `type` from `on_recon` settlements.

- `src/ondc/controllers/ppf.controller.ts`
  Replaced retail `buildAck()` + `ntsAckContext` helper with `buildNtsAck()`. Removed duplicate inbound `txnLogModel.insert` (middleware is single source for inbound logs). Trigger returns 404 when `sendRecon()` finds no order.

- `src/ondc/services/ppf.service.ts`
  `ntsContextFromBody` city default `*`. Settlement fallback when reconcile returns empty. Logs `PPF posting on_recon` before callback. Outbound `on_recon`/`recon` rows written to `ondc_txn_logs`.

- `src/ondc/middleware/ondcAuth.middleware.ts`
  Added `registryCityFromCtx()` (retail `context.city` or NTS `location.city.code`). Added `respondNack()` — NTS10 requests get `buildNtsNack()`, retail unchanged. Retail search/select/init/confirm success path unchanged.

- `src/ondc/middleware/ondcLogger.middleware.ts`
  Added `extractInboundLogFields()` for NTS10 + retail; logs `domain`, `action`, `bpp_id` from request and ACK response so inbound `recon`/`on_recon` appear in admin Logs with `ONDC:NTS10`.

- `src/ondc/services/registry.service.ts`
  Retry registry lookup with `domain: '*'` when first lookup returns no signing key.

**Verification:**

- Local `POST /recon?insecure=1` returns NTS10 ACK with `location` + `version`.
- `on_recon` payload includes `context.domain`, `context.bap_id`, `context.bpp_uri`, `message.orders[]` without `counterparty_id`.
- Admin Logs: inbound `recon` + outbound `on_recon` for same `transaction_id` (on server Pramaan actually hits).
- Pramaan Flow 10B Receiver: complete retail order first, then Start 10B; Generate Report should pass context verification.

**Note:** Logs appear only on the DB/server matching the Pramaan subscriber (e.g. `preprod.odopmartmp.com` vs `test.odopmartmp.com`). Use exact transaction ID from Flow 10B panel. Flow 10A (Collector) uses admin trigger; Flow 10B (Receiver) is automatic inbound recon.

### Branch 032

**Date:** 2026-07-04

**Status:** Completed

**Area:** ONDC PPF (ONDC:NTS10 v2.0.0 — `recon` and `on_recon`)

**What:**

Implemented the full bidirectional PPF reconciliation flow using only the two NTS10 APIs (`recon` and `on_recon`):

1. **Outbound (BPP → BAP):** Admin trigger builds a signed NTS10 `recon` payload from a persisted order and POSTs it to `{bap_uri}/recon`; inbound `on_recon` updates `recon_accord` in `ondc_ppf_recon`.
2. **Inbound (BAP → BPP):** Pramaan/mock buyer `POST /recon` is ACKed synchronously, settlements are compared, and the BPP auto-replies with signed `on_recon` (`ACCORD` or `DISPUTE`).
3. **Schema compliance:** Recon payloads now include required `orders[].amount` and omit empty `settlements[].type` so ONDC Workbench validation passes.
4. **DB resilience:** Fixed invalid `INBOUND_RECEIVED` status enum; added legacy INSERT fallback when extended PPF columns are not yet migrated.
5. **Admin + Postman:** JWT admin APIs (`GET /ppf`, `GET /ppf/order/:id`, `POST /ppf/trigger`) and Beckn collection requests for local/preprod testing.

**Why:**

- ONDC settlement (PPF/RSF 2.0) runs on domain `ONDC:NTS10`, separate from retail (`RET10`/`RET12`/`RET16`), and links to orders by `ondc_order_id`.
- Pramaan NTS testcase sends inbound `/recon` to the BPP; the BPP must ACK and respond with `/on_recon` without UI involvement.
- Inbound recon was failing with `Data truncated for column 'status'` because `INBOUND_RECEIVED` was not in the DB ENUM.
- Workbench schema validation failed on missing `message.orders[].amount` and empty `settlements[].type`.
- Admin/operators need a manual trigger path and visibility into recon history without relying only on Pramaan.

**Changes:** file name and description of file change:

- `src/ondc/services/ppf.service.ts`
  Core PPF service: `sendRecon()` (outbound), `handleInboundRecon()` (compare settlements + post `on_recon`), `processOnRecon()` (persist BAP reply). Logs all steps to `ondc_transaction_logs`.

- `src/ondc/controllers/ppf.controller.ts`
  Beckn handlers for `POST /recon`, `POST /on_recon`, `POST /on_receiver_recon` (legacy alias). Admin list/detail APIs and `POST /ppf/trigger`; trigger accepts both `ondc_order_id` and `order_id`.

- `src/ondc/utils/ppf.builder.ts`
  NTS10 v2.0.0 payload builders: context, quote, settlements, `buildReconOrderPayload`, `reconcileSettlements`, `buildOnReconMessage`. Added order-level `amount`, removed empty settlement `type`, settlement total matches sum of settlement amounts.

- `src/ondc/models/ppf.model.ts`
  Extended `ondc_ppf_recon` INSERT/UPDATE for `order_status`, `quote_json`, `direction`, `inbound_recon_payload`, `outbound_on_recon_payload`. Legacy fallback INSERT when migration columns missing.

- `src/ondc/routes/beckn.route.ts`
  Mounted `POST /recon`, `POST /on_recon`, `POST /on_receiver_recon` with ONDC auth middleware.

- `src/ondc/routes/admin.route.ts`
  Mounted `GET /ppf`, `GET /ppf/order/:orderId`, `POST /ppf/trigger` under admin guard.

- `src/app.ts`
  Short-path aliases for `recon`, `on_recon`, `on_receiver_recon`, and `/ppf/*` → `/api/v1/ondc/admin/ppf/*` for Postman/admin UI.

- `src/ondc/db/migrations/001_setup_ondc.sql`
  Step 3: idempotent `ALTER TABLE` for PPF extended columns on `ondc_ppf_recon`.

- `ONDC_v1.2.5_Workbench.postman_collection.json`
  Added login, `POST /recon`, `POST /on_recon`, admin PPF endpoints; schema-compliant example bodies; Postman UUID ids on all requests; fixed trigger body to use `ondc_order_id`.

**Verification:**

- Local inbound `POST /recon?insecure=1` ACKs and async-sends `on_recon` without DB status truncation error.
- `POST /admin/ppf/trigger` returns `ppf_recon_id` when order exists.
- `GET /admin/ppf/order/:orderId` returns parsed `quote`, `settlements`, `inbound_recon`, `on_recon_sent`.
- ONDC Workbench schema validation passes after `amount` and `type` fixes.
- Pramaan ring: inbound recon works without UI; optional manual trigger via admin/Postman for outbound direction.

**Note:** Seller bank details (`seller_profiles.bank_account_no`, `bank_ifsc`, `upi_id`, `business_name`) are required at `on_init`/`on_confirm` for payout, not in the NTS10 recon payload. No new PPF admin UI page required for Pramaan — existing Logs / PPF Settlements pages are sufficient for monitoring.

### Branch 031

**Date:** 2026-07-03

**Status:** Completed

**Area:** ONDC Catalog Schema Validation (Manufacturing Month and Item Rating)

**What:**

Fixed two ONDC catalog item schema validation issues in the catalog payload:

1. `@ondc/org/statutory_reqs_packaged_commodities.month_year_of_manufacture_packing_import` was being emitted in `YYYY-MM` format and is now normalized to `MM/YYYY`.
2. `items[].rating` was being emitted as an empty string and is now always populated with a valid ONDC-safe rating, using stored item ratings when available.

**Why:**

ONDC Workbench schema validation was failing for two reasons:

1. `month_year_of_manufacture_packing_import` must match the ONDC validator format (`MM/YYYY` or `NA`), but the code fallback was generating values like `2026-07`.
2. `items[].rating` must be present and must be one of `"1"`, `"2"`, `"3"`, `"4"`, or `"5"`, but the payload was sending an empty value.

**Changes:** file name and description of file change:

- `src/ondc/adapters/product.adapter.ts`
  Added manufacturing month normalization so direct DB values, ONDC attribute fallback values, and generated fallback values are all converted into Workbench-safe `MM/YYYY` format. Added item rating lookup from `ondc_ratings` using the generated ONDC item id (`prod_<productId>` / `prod_<productId>_var_<variantId>`), normalized stored rating values into ONDC-valid `1` to `5` strings, and passed the final item rating into the ONDC item builder.

- `src/ondc/utils/catalog.builders.ts`
  Updated the item payload builder to accept a `rating` input and stopped hardcoding the item rating as an empty string. Added a valid fallback rating so every emitted item remains schema compliant even when no persisted item rating exists yet.

**Verification:**

- Confirmed the manufacturing month field no longer falls back to `YYYY-MM`.
- Confirmed `items[].rating` is always present in the payload.
- Verified item ratings are sourced from `ondc_ratings` when available and otherwise fall back to a valid ONDC-safe value.
- Ran `npm run build` successfully.

### Branch 030

**Date:** 2026-07-03

**Status:** Completed

**Area:** ONDC Flow 4A/4B (Update Settlement Refactoring)

**What:**

Refactored the `/update` API logic into a clean `if/else` block based on `update_target` and updated codebase comments to professional English.

**Why:**

The previous logic used an early `return` to prevent `on_update` callbacks for settlement updates (`target === 'payment'`). While functionally correct, using an explicit `if/else if/else` block improves code readability and safely segregates logic for `item`/`fulfillment` updates from `payment` updates. This ensures standard backend best practices where "do nothing" paths (like suppressing the webhook for payments) are explicitly defined and logged, leaving no ambiguity for future developers. Additionally, all Hindi instructional comments were translated to standard English.

**Changes:** file name and description of file change:

- `src/ondc/controllers/beckn/update.controller.ts`
  Replaced the early return mechanism with a structured `if/else` pipeline. The first block handles `item` and `fulfillment` updates (initiating the `on_update` callback), while the `else if (target === 'payment')` block cleanly logs the intentional suppression of the callback as per ONDC Flow 4A/4B guidelines. Replaced Hindi comments with English.

### Branch 028

Date:
2 July 2026

Status:
Completed

Area:
ONDC Backend - BAP Terms

What:
Added backend support for a BAP Terms admin listing flow. The backend now exposes a dedicated admin API to read stored BAP terms from the database with filters for `bap_id`, `bap_uri`, and `transaction_id`. The BAP term extraction logic was also improved so `/search` payload tags are stored correctly even when tag codes come in alternate Beckn formats.

Why:
The ONDC admin dashboard needed backend support to verify whether BAP terms are actually being extracted from incoming `/search` payloads, saved in the database, and made available for monitoring. This was required so the UI could show only database-backed BAP term data without disturbing any existing ONDC order, ticket, or settlement flows.

Changes:

- `src/ondc/models/bap_terms.model.ts`:
  Added filtered list support for BAP terms using `bap_id`, `bap_uri`, and `transaction_id`. Improved the extraction helper so it can read term fields from both `tag.code` and `tag.descriptor.code` payload formats. Kept finder-fee extraction from both `intent.tags` and `intent.payment`.

- `src/ondc/controllers/admin/bap_terms.controller.ts`:
  Added a new admin controller to fetch BAP terms from the `bap_terms` table and shape the response for dashboard consumption. The API returns `transaction_id` from the stored `unique_uid` column along with term fields and timestamps.

- `src/ondc/routes/admin.route.ts`:
  Added the new admin route for BAP terms listing so the ONDC admin dashboard can fetch the stored records from the backend.

- `src/ondc/controllers/beckn/search.controller.ts`:
  Continued using the existing `/search` processing path to upsert BAP terms into the database from incoming Beckn payloads. This remains the main backend source for storing BAP terms.

### Branch 027

**Date:** 2026-07-02

**Status:** Completed

**Area:** ONDC Mandatory Field Validation (Track API)

**What:**

Added endpoint-specific mandatory field validation for `message.order_id` in the `/track` API, while confirming that global ONDC `context` fields are already validated across all APIs via existing middleware.

**Why:**

If a BAP sends a request missing a mandatory payload field, the ONDC protocol expects an immediate synchronous `NACK` response detailing exactly which field is missing. Since `context` fields (like `domain`, `bap_id`, etc.) are covered globally by `ondcValidator.middleware.ts` for all APIs, we only needed to add validation for `message.order_id` in the track controller to return a specific `CONTEXT-ERROR` (Code `20000`) with the exact `path`.

**Changes:** file name and description of file change:

- `src/ondc/controllers/beckn/track.controller.ts`
  Added validation at the beginning of `handleTrack` to check if `message.order_id` is present. If missing, it synchronously returns a `NACK` response containing an error object with `type: 'CONTEXT-ERROR'`, `code: '20000'`, `path: 'message.order_id'`, and a descriptive message.

<<<<<<< Updated upstream

## BRANCH-026

**Date:** 2026-07-02

**Status:** Completed

**Area:** ONDC IGM flow correction for normal issue flow and Flow 6F escalation flow

**What:**

- Corrected the IGM action order so the first buyer `/issue` starts as `OPEN` instead of auto-injecting seller `PROCESSING`.
- Added explicit Flow `6F` escalation handling so the escalation branch starts only when buyer sends `ESCALATED`.
- Updated merged IGM issue state handling so escalation clears stale accepted-resolution state and allows a fresh second resolution proposal.
- Added fixture-path support in the local IGM runner so different IGM sample flows can be tested from separate fixture files.
- Added ONDC action routing support for `on_receiver_recon` in the top-level app path rewriter.

**Why:**

- The existing IGM sequence was not matching the intended business flow because seller `PROCESSING` was being added too early on the very first buyer action.
- Flow `6F` escalation needs a separate branch from the normal refund/replacement flow: buyer raises issue, seller processes, seller proposes resolution, buyer escalates, seller/GRO processes, seller proposes resolution again, buyer accepts, seller resolves, buyer closes.
- Once buyer escalates after an earlier proposal/acceptance cycle, the old selected-resolution state should not continue to drive the next proposal cycle.
- Local testing needed a cleaner way to switch between normal IGM and escalation-specific transaction fixtures without editing the runner every time.

**Changes:**

- `src/ondc/services/igm.service.ts`
  - Removed automatic seller `PROCESSING` action insertion on the first inbound IGM v2 issue.
  - Changed first ticket persistence from `PROCESSING` to `OPEN` so buyer `OPEN` is the true starting state.
  - Added Flow `6F` escalation handling when inbound buyer actions contain `ESCALATED`.
  - Auto-appended seller/GRO `PROCESSING` only inside the escalation branch.
  - Updated IGM defaults for `city` and `core_version` fallback values used in callbacks and stored rows.

- `src/ondc/utils/igm.builder.ts`
  - Updated merged issue-status derivation for `ESCALATED`, `RESOLUTION_ACCEPTED`, `RESOLVED`, and `CLOSED`.
  - Added logic to ignore an older accepted resolution once a later `ESCALATED` action exists.
  - Prevented stale accepted resolution id/code/label from leaking into the second escalation-side resolution cycle.

- `src/ondc/test-igm.ts`
  - Added `--fixture` and `IGM_TEST_FIXTURE` support so local IGM test runs can load different sample transaction files.

- `src/app.ts`
  - Added `on_receiver_recon` to the Beckn action routing set so that direct action-path requests are rewritten under `/api/v1/ondc`.

=======

> > > > > > > Stashed changes

### Branch 025

**Date:** 2026-07-02

**Status:** Completed

**Area:** ONDC Flow 1A (Tracking API Sync Response)

**What:**

Updated the `/track` API to return a synchronous NACK when tracking is disabled or not available (`tracking=false`), instead of sending an async `/on_track` with an error.

**Why:**

When `tracking=false`, the Pramaan test platform expects an immediate NACK in the synchronous response to `/track` to properly mark the step as completed without waiting for an `on_track` callback. The previous implementation sent a sync ACK and then an async `/on_track` error, which caused testing logs to fail to capture the NACK properly.

**Changes:** file name and description of file change:

- `src/ondc/controllers/beckn/track.controller.ts`
  Modified `handleTrack` to immediately fetch the order and check `trackingUrl`. If `trackingUrl` is absent, it synchronously responds with `status: "NACK"` and the standard `CONTEXT-ERROR` payload (`40003: Tracking is not available for this order`). It also stops execution so no async `/on_track` webhook is fired.

### Branch 024

**Date:** 2026-07-01

**Status:** Completed

**Area:** ONDC Flow 4A & 4B (Buyer Initiated Returns)

**What:**

Updated the fulfillment return actions (Return Approved, Picked, Delivered) to send an unsolicited `/on_update` payload with Order State "Completed" instead of sending an `/on_status` payload.

**Why:**

The Pramaan BAP expects return lifecycle updates to be sent as `/on_update` requests and requires the main order state to remain "Completed". Previously, the system was sending `/on_status` and mapping the order state to "Returned", which caused the Pramaan test progress ring to stop at 25%.

**Changes:** file name and description of file change:

- `src/ondc/flows/flow4A.service.ts`
  Added a new `pushOnUpdate` method to properly build and send unsolicited `/on_update` payloads containing the updated fulfillment states.

- `src/ondc/services/fulfillment.service.ts`
  Changed the return lifecycle methods (`markReturnInitiated`, `markReturnApproved`, `markReturnPicked`, and `markReturnDelivered`) to use the new `flow4AService.pushOnUpdate` method instead of the generic `flow1AService.pushOnStatus`.

- `src/ondc/adapters/order.adapter.ts`
  Updated the `mapDbStatusToBeckn` function so that a `RETURNED` database status maps to the `"Completed"` Order State in the ONDC payload, adhering to the Flow 4A/4B spec.

### Branch 023

**Date:** 2026-06-30

**Status:** Completed

**Area:** ONDC IGM repeated information-request flow

**What:**

Updated the IGM complaint flow so the seller can ask for information more than once in the same issue flow. If the buyer provides the first requested info and the seller still needs more details, the seller can send another info request in the same complaint journey, the buyer can respond again, and only after that the seller can continue to resolution options and resolution completion.

**Why:**

The flow was already working for the normal path:
issue raised -> info requested -> info provided -> resolution options -> resolved.

But the expected Pramaan-style journey also needs the repeated-info scenario:
issue raised -> info requested -> info provided -> info requested again -> info provided again -> resolution options -> resolved.

To support that properly, the system needed to track only currently open info requests instead of total historical info requests.

**Changes:** file name and description of file change:

- `src/ondc/utils/igm.builder.ts`
  Updated IGM mirror/state extraction logic for `open_info_request_count`. It now calculates outstanding open info requests as:
  total `INFO_REQUESTED` minus total `INFO_PROVIDED`,
  instead of counting only how many info requests happened historically. This keeps the same complaint flow open when seller asks for info again and clears it once buyer provides the requested information.

- `src/ondc/test-igm-v2-smoke.ts`
  Extended the IGM V2 smoke test to cover the repeated-info path:
  first info request -> first buyer info -> second info request -> second buyer info -> resolution options.
  Added verification logs to confirm that:
  `open_info_request_count` becomes `0` after buyer response,
  becomes `1` again after seller asks for more info,
  and returns to `0` after the second buyer response.

### Branch 022

**Date:** 2026-06-30

**Status:** In Progress

**Area:** ONDC Return Fulfillment Flow

**What:**

Implemented granular return status handlers (`return_initiated`, `return_approved`, `return_picked`, `return_delivered`) in the fulfillment service and wired them to the admin orders controller.

**Why:**

To handle precise fulfillment return states, update ONDC order states dynamically, and ensure network updates (callbacks) are pushed correctly for each step of the return journey.

**Changes:**

- `src/ondc/controllers/admin/orders.controller.ts`
  Added switch cases for `return_initiated`, `return_approved`, `return_picked`, and `return_delivered` in the `updateFulfillment` handler to invoke corresponding fulfillment service methods.

- `src/ondc/services/fulfillment.service.ts`
  Created new state transition methods (`markReturnInitiated`, `markReturnApproved`, `markReturnPicked`, `markReturnDelivered`) to update database fulfillment state, transition the order status, and trigger network push.

### Branch 021

Fix IGM Issue

### Branch 019

**Date:** 2026-06-29

**Status:** Completed — backend + UI tsc clean, dist/main.js rebuilt. Pending deploy + Pramaan IGM run.

**Area:** ONDC IGM — `/issue`, `/issue_status`, `/on_issue`, `/on_issue_status` + admin Tickets (customer ticket page).

**What:**

Implemented the full IGM flow end to end. The Tickets UI existed but the backend was a stub (wrote a thin `ondc_issues` row, replied `on_issue` with empty actions, and the 5 endpoints the UI calls did not exist). Now:

- Inbound `/issue` creates/updates a ticket in `ondc_customer_ticket`, stores the buyer complaint (with images) and every subsequent complainant action (INFO_PROVIDED + attachment, RESOLUTION_ACCEPTED, CLOSE), auto-acks **PROCESSING**, and pushes `on_issue` to the buyer NP.
- Inbound `/issue_status` pushes `on_issue_status` with the current respondent actions + resolution.
- Seller-initiated actions from the Tickets UI (message / info request / resolution options / processing / resolve / close) append to the transcript and push `on_issue` to the buyer NP.
- The whole transcript is stored in `ondc_customer_ticket.actions_json` and shown in the chat.

**Why:**

The customer ticket page had no working backend — `getIssue`, `addMessage`, `status`, `resolve`, `close` all 404'd, there was no messages store, and `on_issue` carried no respondent actions, so the Pramaan IGM flow could not progress and nothing was persisted.

**Changes:** file name and description of file change:

`src/ondc/models/customer_ticket.model.ts` (new)
Model over `ondc_customer_ticket`; stores the chat in `actions_json`; `list`, `getById`, `findByTicketId`, `create`, `appendMessage`, `setStatus`, `setSelectedResolution`, `parseMessages`.

`src/ondc/services/igm.service.ts` (rewritten)
`handleIssue` (inbound, all complainant actions + PROCESSING ack), `handleIssueStatus` (→ on_issue_status), and `sellerAction(ticketId, kind, body)` for seller-initiated `on_issue`. Builds `respondent_actions` from stored seller messages; resolution + resolution_provider on resolve. ONDC respondent_action codes isolated in a `RESPONDENT_ACTION` map (CONFIRM vs Pramaan IGM 2.0.0 — no IGM schema ships in the 1.2.5 validator).

`src/ondc/controllers/admin/issues.controller.ts` (rewritten)
`listOndcIssues` (from tickets), `getOndcIssue` (ticket + `messages[]`), `addOndcIssueMessage`, `updateOndcIssueStatus`, `resolveOndcIssue`, `closeOndcIssue`.

`src/ondc/routes/admin.route.ts`
Registered the 5 IGM endpoints: `GET /issues/:id`, `POST /issues/:id/message`, `PATCH /issues/:id/status|resolve|close`.

`src/ondc/flows/flow3B.service.ts`
Fixed 2 pre-existing tsc errors (removed reads of non-existent `sellerProfile.bank_name`/`bank_branch`).

`seed-igm-ticket.ts` (new, dev tool)
Seeds one sample ticket with the full transcript (OPEN → PROCESSING → GET_INFO → INFO_PROVIDED → RESOLUTION_PROPOSED → RESOLUTION_ACCEPTED → RESOLVED → ISSUE_STATUS → RESOLVED → CLOSE) incl. images, PDF attachment, and resolution options. Run: `npx tsx seed-igm-ticket.ts`.

**DB changes:** None — `ondc_customer_ticket` already exists; the chat lives in its `actions_json`.

### Branch 018

**Date:** 2026-06-29

**Status:** Completed

**Area:** ONDC Request Monitor — search by BAP ID + distinct buyer-apps (BAP) directory endpoint

**What:**

Added a `bap_id` filter to the Request Monitor list endpoint, and a new endpoint that returns the distinct buyer apps (BAP IDs) that have ever sent us a request, with per-app request counts, first/last seen, and the domains they used.

**Why:**

The Request Monitor list could only be searched by transaction_id (`q`); `bap_id` was returned as a column but was not filterable, and there was no way to know how many distinct buyer apps have hit our BPP. The admin UI needed a server-side count and list so the totals reflect the whole `ondc_txn_logs` table instead of just the current page.

**Changes:** file name and description of file change:

`src/ondc/controllers/admin/request_monitor.controller.ts`
`listByAction` now reads a `bap_id` query param and adds `AND bap_id LIKE ?` to the WHERE clause (substring match; the exact bap_id from the UI's "View requests" still matches).
Added `listBuyerApps` handler — `SELECT bap_id, COUNT(*) AS request_count, MIN/MAX(created_at) AS first_seen/last_seen, GROUP_CONCAT(DISTINCT domain) AS domains FROM ondc_txn_logs WHERE direction='inbound' AND bap_id IS NOT NULL GROUP BY bap_id ORDER BY last_seen DESC`. Supports `days` (0 = all time) and `q` (bap_id substring); returns `meta.total`.

`src/ondc/routes/admin.route.ts`
Registered `GET /buyer-apps` (admin-guarded) → `/api/v1/ondc/admin/buyer-apps`, wired to `listBuyerApps`.

## Branch 017

**Date:** 2026-06-29

**Status:** Completed

**Area:** ONDC Pramaan fulfillment update flow, on_status callback flow, partial cancel flow, in-transit cancel Flow 3B

**What:**

Fixed the ONDC fulfillment update and cancel callback flow so Pramaan ring should move correctly when fulfillment is updated from UI. Also implemented Flow 3B for in-transit cancellation and made the payload structure dynamic and DB-driven.

**Why:**

Earlier, fulfillment updates were getting saved in DB but Pramaan could still get stuck because unsolicited callbacks were not fully aligned with expected flow behavior. The main issues were missing callback message_id, missing persisted agent details, incomplete partial-cancel status sync, and Flow 3B being only a TODO.

**Changes:** file name and description of file change:

`src/ondc/controllers/admin/orders.controller.ts`
Passed agent_name and agent_phone during fulfillment update.
Routed merchant cancel action dynamically:pre-pickup cancel → Flow 3A
in-transit cancel → Flow 3B

`src/ondc/flows/flow1A.service.ts`
Added generated message_id for unsolicited on_status callbacks.
This helps Pramaan correlate the callback correctly.

`src/ondc/flows/flow3A.service.ts`
Added generated message_id support.
Fixed partial cancel flow so on_update and on_status send the same updated order state.
Recomputed quote using remaining quantities so payload stays consistent for Pramaan.

`src/ondc/flows/flow3B.service.ts`
Implemented full in-transit cancel flow.

Added dynamic on_cancel payload structure with:delivery fulfillment cancellation
RTO fulfillment leg
split item quantities
cancel_request, precancel_state, and quote_trail tags

Removed hardcoded sample values and made data DB/raw-payload driven.

`src/ondc/flows/flow7.service.ts`
Added generated message_id for on_cancel callback context.

`src/ondc/models/fulfillment.model.ts`
Extended fulfillment update support to save:tracking url
awb
courier
agent name
agent phone

`src/ondc/services/fulfillment.service.ts`
Saved agent details for agent_assigned and out_for_delivery.
Ensured fulfillment state updates carry correct live data before callback is triggered.

## Fetch Product Images for Order Items

**Date:** 2026-06-29

**Status:** Done

**Area:** ONDC Order Models

**What:**

- Updated the `getItems` database query to fetch product and variant images (`db_product_image_url`) along with the order items.

**Why:**

- To provide image URLs for the order items directly from the database (via `variant_images` and `product_images` tables) so they can be displayed correctly on the frontend.

**Changes:**

- `src/ondc/models/order.model.ts` — Modified `getItems` SQL query to include a `COALESCE` subquery that attempts to fetch `image_url` from `variant_images` first, and falls back to `product_images` if a variant image is not found.
- `src/ondc/controllers/admin/orders.controller.ts` — Minor code cleanup (removed debug log).

---

## Branch 015

**Date:** 2026-06-26

**Status:** Done — backend + UI tsc clean, dist/main.js rebuilt. Pending deploy + Pramaan re-run.

**Area:** ONDC order lifecycle — `/on_status` payload + merchant-initiated cancellation (Pramaan Flows 1A, 3A, 3B, 3C).

**What:**

- `/on_status` now returns the COMPLETE order (quote, full billing/payment, fulfillment start/end/agent/tags/provider_name/TAT, documents on delivery) and a valid ONDC `order.state` (was sending raw internal `"CONFIRMED"` with no quote). Both the reactive `/status` poll and the seller-initiated push use one shared builder.
- Merchant **full cancel** (Flow 3C) now sends `on_cancel` (was wrongly sending `on_status`), with quote/cancellation block, and accepts a reason code.
- Merchant **RTO** (Flow 3B) now sends `on_cancel` (RTO) **followed by** `on_status`.
- Merchant **partial cancel** (Flow 3A) implemented: `on_update` (remaining qty + Cancel fulfillment with quote_trail) **followed by** `on_status`.
- UI: order page now has an **RTO** fulfillment action; the cancel modal passes the reason code on full cancel and has a new **Partial Cancel** item-quantity picker (3A).

**Why:**

- on_status was incomplete (no quote, invalid state) → Pramaan Flow 1A on_status stuck at 83%, and the on_status steps in 3A/3B would fail. Data must be inherited from on_confirm and only the fulfillment state advances per the flow.
- The merchant cancel button fired the wrong callback (`on_status` instead of `on_cancel`), so Pramaan 3C could not pass; 3A/3B had no UI trigger.

**Changes:**

- `src/ondc/adapters/order.adapter.ts` — new `buildOnStatusOrder(row, liveFulfillments)` (async): full order from `raw_confirm_payload` (quote/items/billing/payment) overlaid with live fulfillment state/agent/tracking; ONDC-enum `order.state`. Builds a CONTRACT-COMPLETE Delivery fulfillment — pickup `start` (location/contact) fetched DYNAMICALLY from the store + its location (`fetchStoreById`/`fetchStoreLocations`), `end` from the buyer order/billing with `person`, `start.time`/`end.time` with `range`, `agent`, `tags` (routing P2P + tracking), `@ondc/org/provider_name`, `@ondc/org/TAT`. Also fills `quote.breakup[].title`, `payment.params`, and `documents` (invoice) — all schema-required. Validated against ONDC `onStatusSchema` (0 errors) even from a thin buyer confirm.
- `src/ondc/controllers/beckn/status.controller.ts` — reactive `/status` now uses `buildOnStatusOrder` (was a thin inline object).
- `src/ondc/flows/flow1A.service.ts` — `pushOnStatus` uses `buildOnStatusOrder` + logs the outbound callback.
- `src/ondc/flows/flow3A.service.ts` — `cancelByseller` (FULL cancel → rich `on_cancel` + cancellation block) and new `partialCancelByseller` (PARTIAL → `on_update` + `on_status`).
- `src/ondc/services/fulfillment.service.ts` — `initiateRto` now also pushes `on_status` after `on_cancel`.
- `src/ondc/controllers/admin/orders.controller.ts` — `'cancelled'` action → `flow3AService.cancelByseller` (on_cancel); new `'partial_cancel'` action.
- `src/ondc/controllers/beckn/cancel.controller.ts` — buyer `on_cancel` order state `"CANCELLED"` → `"Cancelled"`.
- `odop_ui/src/api/ondc.api.ts` — `updateFulfillment` body accepts `reason_id` + `items`.
- `odop_ui/src/pages/admin/ondc/OndcOrderDetailPage.tsx` — added RTO fulfillment action.
- `odop_ui/src/components/ondc/OrderCancelTriggerModal.tsx` — full cancel passes reason; new partial-cancel item picker.

**DB changes:** None required (quote/fulfillment data read from `raw_confirm_payload` + live fulfillment rows). `ondc_order_actions` already exists for partial-cancel records.

## Branch-015

Date: 26-06-2026

Status: Completed

Area: ONDC Network Rating Flow (Backend & UI)

What: Updated the `/rating` and `/on_rating` flow to fully match the ONDC Network Rating API contract (v1.2.x), enabling persistence of multiple buyer-submitted ratings per transaction, and added a dedicated Admin UI page to view them.

Why: The previous implementation was only reading a single rating object instead of the required array of ratings, causing `NULL` values and collapsing multiple component ratings (Order, Provider, Item, Fulfillment, Agent) into improper database rows. Also, the BPP was not responding with the feedback form URL in the `on_rating` payload as required by the ONDC spec.

Changes:

- src/ondc/config/constants.ts: Added `ONDC_RATING_FEEDBACK_URL` to `SELLER_PROFILE` to make the feedback link configurable.
- src/ondc/utils/payload.builder.ts: Modified `buildOnRating` to include the `feedback_form` URL in the response payload.
- src/ondc/db/migrations/001_setup_ondc.sql & schema.sql: Altered the `ondc_ratings` table to add an `order_id` column and updated the unique key constraint to `(transaction_id, rating_category, rated_id)` to support multiple item ratings.
- src/ondc/models/rating.model.ts: Created a new model with `upsertRating` (handles `ON DUPLICATE KEY UPDATE`) and `listRatings` functions.
- src/ondc/controllers/beckn/rating.controller.ts: Updated `handleRating` to iterate over the `message.ratings` array and save each individual rating component accurately.
- src/ondc/controllers/admin/ratings.controller.ts: Created a new controller to serve paginated rating data to the admin UI.
- src/ondc/routes/admin.route.ts: Added the newly created `/ratings` endpoints under the admin routes.
- odop_ui/src/api/ondc.api.ts: Added `getRatings` and `getOrderRatings` hooks for the React frontend.
- odop_ui/src/pages/admin/ondc/OndcRatingsPage.tsx: Created the frontend UI page to list and filter buyer ratings.
- odop_ui/src/route/adminRoutes.tsx: Registered the `/ratings` page route in the admin portal.
- odop_ui/src/components/ondc/OndcSidebar.tsx: Added a 'Ratings' link to the ONDC admin sidebar navigation.

---

## Branch-013

**Date:** 2026-06-26

**Status:** In Progress / Uncommitted

**Area:** ONDC `on_search` catalog item payload — workbench schema validation (ITEMS_RATING and MONTH_YEAR_OF_MANUFACTURE_PACKING_IMPORT).

**What:**

- Item `rating` is no longer sent as an empty string. It is now **omitted entirely** unless a valid ONDC value (whole number "1".."5") is available; a decimal is rounded to the nearest 1-5.
- `month_year_of_manufacture_packing_import` is now normalized to a valid value — it keeps a real `MM/YYYY` value or falls back to `NA`, instead of sending an empty string.
- Added two helper functions and an optional `rating` input field to support this.

**Why:**

- The ONDC workbench `on_search` validation failed with **ITEMS_RATING** because every item carried `rating: ""` — the rule rejects a present-but-invalid value and only skips when the field is absent. Omitting it makes the rule pass.
- It also failed with **MONTH_YEAR_OF_MANUFACTURE_PACKING_IMPORT** because the field was `""`; the rule requires `MM/YYYY` or `NA`.

**Changes:**

- `src/ondc/utils/catalog.builders.ts`
  - Added `rating?: string | number | null` to the `BuildOndcItemInput` interface.
  - Added `normalizeMonthYear(value)` — returns the value if it matches `MM/YYYY`, otherwise `NA`.
  - Added `isValidItemRating(value)` — true only for a whole number 1-5 (rounds decimals).
  - In `buildOndcItem`, replaced the hardcoded `rating: ''` with a conditional spread that emits `rating` only when valid.
  - In `buildOndcItem`, the `@ondc/org/statutory_reqs_packaged_commodities.month_year_of_manufacture_packing_import` field now uses `normalizeMonthYear(...)` instead of `?? ''`.

## Branch-011

**Date:** 2026-06-25

**Status:** In Progress / Uncommitted

**Area:** ONDC Tracking Flow / Payload Validation

**What:**

- Updated the `/track` controller to return a standard ONDC NACK error (code 30016) when a tracking URL is unavailable, instead of sending a successful payload with `status: 'inactive'`.
- Ensured transaction logs accurately reflect the NACK status when tracking fails.

**Why:**

- Sending an `on_track` payload with `status: 'inactive'` and no tracking URL can cause contract validation failures or misrepresent the tracking state to the buyer network. The correct ONDC protocol behavior is to return an error (NACK) with code 30016 ("Tracking not available") when the tracking link is absent.

**Changes:**

- `src/ondc/controllers/beckn/track.controller.ts`: Refactored `handleTrack` to conditionally construct a NACK error response (code 30016) if `trackingUrl` is null. Updated callback logging parameters (`ack_status` and `error_message`) to accurately record NACKs in the transaction history.

## Branch-010

**Date:** 2026-06-25

**Status:** In Progress / Uncommitted

**Area:** ONDC RTO Cancellation Flow, Validation, and Fulfillment State Handling

**What:**

- Implemented an RTO (Return to Origin) cancellation service `cancelRto` in flow 3C to push network updates when an RTO is initiated.
- Added dynamic generic logic to handle cancellation reasons from the admin controller for all standard cancellations.
- Updated the ONDC validator middleware and cancel controller to construct strict NACK error responses through callbacks when validations fail.
- Linked new order transitions (e.g., packing, out-for-delivery, agent-assigned) with network update triggers (`flow1AService.pushOnStatus` and `flow3CService.cancelRto`).
- Created a testing script `test-rto.ts` to simulate database queries for RTO callbacks without state mutations.

**Why:**

- Previous fulfillment states were only mutating the local DB but not correctly pushing `on_status` updates to the ONDC network for events like "Agent-assigned" or "Order-picked-up".
- Implementing RTO allows sellers to mark orders that fail delivery as returning to origin, triggering an `on_cancel` payload back to the network.
- Asynchronous validation responses (NACK) required proper payloads to be built and transmitted when requests fail ONDC header rules.

**Changes:**

- `src/ondc/controllers/admin/orders.controller.ts`: Allowed generic cancellation reasons to be correctly passed into standard cancellation flows from the admin interface.
- `src/ondc/controllers/beckn/cancel.controller.ts`: Refactored callback processing to send explicit NACK errors on validation failure.
- `src/ondc/flows/flow3C.service.ts`: Added the `cancelRto` method to trigger asynchronous callbacks for RTO flows.
- `src/ondc/flows/generators/generateFlow3COnCancel.ts`: Implemented a payload generator to shape the ONDC `on_cancel` callback payload specifically for RTO.
- `src/ondc/middleware/ondcValidator.middleware.ts`: Enhanced validation middleware to properly construct NACK contexts upon request failure.
- `src/ondc/services/fulfillment.service.ts`: Linked internal state transitions using `orderModel.transitionStatus` and added triggers for `flow1AService.pushOnStatus` on major state updates like `markPacked` and `markAgentAssigned`. Added `markAgentAssigned` action.
- `src/ondc/test-rto.ts`: (New file) Created a test script to trigger the `cancelRto` mock.
- `src/ondc/types/order.types.ts`: Added the `Agent-assigned` fulfillment state.

## Branch-008

**Date:** 2026-06-24

**Status:** Completed (documentation + tooling only — no source code changed)

**Area:** Full ONDC codebase + UI audit against API contract v1.2.5, Postman testing collection, and the master implementation plan.

**What:**

- Audited the entire `src/ondc/**` backend and the `odop_ui` ONDC admin UI against ONDC v1.2.5 (retail), IGM 2.0.0, and PPF/NTS10 settlement.
- Produced an endpoint inventory: 12 network-facing Beckn endpoints (4 fully working, 7 partial) + 21 admin endpoints (all working), with per-endpoint contract gaps.
- Confirmed onboarding is done (whitelisted on preprod), settlement uses PPF not RSF (both PPF APIs present), role is MSN, and the localhost signature bypass is intentional.
- Built a single self-contained Postman collection (all endpoints + v1.2.5 request bodies + collection variables) for local testing, and fixed the `insecure=1` localhost bypass so Postman actually sends it.
- Wrote `implementationplan.md` — master plan of done vs pending, with a 3-phase, 3-person roadmap.

**Why:**

- The 3-person team needed one source of truth for what is built, partial, and left before the Pramaan/workbench flows pass.
- Easy, repeatable local API testing was needed (Postman → localhost with signature bypass; Pramaan/workbench for signed preprod).
- To document the real deployment facts (already whitelisted, PPF, MSN, localhost bypass) so settled decisions are not re-litigated.

**Changes:**

- `implementationplan.md` (new)
  Master implementation plan: endpoint status tables, v1.2.5 contract-gap punch list, preprod-readiness checklist, DB→UI data-coverage analysis, UI enhancement plan, and the phased roadmap.

- `ONDC_v1.2.5_Workbench.postman_collection.json` (new)
  Single merged Postman collection — 4 folders (network Beckn, admin APIs, health/test, domain search examples), v1.2.5 bodies, collection-level variables (defaults to localhost), and `insecure=1` query param baked into Beckn requests for the localhost signature bypass.

## BRANCH-005

**Date:** 2026-06-22

**Status:** Completed

**Area:** ONDC RTO Cancellation Flow, Dynamic Payload Generation, and Validation Fixes

**What:**

- Fixed the `cancelRto` logic to fetch 100% of payload data dynamically from the database.
- Removed hardcoded values like item fallback titles ("Atta", "Apparel"), delivery/packing charges, and BPP ID ("lsp.com") in the RTO callback.
- Fixed ES Module file system errors so that outgoing RTO payloads correctly log to `logs/ondc/RTOcancell.log`.
- Updated ONDC payload validation to accurately check `domain` headers and trigger NACK error callbacks asynchronously.
- Repaired broken `fulfillmentService` imports preventing state updates.
- Wrote and verified a test script to validate RTO payloads purely from database queries without hardcoded data.

**Why:**

- The RTO cancel payload previously included mock data defaults (e.g., "50.00", "lsp.com", "Apparel") when real values were missing, which breaks production accuracy.
- Outbound logging was failing because `require('fs')` crashed within an ES Module environment (`type: "module"`), masking errors.
- Network validation middleware wasn't robust enough with NACK asynchronous flows and strict domain checking.
- Merge conflicts broke `fulfillment.service.ts`, preventing status transitions from invoking downstream flows.

**Changes:**

- `src/ondc/flows/flow3C.service.ts`
  Removed hardcoded `lsp.com` for `initiated_by` and substituted it with dynamic BPP IDs. Removed default fallback logic that set empty DB delivery/packing charges to `50.00` and `25.00`, strictly defaulting to `0.00` instead. Replaced `require` imports for `fs` and `path` with dynamic imports (`await import('fs')`) to successfully write `logs/ondc/RTOcancell.log`.

- `src/ondc/middleware/ondcValidator.middleware.ts`
  Added strict checks to respond with `NACK` when an invalid or missing `domain` is passed in requests (allowing RET10, RET12, RET16). Fixed `sendCallback` integration to ensure outbound NACK calls are accurately fired with proper reasons.

- `src/ondc/services/fulfillment.service.ts`
  Resolved git merge conflicts and reinstated valid imports for `flow1AService` and `flow3CService` to fix fulfillment state transition errors.

- `src/ondc/test-rto.ts`
  Updated this script using `dotenv/config` and proper imports to smoothly test database queries and securely trigger RTO cancel logging without altering real database state.

## BRANCH-003

Date: 22-06-2026

Status: Implemented / Completed

Area: ONDC BPP Callback Engine (on_cancel payload logic)

What:
on_cancel response payload ke saare hardcoded values (cancellation reason ID, buyer finder fee amount, settlement details, tracking boolean status aur cancel fulfillment ID) ko dynamic kiya gaya hai. Ab yeh saara data directly database tables (ondc_orders, ondc_fulfillments, bap_terms, seller_profiles, stores, ondc_order_actions) se fetch hokar return hota hai.

Why:
ONDC Pramaan contract compliance test ko bina kisi validation error ke pass karne ke liye aur flow operations (full/partial cancellation) ke dauran database state aur callbacks ke beech absolute sync maintain karne ke liye.

Changes:

1. File: src/ondc/models/order.model.ts
   - transitionStatus method ko update kiya gaya taaki yeh optional 'extras' params accept kar sake aur cancel_reason_id ko database ke ondc_orders table mein directly update kar sake.

2. File: src/ondc/controllers/beckn/cancel.controller.ts
   - cancellation_reason_id ko DB mein save karne ke liye transitionStatus parameter mein pass kiya.
   - bap_terms table se bap_id ke matching record ke bff_percent ko fetch karke buyer finder fee amount dynamic kiya.
   - ondc_order_actions table se partial cancel ka unique action_id fetch kiya aur product cancellation ke liye dynamic fulfillment ID set ki (na milne par 'C1' fallback ke sath).
   - ondc_fulfillments table ke tracking_url column se track boolean status dynamically map kiya (false jab link na ho).
   - seller_profiles aur stores tables se bank account, upi, bank branch aur beneficiary details fetch karke settlement_details dynamic banaya.

## BRANCH-002

**Date:** 2026-06-20

**Status:** Completed

**Area:** ONDC confirm flow, Pramaan retry handling, and `on_confirm` payload stability

**What:**

- Improved the ONDC `/confirm` flow to handle repeated confirm requests safely.
- Fixed the `on_confirm` payload so important billing data is preserved.
- Removed empty payment callback fields that could cause validation issues in Pramaan.

**Why:**

- Pramaan sometimes triggers `/confirm` again for the same order, and our old logic failed on duplicate `ondc_order_id`, which stopped `on_confirm` from being sent.
- `billing.tax_number` was getting dropped from the outgoing `on_confirm` payload.
- Empty `payment.url` and forced `tl_method` values were being sent even when no payment URL existed, which could create payload validation problems.

**Changes:**

- `src/ondc/controllers/beckn/confirm.controller.ts`
  - Added duplicate-order detection for `ER_DUP_ENTRY` on `uq_ondc_order_id`.
  - Made the confirm flow idempotent so repeated `/confirm` requests reuse the existing order instead of failing.
  - Allowed `on_confirm` to continue sending even when the same order is retried.
  - Prevented duplicate status transition by updating order status to `CONFIRMED` only when the existing order is still in `CREATED` state.
  - Preserved `billing.tax_number` in the normalized billing object.
  - Stopped sending empty `payment.url` and unnecessary `tl_method` fields when no actual payment URL is present.
  - Normalized payment params before building the outgoing `on_confirm` payload.

## BRANCH-001

**Date:** 2026-06-20

**Status:** Completed

**Area:** ONDC IGM admin APIs, customer ticket persistence, issue lifecycle handling, provider enrichment, and callback logging

**What:**

- Added admin APIs to list customer tickets, view a single ticket, and fetch ticket attachments.
- Expanded admin issue APIs to support detail view, sending messages, updating status, resolving issues, and closing issues.
- Added a dedicated customer ticket model for storing normalized IGM ticket data in `ondc_customer_ticket`.
- Enhanced issue model helpers for scoped lookup, idempotent creation, action parsing, and action appending.
- Enriched provider lookup with seller and business details for IGM actor and respondent population.
- Reworked `igm.service.ts` to normalize incoming issue payloads, enrich refs and actors, persist customer ticket data, rebuild `on_issue` callback payloads from stored data, and log outbound callback results.

**Why:**

- To support a fuller ONDC IGM workflow from admin and seller panels.
- The UI buttons were visible but not actually connected to ONDC issue mutations
- on_issue was returning a minimal placeholder payload, not the expected contract structure
- To avoid losing issue, actor, attachment, and action data from inbound issue payloads.
- To keep `on_issue` callback payloads consistent by rebuilding them from normalized stored data instead of relying only on the raw request body.
- To expose customer ticket and issue progress in a structured way for operational tracking.
- To log outbound callback status for easier debugging and auditability.

**Changes:**

- `src/ondc/controllers/admin/customerTickets.controller.ts`
  Added a new controller to list tickets, fetch a single ticket, parse attachments, and expose attachment-only responses.

- `src/ondc/controllers/admin/issues.controller.ts`
  Expanded issue handling with status normalization, presented response shaping, message/history building, scoped issue fetch, issue detail API, add-message API, status update API, resolve API, and close API.

- `src/ondc/models/customerTicket.model.ts`
  Added a new model for `ondc_customer_ticket` with `findByTicketId`, `upsert`, `listAll`, `listByProvider`, and `listByStatus`.

- `src/ondc/models/issue.model.ts`
  Added `IssueDisplayStatus` and `OndcIssueAction` types plus new helpers: `findById`, `createIfMissing`, `parseActions`, and `appendAction`.

- `src/ondc/models/provider.model.ts`
  Extended provider queries and mapping to include seller name, seller email, seller phone, and business name from joined user and seller profile data.

- `src/ondc/routes/admin.route.ts`
  Registered new admin routes for issue detail/actions and customer ticket endpoints.

- `src/ondc/services/igm.service.ts`
  Major implementation update:
  normalized inbound issue payloads,
  derived refs/actors/actions when missing,
  enriched issues using provider and seller context,
  extracted descriptor attachments,
  persisted customer ticket records,
  rebuilt `on_issue` callback payloads from stored ticket data,
  and inserted outbound transaction logs for `on_issue` and `on_issue_status`.

- `implimentation.md`
  Add a new file where all data will be stored that what changes we are done and why.
