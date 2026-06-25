# ONDC ODOP — Implementation Plan & Status

> **Scope:** Full audit of the ONDC BPP in `ondc_odop/` (backend) and the admin UI in
> `odop_ui/src/pages/admin/ondc/`, measured against **ONDC API contract v1.2.5**
> (retail), **IGM 2.0.0**, and **PPF/NTS10 settlement**. Includes endpoint status,
> contract-compliance gaps, ONDC-workbench/Pramaan readiness, a UI enhancement plan,
> and a prioritized roadmap for a 3-person team.
>
> **Companion files (use to test in the workbench/Postman):**
>
> - `ONDC_v1.2.5_Workbench.postman_collection.json` — every endpoint + request body
> - `ONDC_v1.2.5_Workbench.postman_environment.json` — variables (base URLs, ids, INSECURE flag)
>
> _Generated 2026-06-24. Updated 2026-06-24 with real deployment facts: **already
> whitelisted on preprod** (all keys set in `.env`), **localhost signature bypass is
> intentional**, settlement is **PPF (not RSF)**, network role is **seller MSN**, testing
> = Pramaan + workbench (live) and Postman (local). Audited at branch `revert-pr-36`._

---

## 0. TL;DR — where we actually stand

**Onboarding is DONE.** The BPP is already whitelisted on **preprod**: subscriber id,
unique key id, base URI, Ed25519 sign keys, registry lookup URL and observability token are
all set in `.env`. So registry subscribe / site-verification is **no longer a blocker** —
it was completed (manually/out-of-band) during whitelisting. That changes the priority order:
the remaining work is **contract conformance so the Pramaan flows pass**, not onboarding.

**The order-creation path works end-to-end.** `search → select → init → confirm` build real
payloads from live DB data, sign them with Ed25519, POST callbacks to the BAP. Signature
**verification is real** (Ed25519 + BLAKE2b-512) and is correctly **bypassed only on localhost**
(`?insecure=1` when `NODE_ENV != production`) for Postman testing. The admin UI is functional
across 11 pages. Settlement uses **PPF** (ONDC:NTS10) — both PPF APIs exist. Role is **MSN**.

**What actually remains (in priority order):**

| #   | Gap                                                                | Impact on Pramaan/workbench                         | Effort |
| --- | ------------------------------------------------------------------ | --------------------------------------------------- | ------ |
| 1   | `cancellation_terms` never emitted on on_init/on_confirm           | Validation failure — Pramaan checks for it          | Low    |
| 2   | No fulfillment forward state machine (Packed→Picked→Delivered)     | Flow 1 can't complete delivery states via on_status | Medium |
| 3   | `/update` records but doesn't **enact** partial-cancel / returns   | Flow 3A & Flow 4 fail                               | Medium |
| 4   | Quote breakup has **no item-level GST tax**                        | Quote totals wrong; validation flags                | Low    |
| 5   | `/track` always `inactive` (nothing writes `tracking_url`)         | Flow 1 track step empty                             | Low    |
| 6   | Hardcoded literals in on_cancel ("Atta", area code, phone)         | Wrong data echoed                                   | Low    |
| 7   | `/on_receiver_recon` not signature-verified; PPF processing thin   | Settlement callback unauthenticated                 | Low    |
| 8   | IGM on_issue emits empty `respondent_actions` (not 2.0.0-complete) | IGM flow incomplete                                 | Medium |

**Config to VERIFY (not build):** preprod process must run with `NODE_ENV=production` so the
localhost bypass is OFF in preprod. That's the only onboarding-era risk left.

Read §3 (endpoint status), §4 (contract gaps), §5 (preprod readiness), §7 (UI/data), §8 (roadmap).

---

## 1. Architecture recap (so all 3 of us share the model)

- We are the **BPP** (seller app). The ONDC **workbench / Pramaan** plays the **BAP**
  (buyer app). It POSTs signed Beckn requests to our `/api/v1/ondc/<action>` endpoints.
- Every action is a **two-message pattern**: we **ACK synchronously**, then
  `setImmediate(...)` builds the real answer and POSTs `on_<action>` to `{bap_uri}/<action>`.
- `context.core_version` is **echoed** from the incoming request (`buildResponseContext`
  in [src/ondc/utils/payload.builder.ts](src/ondc/utils/payload.builder.ts#L28)). So if
  the workbench sends `1.2.5`, we reply `1.2.5`. We never assert the version ourselves —
  this is correct Beckn behavior.
- Single DB `final_ondc_odop_db` (prod) / `ondc_odop_db` (dev). Every store is a provider
  (`provider_id = String(stores.id)`). No catalog cache — `/on_search` builds live.

---

## 2. Folder map (what each layer does)

```
src/ondc/
  routes/        beckn.route.ts (network) · admin.route.ts (JWT) · index.ts (mount) · test.route.ts
  controllers/
    beckn/       search select init confirm status track cancel update rating  ← network handlers
    admin/       catalog orders providers logs transactions request_monitor settlements stats issues
    issue.controller.ts · ppf.controller.ts · recon.controller.ts · webhook.controller.ts
  services/      catalog beckn(sign+send) order fulfillment payment settlement ppf igm registry webhook observability
  adapters/      product(variant expansion) seller(stores→provider) order user
  flows/         flow1A/3A/3B/3C/4A/4B/7 + generators/   ← MOSTLY DEAD CODE (see §4)
  models/        order issue ppf settlement transaction log provider fulfillment bap_terms overall_txns
  utils/         payload.builder · catalog.builders · signature.util · logger · helpers · error.handler
  middleware/    ondcAuth(signature) · ondcValidator(context) · ondcLogger
  config/        domain.config(RET10/12/16) · network.config · constants
  db/            schema.sql · migrations/001_setup_ondc.sql
```

---

## 3. Endpoint inventory & status

### 3.1 Network-facing Beckn endpoints (`/api/v1/ondc/*`)

Legend: ✅ working · 🟡 partial · 🟥 stub/broken · ⬜ not created

| #   | Endpoint                  | Callback        | Status | Notes                                                                                                                                                                                   |
| --- | ------------------------- | --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /search`            | on_search       | ✅     | Live catalog from `stores→products→variants`. Domain gate NACKs bad domains.                                                                                                            |
| 2   | `POST /select`            | on_select       | ✅     | Real quote/breakup. OOS path → DOMAIN-ERROR 40002 (Flow 2 ✅).                                                                                                                          |
| 3   | `POST /init`              | on_init         | 🟡     | Works, but **no `cancellation_terms`**; quote has **no item-level tax**; dead `ondc_catalog_items` fallback.                                                                            |
| 4   | `POST /confirm`           | on_confirm      | ✅     | Most complete: persists order atomically, full payment+settlement+bpp_terms/bap_terms. Idempotent on duplicate. Still no `cancellation_terms`, no item tax.                             |
| 5   | `POST /status`            | on_status       | 🟡     | Reports `dbOrder.status` faithfully, but **no forward fulfillment state machine** (Packed→Picked→Delivered).                                                                            |
| 6   | `POST /track`             | on_track        | 🟡     | Effectively a stub — `tracking_url` is never written by any flow, so always `inactive`.                                                                                                 |
| 7   | `POST /cancel`            | on_cancel       | ✅     | Elaborate: Cancel fulfillment, quote_trail, refund, reason. Has many **hardcoded fallbacks** ("Atta", "560037", phone) to clean up.                                                     |
| 8   | `POST /update`            | on_update       | 🟡     | **Records** the partial-cancel/return action to `ondc_order_actions` but **does not enact** it (no qty mutation, no refund quote_trail, no Return fulfillment). Flow 3A & 4 incomplete. |
| 9   | `POST /rating`            | on_rating       | 🟡     | Spec-minimal (`message:{}` is valid). No `feedback_form`. Persists to `ondc_ratings` (table may not exist).                                                                             |
| 10  | `POST /issue`             | on_issue        | 🟡     | IGM persists issue but emits **empty `respondent_actions`**, no GRO/`respondent_info`, no NACK on bad payload. Not 2.0.0-complete.                                                      |
| 11  | `POST /issue_status`      | on_issue_status | 🟡     | Returns stored status only; no resolution provider/actions/escalation.                                                                                                                  |
| 12  | `POST /on_receiver_recon` | —               | 🟡     | Inbound PPF settlement persists `recon_accord` only; **NOT signature-verified**; no diff/dispute logic.                                                                                 |

> **Onboarding endpoints (`/on_subscribe`, `ondc-site-verification.html`): NOT NEEDED as a
> build task** — the BPP is already whitelisted on preprod (keys in `.env`). Only revisit if
> you later rotate keys or move to prod, where a re-subscribe may be required.

**Beckn scorecard: 4 ✅ · 7 🟡 · 0 🟥** (onboarding complete — whitelisted on preprod)

### 3.2 Admin endpoints (`/api/v1/ondc/admin/*`, JWT-protected) — all ✅

`GET /dashboard/stats` · `GET /catalog/debug` · `GET /catalog/items/:providerId` ·
`GET /orders` · `GET /orders/:orderId` · `POST /orders/:orderId/fulfillment` ·
`GET /providers` · `GET /providers/:providerId` · `PATCH /providers/:providerId/toggle` ·
`GET /ppf` · `GET /ppf/order/:orderId` · `POST /ppf/trigger` ·
`GET /logs` · `DELETE /logs` · `GET /logs/:transactionId` ·
`GET /transactions` · `DELETE /transactions` ·
`GET /request-monitor/counts` · `GET /request-monitor` · `GET /request-monitor/:transactionId` ·
`GET /issues`

All 21 are implemented and back the React UI. (Note: the old `catalog/sync`,
`catalog/rejections`, `providers POST` endpoints in the **old** Postman collection were
removed — don't reintroduce them.)

### 3.3 Supporting services status

| Service                                                        | Status                | Notes                                                                                                                                                                               |
| -------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature verify (`ondcAuth` + `signature.util`)               | ✅ real               | Ed25519 + BLAKE2b-512, enforced on all Beckn routes. `?insecure=1` bypass is **intentional, localhost-only** (only when `NODE_ENV!=production`). Digest header not checked (minor). |
| Registry **lookup** (`registry.service`)                       | ✅                    | Signed lookup + 10-min cache. Used to fetch BAP public keys.                                                                                                                        |
| Registry **subscribe / on_subscribe**                          | ✅ done (out-of-band) | **Already whitelisted on preprod** — keys present in `.env`. No in-code subscribe needed unless rotating keys / moving to prod.                                                     |
| Catalog build (`catalog.service`)                              | ✅                    | Live build, used by /search and admin viewer. MSN multi-seller.                                                                                                                     |
| Order persistence (`order.service`/`order.model`)              | ✅                    | Atomic insert of order/items/fulfillments.                                                                                                                                          |
| **PPF API 1 — outbound `recon`** (`ppf.service.sendRecon`)     | ✅ present            | BPP→BAP. NTS10 v2.0.0, signed, POSTs to `{bap_uri}/recon`, recorded to `ondc_ppf_recon`. Triggered by admin `/ppf/trigger`. Gap: TCS/TDS hardcoded `0.00`.                          |
| **PPF API 2 — inbound `on_receiver_recon`** (`ppf.controller`) | 🟡 present, thin      | BAP→BPP. ACKs + persists `recon_accord` only. Gaps: **not signature-verified**; no expected-vs-reported diff/dispute logic.                                                         |
| Legacy RSF settlement (`settlement.service`)                   | 🟥 dead               | We use **PPF, not RSF**. `processReceiverRecon`/`generateReconReport` are TODO no-ops. **Delete this parallel path** (and the admin "generate settlement" button that calls it).    |
| Payment (`payment.service`)                                    | 🟡                    | No gateway integration; COD assumed paid.                                                                                                                                           |
| Webhook (`webhook.service`/controller)                         | 🟥                    | Pass-through logging only, not wired.                                                                                                                                               |
| Flow services (`flows/*` + generators)                         | 🟥                    | **Dead code** — imported nowhere live, several `TODO: Implement`, reference old `core_version 1.2.0`.                                                                               |

---

## 4. v1.2.5 contract-compliance gaps (the punch list)

1. **`cancellation_terms` missing on on_init & on_confirm.** The `init` docstring claims
   "COMPLETE_CANCELLATION_TERMS (all 5 phases)" but that constant **does not exist**; the
   only defined one — `STANDARD_CANCELLATION_TERMS` ([payload.builder.ts:217](src/ondc/utils/payload.builder.ts#L217),
   4 phases) — is **imported by nobody**. Pramaan validates this. → wire it in.
2. **Quote has no item-level tax.** The per-item `tax` breakup is commented out in
   `buildQuote` ([catalog.builders.ts:511](src/ondc/utils/catalog.builders.ts#L511)); only a
   single fulfillment-level tax line (value 0) is emitted. `gst_percent` is fetched per row
   but unused. Delivery/packing/convenience hardcoded `0` in select. → emit GST breakup.
3. **No fulfillment forward state machine.** Nothing advances
   `Pending → Packed → Order-picked-up → Out-for-delivery → Order-delivered`. on_status just
   echoes `dbOrder.status`. → add a seller/admin-driven transition that on_status reads (the
   `POST /admin/orders/:id/fulfillment` endpoint is the natural hook — it already exists).
4. **`/update` doesn't enact.** Partial cancel (Flow 3A) and returns (Flow 4) are logged to
   `ondc_order_actions` but the on_update payload returns the order unchanged — no qty change,
   no refund `quote_trail`, no Return-type fulfillment, no liquidated/return states.
5. **`track` always inactive.** No code writes `tracking_url`. → populate it on the
   fulfillment-update action.
6. **Dead `ondc_catalog_items` fallback** in init & confirm (`resolveFallbackCatalogRow`) — that
   table was dropped. If `resolveOndcCatalogRow` misses, the line silently drops. → remove the
   dead fallback or repoint it at the live builder.
7. **Hardcoded literals in on_cancel** ("Atta", "560037", "Bengaluru", `9886098860`,
   `precancel_state.fulfillment_state = Order-picked-up`, `igm_request = Issue1`). → derive from DB.
8. **IGM not 2.0.0-complete** — empty `respondent_actions`, no `respondent_info`/GRO, no NACK on
   malformed payload, status enum missing `ESCALATED`.
9. **MSN payment/settlement tags** at provider level in on_search are thin (only
   `np_type=MSN` + `accept_bap_terms`); per-provider `@ondc/org/payments` finder-fee/SETTLEMENT
   tags are not emitted.

**Note on `flows/`:** these were an earlier scaffold (Flow 1A/3A/3B/3C/4A/4B/7 + generators).
They are **not on the live request path** and reference `core_version 1.2.0`. Decide: either
finish & wire them (they encode the exact state sequences Pramaan expects) or delete them so
nobody mistakes them for live code. **Recommendation: harvest the state sequences from the
generators, then wire them into status/cancel/update; delete the rest.**

---

## 5. Preprod readiness (Pramaan + workbench)

**Onboarding is already done — whitelisted on preprod, all keys in `.env`.** So this section is
no longer about getting whitelisted; it's about making the **Pramaan flows pass** and keeping
signature enforcement correct now that we're network-facing.

### 5.1 Signature enforcement — configuration check (no build)

- The `?insecure=1` bypass in [ondcAuth.middleware.ts:27](src/ondc/middleware/ondcAuth.middleware.ts#L27)
  is **intentional and correct for localhost Postman testing** (only fires when `NODE_ENV != production`).
- **The one thing to VERIFY:** the **preprod** process must run with **`NODE_ENV=production`** so
  the bypass is OFF there and all inbound Beckn requests are signature-verified. (Optional hardening:
  gate the bypass behind an explicit `ONDC_ALLOW_INSECURE=1` env flag so it can never be on by accident.)
- Minor hardening (not blocking): call `verifyDigestHeader` (exists in `signature.util.ts`, never
  invoked) in the middleware; sign-verify `/on_receiver_recon` (currently skips `ondcAuthMiddleware`);
  confirm outgoing digest is BLAKE2b-512, not the SHA-256 fallback.

### 5.2 Testing setup (matches your workflow)

- **Local:** Postman against `{{LOCAL_BASE}}` + `{{INSECURE}}` (`?insecure=1`) — no signing needed.
  The new collection's folder 1 already documents this; switch `ONDC_BASE` to `{{LOCAL_BASE}}`.
- **Live preprod:** **Pramaan + ONDC workbench** drive the signed flows against the whitelisted BPP URL.
  Postman is not used for signed preprod calls (it can't easily build the `Authorization` header).

### 5.3 Pre-flight checklist before a Pramaan run

- [ ] Preprod process started with `NODE_ENV=production` (bypass OFF, signatures enforced).
- [ ] BPP reachable + `subscribed` status confirmed via registry `/lookup` (already whitelisted).
- [ ] on_init & on_confirm emit `cancellation_terms`. _(gap #1)_
- [ ] Quote breakup includes item-level GST tax. _(gap #4)_
- [ ] Fulfillment state machine drives on_status forward states. _(gap #2)_
- [ ] on_update enacts partial-cancel / return. _(gap #3)_
- [ ] `/track` returns a real `tracking_url`. _(gap #5)_
- [ ] Hardcoded literals removed from on_cancel. _(gap #6)_
- [ ] PPF: trigger `recon` for a delivered order, confirm `on_receiver_recon` round-trips.
- [ ] Clock skew (`ONDC_HEADER_MAX_SKEW_SEC=300`) sane; server time NTP-synced.

---

## 6. Testing in the workbench / Postman

Import both companion files into Postman, select the **"ONDC ODOP — v1.2.5 (preprod)"**
environment, then:

**Local dev (no signing):** set `ONDC_BASE` = `{{LOCAL_BASE}}` and append `{{INSECURE}}`
(`?insecure=1`) to each path. Works only when `NODE_ENV != production`. Run the folder-1
requests in order: search → select → init → confirm (copy the returned `order.id` into the
`ORDER_ID` env var) → status → track → cancel/update → rating → issue.

**Against preprod (real signing):** the actual ONDC **workbench/Pramaan** signs requests for
you — you register your BPP URL there and it drives the flows. Postman can't easily produce a
valid ONDC `Authorization` header by hand, so use Postman for **local `?insecure=1` testing**
and for the **admin APIs**, and use the **workbench** for signed end-to-end runs.

The collection has 4 folders: **1.** network Beckn endpoints (with v1.2.5 bodies), **2.** admin
APIs (need `ADMIN_TOKEN` JWT), **3.** health/test, **4.** RET10/RET16 domain search examples.

> The old `ONDC_Postman_Collection.json` has mojibake (`â†'`, `â€"`) and references removed
> endpoints (`catalog/sync`, `catalog/rejections`, `providers POST`). Prefer the new files;
> delete the old one once you've confirmed the new collection covers your cases.

---

## 7. UI enhancement plan (`odop_ui/src/pages/admin/ondc/`)

All 11 pages are functional. The user's goal — _"data comes from the payload and should be
shown in the UI to build understanding"_ — is **half-met**: payloads are captured in the DB
but surfaced inconsistently. Most of the high-value wins need **no backend change** because the
data is already in existing API responses.

### 7.0 Is all essential data fetched from the DB to show in the UI?

**Short answer: the DB has it, the API returns it, but the UI drops a lot of it.** The data
pipeline (DB models → admin controllers → `ondc.api.ts` → page) is intact; the loss happens in
the last step (the page renders a subset of the JSON it already received).

| Data                                                                                        | In DB                    | Returned by API                      | Shown in UI                                        | Verdict                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Raw beckn request/response JSON (`ondc_txn_logs.payload_json`)                              | ✅                       | ✅ (`getLogs`, `getTransactionLogs`) | only on **Logs page**                              | **Under-surfaced** — transaction timeline fetches it but shows only action/ack/http |
| Order raw payloads (`raw_confirm_payload`, `billing_json`, `payment_json`, `raw_item_json`) | ✅                       | ✅ (`getOrder`)                      | parsed into fields; **raw JSON never shown**       | **Under-surfaced**                                                                  |
| Quote breakup / ttl / price                                                                 | ✅                       | ✅                                   | ✅ (OrderDetail)                                   | OK                                                                                  |
| PPF settlement (`settlements_json`, `recon_accord`)                                         | ✅                       | ✅                                   | settlements ✅; **`on_recon_payload` never shown** | **Partly hidden**                                                                   |
| IGM ticket payload                                                                          | ✅                       | ✅                                   | **`<pre>` block commented out** (Tickets ~622-629) | **Hidden — restore it**                                                             |
| Status timeline `from_status`                                                               | ✅                       | ✅                                   | only `to_status` shown                             | **Hidden field**                                                                    |
| Fulfillment `estimated/actual_delivery`                                                     | ✅                       | ✅                                   | used as fallback only                              | **Hidden field**                                                                    |
| Provider `short_desc`/`support_email`/`created_at`                                          | ✅                       | ✅                                   | only phone shown                                   | **Hidden field**                                                                    |
| Callback success/NACK/signature-failure metrics                                             | ✅ (derivable from logs) | ❌ no aggregate endpoint             | ❌                                                 | **Needs small new endpoint**                                                        |

So: **no data is missing from the DB.** ~90% of the UI gap is "render what we already fetched";
only the dashboard health metrics (callback success rate, NACK/signature failures) need a new
aggregate endpoint on `stats.controller.ts`.

### P0 — surface the raw payloads (no backend change)

1. **Extract a reusable `OndcPayloadViewer`** from `OndcLogsPage`'s dark JSON+copy viewer and reuse in:
   - `OndcTransactionsPage` timeline drawer (it fetches `getTransactionLogs` but only shows action/ack/http — `payload_json` is dropped).
   - `OndcOrderDetailPage` (raw confirm/billing/payment/item JSON are parsed but never shown).
   - `OndcTicketsPage` (the "Payload Data" `<pre>` is **commented out** at lines ~622-629 — restore it).
   - `OndcSettlementsPage` (`on_recon_payload` is in the type, never displayed).
2. **Request → callback diff view.** Pair each inbound action (`select`) with its outbound
   callback (`on_select`) from the same `transaction_id` and show a side-by-side JSON diff.
   Highest-value "understand the data" feature; both messages already in the log table.
3. **First-class transaction timeline route** (`/admin/ondc/transactions/:txnId`) — every action
   in order with direction, ACK/NACK, HTTP status, latency, error, and inline expandable payload.

### P1 — onboarding/testing dashboard (small backend aggregates)

4. **Callback health panel** — success rate (ACK vs NACK), NACK-by-action, HTTP-error count.
5. **Signature/auth-failure tile + Logs filter preset** — critical during preprod onboarding.
6. **Flow-completion funnel widget** — search→select→init→confirm drop-off (data already computed in `OndcTransactionsPage`).

### P2 — fill captured-but-hidden gaps

7. **Make `OndcSettingsPage` live** — replace static `import.meta.env` with `GET /admin/settings/health`
   returning registry/subscribe status, key-id presence, last successful callback time.
8. **Expand `OndcStatusBadge`** color map (`INITIATED`, `ACCORD`, `DISPUTE`, `IN_PROGRESS`,
   `WAITING_CUSTOMER`, `REJECTED`, `RETURNED`, fulfillment states) — many currently fall to grey.
9. **Show hidden fields** — `from_status` in timelines, `estimated/actual_delivery`,
   provider `short_desc`/`support_email`, full `buyer_err`.
10. **Catalog per-item "view ONDC item JSON"** expander — verify category_id/tags/attributes
    against the contract (ties to the category_id-taxonomy validation note).

> Verify and remove the `catalog_rejection` Request-Monitor tab — rejections were removed in the
> approach-1 refactor, so it's likely a dead tab.

---

## 8. Prioritized roadmap (3-person split)

Onboarding is done, so Phase 1 is **contract conformance to pass Pramaan flows**, not subscribe.
Suggested owners: **A** = backend/protocol, **B** = backend/flows+settlement, **C** = UI.

### Phase 0 — Config check (do today, 10 min)

| Task                                                                                                                                                  | Owner |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Confirm preprod runs with `NODE_ENV=production` (so `?insecure` bypass is OFF in preprod). Optionally gate the bypass behind `ONDC_ALLOW_INSECURE=1`. | A     |

### Phase 1 — Make the core Pramaan flows pass (Flow 1 + cancel)

| Task                                                                                                                                 | Owner | Files                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------- |
| Emit `cancellation_terms` on on_init & on_confirm (the claimed constant doesn't exist)                                               | B     | `payload.builder.ts`, `init.controller.ts`, `confirm.controller.ts`                           |
| Item-level GST tax in quote breakup; real delivery/packing charges (not hardcoded 0)                                                 | A     | `catalog.builders.ts`, `select.controller.ts`                                                 |
| Fulfillment forward state machine (Packed→Picked→Out-for-delivery→Delivered) driving on_status; populate `tracking_url` for on_track | B     | `status.controller.ts`, `orders.controller.ts` (`/fulfillment` hook exists), `order.model.ts` |
| Remove hardcoded literals in on_cancel; derive from DB                                                                               | A     | `cancel.controller.ts`                                                                        |
| Remove dead `ondc_catalog_items` fallback (table was dropped)                                                                        | A     | `init.controller.ts`, `confirm.controller.ts`                                                 |
| P0 payload viewer + request/callback diff + transaction timeline (no backend change)                                                 | C     | `odop_ui/.../ondc/*`, new `OndcPayloadViewer.tsx`                                             |

### Phase 2 — Cancel/return flows + settlement + dashboard

| Task                                                                                                                                                         | Owner | Files                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------- |
| Make `/update` **enact** partial-cancel (Flow 3A) + returns (Flow 4): qty mutation, refund `quote_trail`, Return-type fulfillment, return/liquidation states | B     | `update.controller.ts`, harvest sequences from `flows/generators/*` |
| PPF hardening: real TCS/TDS, settlement-window validation, `on_receiver_recon` diff/dispute logic, **sign-verify** the inbound route                         | B     | `ppf.service.ts`, `ppf.controller.ts`, `beckn.route.ts`             |
| Delete dead RSF path (`settlement.service` stubs + admin "generate settlement" button) — we use PPF                                                          | B     | `settlement.service.ts`, `settlements.controller.ts`                |
| Callback-health + NACK + **signature-failure** dashboard (new aggregate endpoint)                                                                            | A + C | `stats.controller.ts`, dashboard page                               |
| Surface hidden data: restore IGM payload `<pre>`, show raw order/recon JSON, `from_status`, delivery fields, provider fields                                 | C     | `odop_ui/.../ondc/*`                                                |

### Phase 3 — IGM completeness + polish

| Task                                                                                                   | Owner | Files                                         |
| ------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------- |
| IGM 2.0.0: populate `respondent_actions`/`respondent_info`/GRO, NACK on bad payload, escalation states | A     | `igm.service.ts`, `issue.model.ts`            |
| Decide `flows/`: harvest the state sequences (used in Phase 2), then **delete the dead scaffold**      | B     | `flows/**`                                    |
| Webhook stub: wire it or delete it                                                                     | B     | `webhook.service.ts`, `webhook.controller.ts` |
| Provider-level `@ondc/org/payments` finder-fee/SETTLEMENT tags in on_search (MSN)                      | A     | `catalog.builders.ts`                         |
| Minor signature hardening: `verifyDigestHeader`, BLAKE2b-512 outgoing digest                           | A     | `ondcAuth.middleware.ts`, `signature.util.ts` |
| Live settings page, status-badge map, remove dead `catalog_rejection` tab                              | C     | `odop_ui/.../ondc/*`                          |
| Delete old mojibake `ONDC_Postman_Collection.json`; keep new v1.2.5 files                              | any   | repo root                                     |

---

## 9. "Done" definition (per CLAUDE.md §11)

- Backend `tsc --noEmit` clean (ignore Prisma `#private` warnings); `npm run build` produces fresh `dist/main.js`.
- DB changes are idempotent additions to `001_setup_ondc.sql`; regenerate `schema.sql` via `mysqldump --no-data`.
- UI `tsc --noEmit` exit 0; no new `staleTime:0` queries on heavy endpoints.
- Each Pramaan flow passes with **signatures enforced** (not `?insecure`).
- Update this file + `implementation.md` per change (the team already logs BRANCH-00x entries there).
