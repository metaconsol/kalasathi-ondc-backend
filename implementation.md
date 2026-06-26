## Branch-013

**Date:** 2026-06-25

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
