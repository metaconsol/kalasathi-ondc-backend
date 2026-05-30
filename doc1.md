# ONDC Integration — Developer Handover (doc1)

This document explains the ONDC Beckn BPP that was built on top of the existing
ODOP storefront. It is written for the **UI and backend developers** taking over
the project. Read it top-to-bottom once and you'll understand the folder layout,
what was added to the database, where every piece of ONDC data lives, and how a
full request flows through the code.

---

## 0. The 10,000-foot view

ONDC (Open Network for Digital Commerce) is a government network where **buyer
apps (BAP)** — like Paytm, PhonePe, or the ONDC test tool "Pramaan" — send
standardized "Beckn protocol" requests to **seller apps (BPP)**. Our project is
the **BPP**: it receives those requests, builds responses from ODOP store/product
data, cryptographically signs them, and sends them back.

```
   Buyer App (BAP)                       OUR SERVER (BPP)
   e.g. Pramaan / Paytm                  preprod.odopmartmp.com
        │                                       │
        │  POST /search  (signed)               │
        ├──────────────────────────────────────▶│  1. verify signature
        │                                        │  2. ACK instantly
        │◀───────── ACK {status:ACK} ───────────┤
        │                                        │  3. build catalog (async)
        │                                        │  4. sign + POST back
        │◀────────  POST /on_search  ────────────┤
        │   ACK                                  │
        ├───────────────────────────────────────▶
```

Every Beckn action follows this **two-message pattern**: an instant `ACK`
(synchronous) followed by the real answer sent as a _separate_ callback request
(`on_search`, `on_select`, `on_confirm`, …) a moment later.

### Two servers, two databases (important)

| Server         | Domain                    | Repo                    | Database            | Purpose                                                                                            |
| -------------- | ------------------------- | ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| Storefront API | `test-api.odopmartmp.com` | `odop_backend`          | `new_odop_db`       | The existing e-commerce backend. **Do not touch for ONDC.**                                        |
| ONDC BPP       | `preprod.odopmartmp.com`  | `ondc_odop` (this repo) | `live_ondc_odop_db` | Receives ONDC traffic + serves the ONDC admin panel.                                               |
| Shared UI      | `test.odopmartmp.com`     | `odop_ui`               | —                   | One React app. ONDC admin pages call the ONDC server; everything else calls the storefront server. |

The two databases are **intentionally separate**. All ONDC code reads/writes
`live_ondc_odop_db` **only**, through one connection pool (`ONDC_DB_URL` in
`.env`). It never touches `new_odop_db`.

---

## 1. Folder structure (`src/ondc/`)

Everything ONDC lives under `src/ondc/`. The rest of `src/` is the storefront app
(mostly untouched). Here is what each folder does:

```
src/ondc/
├── routes/        URL → controller wiring (which path runs which handler)
├── middleware/    Runs BEFORE every Beckn controller: log → validate → verify signature
├── controllers/   Request handlers. Two groups:
│   ├── beckn/       One file per ONDC action the network calls (search, select, confirm…)
│   └── admin/       REST APIs the admin UI calls (orders, catalog, logs, providers…)
├── services/      Business logic / external calls (build catalog, send callbacks, registry lookup…)
├── models/        Database access — one file per table group (raw SQL via the ONDC pool)
├── adapters/      Translate storefront rows (stores/products) → ONDC shapes
├── utils/         Signing, payload builders, logging, helpers
├── config/        Constants, domain profiles, network URLs
├── flows/         Multi-step seller-side order flows (ship → deliver → cancel → return)
├── types/         TypeScript interfaces for Beckn / ONDC payloads
└── db/            schema.sql (full dump) + migrations/001_setup_ondc.sql
```

### What each folder contains, in plain terms

| Folder                 | Contains / does                                                                                                                                                                                                             | Key files                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **routes/**            | Maps a URL like `/search` to its handler and chains the middleware.                                                                                                                                                         | `beckn.route.ts` (network endpoints), `admin.route.ts` (admin UI APIs), `index.ts` (mounts both)        |
| **middleware/**        | Three gates every inbound Beckn request passes, in order: **1)** log the request, **2)** validate the context (domain, version, required fields), **3)** verify the Ed25519 signature against the buyer's public key.       | `ondcLogger.middleware.ts`, `ondcValidator.middleware.ts`, `ondcAuth.middleware.ts`                     |
| **controllers/beckn/** | The actual handler for each ONDC action. Each one: ACKs instantly, then asynchronously builds + signs + sends the `on_*` callback.                                                                                          | `search.controller.ts`, `select.controller.ts`, `confirm.controller.ts`, …                              |
| **controllers/admin/** | Plain REST endpoints the ONDC admin UI calls to view orders, the live catalog, logs, providers, settlements, tickets. Read-only mostly.                                                                                     | `orders.controller.ts`, `catalog.controller.ts`, `logs.controller.ts`, `request_monitor.controller.ts`  |
| **services/**          | The "verbs." `catalog.service` builds the `/on_search` catalog live; `beckn.service` signs + POSTs outgoing callbacks; `registry.service` fetches buyer public keys; `observability.service` pushes logs to ONDC analytics. | `catalog.service.ts`, `beckn.service.ts`, `registry.service.ts`                                         |
| **models/**            | All SQL lives here — one module per table family. Controllers/services never write SQL inline; they call these.                                                                                                             | `order.model.ts`, `transaction.model.ts`, `log.model.ts`, `bap_terms.model.ts`, `overall_txns.model.ts` |
| **adapters/**          | Convert a storefront row into an ONDC object. e.g. a `stores` row → an ONDC "provider", a `products`+`product_variants` row → an ONDC "item".                                                                               | `product.adapter.ts` (item building), `seller.adapter.ts` (store/location), `provider.model.ts`         |
| **utils/**             | Cross-cutting helpers. **signature.util** (sign/verify), **payload.builder** (wrap every response in the correct context envelope), **catalog.builders** (assemble catalog pieces), **logger.util** (file logs).            | `signature.util.ts`, `payload.builder.ts`, `catalog.builders.ts`, `logger.util.ts`                      |
| **config/**            | Static configuration: supported domains/versions, network URLs + timeouts, seller profile constants pulled from `.env`.                                                                                                     | `constants.ts`, `domain.config.ts`, `network.config.ts`                                                 |
| **flows/**             | Seller-initiated order lifecycle sequences (Pramaan test "flows"): ship the order, mark delivered, cancel, return. Each generates the `on_status`/`on_update`/`on_cancel` payloads for that step.                           | `flow1A.service.ts`, `flow3A.service.ts`, `flows/generators/*`                                          |
| **types/**             | Pure TypeScript types for Beckn context, ONDC items, orders, API responses. No logic.                                                                                                                                       | `beckn.types.ts`, `ondc.types.ts`, `catalog.types.ts`                                                   |
| **db/**                | The database source-of-truth: `schema.sql` (full dump) and the one idempotent migration.                                                                                                                                    | `db/migrations/001_setup_ondc.sql`                                                                      |

> Outside `src/ondc/`, one file matters: **`src/app.ts`** has a small middleware
> that rewrites bare Beckn paths (`POST /search`) to the real route
> (`POST /api/v1/ondc/search`). ONDC sends to the bare domain; this lets it reach
> our handlers. (See §5.)

---

## 2. Database — what was added

The ONDC database (`live_ondc_odop_db`) is a copy of the storefront schema **plus**
ONDC tables and a few new columns. Everything is applied by one idempotent script:

```
src/ondc/db/migrations/001_setup_ondc.sql
```

It is safe to re-run — every step checks "does this already exist?" first. It does
two things:

### 2a. Adds 6 columns to `store_locations` ⚠️ (action needed from storefront devs)

This is the **one place the storefront team must adapt**. We added new columns to
`store_locations` with ONDC-friendly names/types, and **backfilled them once** from
the old columns. But going forward, **new store data must populate the new
columns** — the old columns are not read by ONDC.

| New column (ONDC reads this) | Type     | Old/legacy column it was backfilled from                       | Meaning                                            |
| ---------------------------- | -------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `radius_km`                  | INT      | `radius` (was in **meters** → ÷1000)                           | Delivery serviceability radius, in **kilometers**  |
| `time_from`                  | SMALLINT | `opening_time`                                                 | Store open time as **HHMM** (e.g. `900` = 09:00)   |
| `time_to`                    | SMALLINT | `closing_time`                                                 | Store close time as **HHMM** (e.g. `2100` = 21:00) |
| `day_from`                   | TINYINT  | (defaulted to `1`)                                             | First working day, `1`=Mon … `7`=Sun               |
| `day_to`                     | TINYINT  | (defaulted to `7`)                                             | Last working day                                   |
| `fulfillment_type`           | VARCHAR  | `location_type` (`SELF_PICKUP`→`Self-Pickup`, else `Delivery`) | How orders ship from this location                 |

**What the storefront UI/backend team needs to do:**

1. **When a seller saves a store location**, write to the **new** columns:
   `radius_km` (in km, not meters), `time_from`/`time_to` (HHMM integers like
   `900`/`2100`), `day_from`/`day_to` (1–7), and `fulfillment_type`
   (`"Delivery"` or `"Self-Pickup"`).
2. **Add UI fields** for these on the store-location form (open time, close time,
   working days, delivery radius in km, fulfillment type). Today only the legacy
   fields have inputs; the ONDC columns will stay empty for any _new_ location
   until the UI collects them.
3. The one-time backfill already populated existing rows, so current stores work.
   It's only **new/edited** locations that need the new fields filled.

> Why we did this: ONDC needs radius in km, times as HHMM, and explicit
> working-days/fulfillment-type — shapes the legacy columns didn't carry. Rather
> than convert on every request, we store them ONDC-ready.
>
> Where it's read: [src/ondc/adapters/seller.adapter.ts](src/ondc/adapters/seller.adapter.ts)
> (`fetchStoreLocations` → `mapStoreLocationToOndcLocation`).

### 2b. Creates ONDC runtime tables

All `CREATE TABLE IF NOT EXISTS`. These hold ONDC transaction/order/issue data and
are **separate** from the storefront's own `orders`/`products` tables.

| Table                       | Holds                                                                                                                      | Written by                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `ondc_txn_logs`             | **Every** inbound + outbound Beckn message (full JSON payload, HTTP status, ACK/NACK). The single source of network truth. | every controller + logger middleware |
| `ondc_transactions`         | One row per transaction_id with its current phase (SEARCH→SELECT→INIT→CONFIRM…).                                           | every controller                     |
| `overall_txns`              | Funnel/analytics row per transaction: which `on_*` callbacks fired, order amount, payment, status. Powers the dashboard.   | every controller                     |
| `bap_terms`                 | Buyer-app terms (finder fee %, static terms URL) captured from `/search`.                                                  | `search.controller`                  |
| `ondc_orders`               | The confirmed ONDC order header (totals, customer, payment, status).                                                       | `confirm.controller`                 |
| `ondc_order_items`          | Line items of each ONDC order.                                                                                             | `confirm.controller`                 |
| `ondc_fulfillments`         | Per-order fulfillment/shipment state (AWB, courier, tracking, delivery state).                                             | `confirm` + flow services            |
| `ondc_order_status_history` | Audit trail of every status change on an order.                                                                            | `order.model.transitionStatus`       |
| `ondc_order_actions`        | Partial-cancel / return actions on an order.                                                                               | `update`/`cancel` flows              |
| `ondc_issues`               | IGM (grievance) issues raised by buyers.                                                                                   | `issue.controller`                   |
| `ondc_customer_ticket`      | Detailed IGM ticket records (rich issue metadata).                                                                         | `igm.service`                        |
| `ondc_ratings`              | Buyer ratings for order/item/provider.                                                                                     | `rating.controller`                  |
| `ondc_ppf_recon`            | Payment-protection-framework reconciliation records.                                                                       | `ppf.service`                        |
| `ondc_settlements`          | Settlement/recon detail (commission, TCS, TDS, payouts).                                                                   | `settlement.service`                 |
| `ondc_rsf`                  | Reconciliation-and-settlement-framework rollup.                                                                            | `settlement.service`                 |
| `ondc_errors`               | Structured error log (optional).                                                                                           | error handler                        |
| `ondc_catalog_items`        | _(legacy/unused)_ — old catalog cache. We build the catalog live now; this table is not read.                              | —                                    |
| `ondc_catalog_rejections`   | _(legacy/unused)_ — old catalog-rejection flow.                                                                            | —                                    |
| `ondc_attribute_rules`      | _(reference/unused at runtime)_ — category attribute rules.                                                                | —                                    |

> **Redundant tables you can ignore (or drop):** `ondc_catalog_items`,
> `ondc_catalog_rejections`, `ondc_attribute_rules`, `ondc_errors`. They are
> created for parity with the schema dump but no live code path depends on them.
> The catalog is built fresh on every `/search` (see §4).

---

## 3. Where is each kind of ONDC data stored?

Quick "I'm looking for X, which table?" reference:

| You want to see…                                    | Look in table                                    | Notes                                                                                        |
| --------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Raw request/response of any Beckn call              | `ondc_txn_logs`                                  | filter by `transaction_id`; `direction` = inbound/outbound, `payload_json` has the full body |
| Whether a transaction reached search/select/confirm | `overall_txns`                                   | one row per `txn_id`, boolean-ish `on_search`, `on_select`, … columns                        |
| Current phase of a transaction                      | `ondc_transactions`                              | `status` enum                                                                                |
| A placed order (totals, customer, payment)          | `ondc_orders`                                    | keyed by `ondc_order_id`                                                                     |
| Items inside an order                               | `ondc_order_items`                               | FK `ondc_order_id`                                                                           |
| Shipment / delivery state                           | `ondc_fulfillments`                              | AWB, courier, state                                                                          |
| Order status changes over time                      | `ondc_order_status_history`                      | audit trail                                                                                  |
| Buyer finder-fee / terms                            | `bap_terms`                                      | keyed by `bap_id`                                                                            |
| Grievances / issues                                 | `ondc_issues`, `ondc_customer_ticket`            | IGM                                                                                          |
| Settlement / money reconciliation                   | `ondc_settlements`, `ondc_ppf_recon`, `ondc_rsf` | PPF/RSF                                                                                      |
| **The product catalog sent to buyers**              | **nowhere — built live**                         | assembled per request from `stores`+`products`+`product_variants`; see §4                    |
| Provider list (= your stores)                       | `stores` (storefront table)                      | `provider_id` is just `String(stores.id)`; no separate ONDC providers table                  |

There is also a **file log** mirror under `logs/ondc/` (human-readable):
`search_incoming.log`, `search_outgoing.log`, `confirm_incoming.log`, …, plus
`catalog.log` (full catalog, de-duplicated) and `app_error.log`. These are easier
to read than the DB during debugging.

---

## 4. The catalog is built live (no cache table)

When a buyer searches, we do **not** look up a stored catalog. We walk the
storefront tables every time and assemble the ONDC catalog on the fly:

```
stores (is_active=1)              → ONDC providers
  └─ store_locations              → provider locations (uses the new columns from §2a)
  └─ products (publish_status)    → ONDC items
       └─ product_variants        → one ONDC item per leaf variant
       └─ product_ondc_attributes → ONDC attributes/tags
       └─ product_images          → item images
```

Entry point: [src/ondc/services/catalog.service.ts](src/ondc/services/catalog.service.ts)
(`buildSearchCatalog`). The same function powers the admin "Catalog" preview page,
so what admins see is exactly what buyers get.

---

## 5. Full example — a `/search` request, file by file

This is the most important section: it traces one real request end-to-end and
names the exact file where the header is built, signed, the payload assembled, and
sent. Every other action (`select`, `confirm`, …) follows the same shape.

### The request arrives

```
POST https://preprod.odopmartmp.com/search          ← ONDC posts to the BARE domain
Authorization: Signature keyId="...",signature="..."  ← buyer's Ed25519 signature
Body: { context:{ action:"search", domain:"ONDC:RET16", core_version:"1.2.0", ... },
        message:{ intent:{ ... } } }
```

### Step 0 — Path rewrite — [`src/app.ts`](src/app.ts)

ONDC posts to `/search`, but our routes live under `/api/v1/ondc/search`. A tiny
middleware rewrites the URL internally (not an HTTP redirect):

```ts
// app.ts — if path is a Beckn action, prepend /api/v1/ondc
if (BECKN_ACTIONS.has(action)) req.url = `/api/v1/ondc${req.url}`;
```

### Step 1 — Routing — [`src/ondc/routes/beckn.route.ts`](src/ondc/routes/beckn.route.ts)

The route wires three middleware **then** the controller:

```ts
const becknMiddleware = [ondcRequestLogger, ondcContextValidator, ondcAuthMiddleware];
router.post('/search', ...becknMiddleware, handleSearch);
```

### Step 2 — Log the request — [`middleware/ondcLogger.middleware.ts`](src/ondc/middleware/ondcLogger.middleware.ts)

Writes the full inbound request (headers + body) to `logs/ondc/search_incoming.log`
and inserts a row into `ondc_txn_logs`. It also hooks `res.json` so the sync ACK
that goes back is captured in the same log block.

### Step 3 — Validate context — [`middleware/ondcValidator.middleware.ts`](src/ondc/middleware/ondcValidator.middleware.ts)

Checks required `context` fields exist, the `domain` is supported, and
`core_version` is one of the accepted versions (`1.2.0` **or** `1.2.5`). If not →
instant `NACK` and the request stops here.

### Step 4 — Verify the signature — [`middleware/ondcAuth.middleware.ts`](src/ondc/middleware/ondcAuth.middleware.ts)

This is where **incoming** auth happens:

1. Parse the `Authorization` header → extract `subscriber_id` + `unique_key_id`.
2. Fetch that buyer's **public key** from the ONDC registry —
   [`services/registry.service.ts`](src/ondc/services/registry.service.ts). The
   registry lookup is itself a **signed** request (we sign it with our own key, via
   `signRequest` + `bodyDigest`), and the response is cached 10 min.
3. Verify the Ed25519 signature over the request body —
   [`utils/signature.util.ts`](src/ondc/utils/signature.util.ts) (`verifySignature`).
4. If invalid → `NACK`. If valid → `next()` to the controller.

### Step 5 — The controller — [`controllers/beckn/search.controller.ts`](src/ondc/controllers/beckn/search.controller.ts)

The controller does the **two-message pattern**:

```ts
// (a) Synchronous ACK — sent immediately, body built by payload.builder
res.status(200).json(buildAck(ctx));

// (b) Everything else runs AFTER the response is flushed:
setImmediate(async () => {
  // log inbound, upsert bap_terms, upsert ondc_transactions + overall_txns
  const catalog = await catalogService.buildSearchCatalog(ctx.domain); // §4
  const onSearchPayload = buildOnSearch(ctx, catalog); // wrap in context
  const url = becknService.buildCallbackUrl(bapUri, 'on_search'); // bap_uri + /on_search
  await becknService.sendCallback(url, 'on_search', onSearchPayload, txnId);
});
```

- **`buildAck` / `buildOnSearch`** — [`utils/payload.builder.ts`](src/ondc/utils/payload.builder.ts).
  This is where the **response `context` envelope** is created. It mirrors the
  incoming context exactly, swaps `action`→`on_search`, adds our `bpp_id`/`bpp_uri`,
  refreshes `timestamp`, and **echoes the incoming `core_version`** (so a `1.2.0`
  search gets a `1.2.0` `on_search`).

### Step 6 — Sign & send the callback — [`services/beckn.service.ts`](src/ondc/services/beckn.service.ts)

This is where **outgoing** auth happens — the `on_search` we send back is signed:

```ts
const bodyJson = JSON.stringify(payload);
const digest = bodyDigest(bodyJson); // BLAKE-512 digest   (signature.util)
const authHeader = signRequest(bodyJson); // Ed25519 Authorization header (signature.util)

axios.post(callbackUrl, payload, {
  headers: { 'Content-Type': 'application/json', Digest: digest, Authorization: authHeader },
});
```

- **`signRequest` / `bodyDigest`** live in
  [`utils/signature.util.ts`](src/ondc/utils/signature.util.ts). This is the single
  place all **outgoing** ONDC signatures are produced. It uses our private key from
  `.env` (`BPP_SIGN_PRIV_KEY`), BLAKE-512 for the digest, and a 40-minute validity
  window — matching the ONDC spec / PHP reference exactly.
- The call retries 3× and the full outgoing request (our headers + body + the
  BAP's response) is written to `logs/ondc/search_outgoing.log`. For `on_search`
  the big catalog body is logged once in `catalog.log` and shown as `catalog:{}`
  in the outgoing log to keep it readable.

### Step 7 — Record the result

Back in the controller, the outbound `on_search` is logged to `ondc_txn_logs`
(`direction='outbound'`, with the BAP's HTTP status + ACK/NACK), `overall_txns` is
patched (`on_search=1`), and the payload is pushed to ONDC observability.

### One-line summary of "who does what"

| Concern                                       | File                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bare-path → real route rewrite                | `src/app.ts`                                                                                     |
| Route → middleware → handler wiring           | `routes/beckn.route.ts`                                                                          |
| File + DB logging of the request              | `middleware/ondcLogger.middleware.ts`                                                            |
| Context/version validation                    | `middleware/ondcValidator.middleware.ts`                                                         |
| **Incoming** signature verification           | `middleware/ondcAuth.middleware.ts` + `services/registry.service.ts` + `utils/signature.util.ts` |
| Per-action handler (ACK + async)              | `controllers/beckn/<action>.controller.ts`                                                       |
| **Response context envelope (payload build)** | `utils/payload.builder.ts`                                                                       |
| Catalog assembly (for on_search)              | `services/catalog.service.ts` + `adapters/*` + `utils/catalog.builders.ts`                       |
| **Outgoing** signing + HTTP send              | `services/beckn.service.ts` + `utils/signature.util.ts`                                          |
| SQL persistence                               | `models/*.model.ts`                                                                              |

---

## 6. Configuration (`.env`)

The ONDC server is configured entirely from `.env`. The keys that matter:

| Key                                      | What it is                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `ONDC_DB_URL`                            | Connection string for `live_ondc_odop_db`. **All ONDC SQL uses this pool only.** |
| `BPP_SUBSCRIBER_ID`                      | Our network ID, e.g. `preprod.odopmartmp.com`. Must match the ONDC registry.     |
| `BPP_UNIQUE_KEY_ID`                      | Our key ID registered with ONDC.                                                 |
| `BPP_BASE_URI`                           | Public HTTPS base the network calls back, e.g. `https://preprod.odopmartmp.com`. |
| `BPP_SIGN_PRIV_KEY` / `BPP_SIGN_PUB_KEY` | Our Ed25519 signing keypair (base64). Private key signs every outgoing payload.  |
| `ONDC_REGISTRY_LOOKUP_URL`               | Where we fetch buyer public keys (preprod vs prod registry).                     |
| `ONDC_ENVIRONMENT`                       | `preprod` or `prod` — picks the gateway/registry.                                |
| `ONDC_ENABLED`                           | `false` disables all ONDC routes (kill switch).                                  |
| `ONDC_SELLER_*`                          | Seller profile shown in the catalog (brand name, support phone/email, address).  |

> Loaded and validated in [`src/config/ondc.config.ts`](src/config/ondc.config.ts).
> Missing a _required_ key throws on boot — that's intentional.

---

## 7. Build, run, deploy

```bash
# Local dev
cd odop_backend            # (this repo is named ondc_odop on disk)
npm install
npm run dev                # tsx watch — auto-reloads

# Type-check (Prisma #private warnings are pre-existing, ignore them)
npx tsc --noEmit

# Production build → dist/main.js (esbuild)
npm run build
```

**Deploy (Plesk / Phusion Passenger):** after `git pull`, run `npm run build`,
then restart the Node app in Plesk. The server runs `dist/main.js`. If
`POST /search` returns 404 on live, the build is stale — rebuild and restart.

---

## 8. Quick "gotchas" for the next dev

- **`provider_id` is always `String(stores.id)`.** There is no separate ONDC
  providers table; an active store _is_ a provider.
- **The catalog is never cached.** Don't reintroduce `ondc_catalog_items` as a
  cache — `/on_search` builds live by design.
- **Every callback ACKs first, works second.** Never do DB/catalog work before
  `res.json(...)`; the network times out fast.
- **The storefront DB is off-limits to ONDC code.** Cross-DB joins caused prod
  bugs; that's why there's a dedicated `ONDC_DB_URL` pool.
- **`store_locations` new columns must be filled by the storefront UI/backend**
  going forward (see §2a) — otherwise new stores ship with empty serviceability
  hours/radius in the ONDC catalog.
- **Signatures: incoming verified in `ondcAuth.middleware`, outgoing produced in
  `beckn.service` — both via `utils/signature.util.ts`.** That util is the only
  place crypto happens; if signatures ever break, start there.

---

## 9. Work still to be done (known TODOs)

This section lists what is **incomplete or unverified** at handover, so the next
team knows where to pick up.

### 9.1 Order Detail page — seller status update must auto-send `on_status`

**Goal:** From the ONDC admin "Order Detail" page, a seller moves an order through
its fulfillment states (Packed → Order-picked-up → Out-for-delivery →
Order-delivered, plus RTO/Return). Each change should **automatically send an
`on_status` callback** to the buyer app so the buyer sees the update.

**Current state — what I actually checked, file by file:**

| Layer                         | File                                                                                          | Status                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI page controls              | [`OndcOrderDetailPage.tsx`](../odop_ui/src/pages/admin/ondc/OndcOrderDetailPage.tsx)          | ✅ **Exists** — "Update Fulfillment" card: dropdown (packed / picked_up / out_for_delivery / delivered / rto / return) + AWB/courier/tracking inputs + "Apply Update" button |
| UI API wrapper                | [`ondc.api.ts`](../odop_ui/src/api/ondc.api.ts) `updateFulfillment`                           | ✅ Sends `{ action, awb, courier, tracking_url }`                                                                                                                            |
| Backend route                 | [`admin.route.ts`](src/ondc/routes/admin.route.ts) `POST /admin/orders/:orderId/fulfillment`  | ✅ Mounted (seller-guarded)                                                                                                                                                  |
| Backend handler               | [`orders.controller.ts`](src/ondc/controllers/admin/orders.controller.ts) `updateFulfillment` | ✅ Reads `action`, switches to the right service method                                                                                                                      |
| Persist state to DB           | [`fulfillment.service.ts`](src/ondc/services/fulfillment.service.ts)                          | ✅ Updates `ondc_fulfillments` (+ sometimes `ondc_orders.status`)                                                                                                            |
| **Send `on_status` to buyer** | `fulfillment.service.ts`                                                                      | ❌ **NOT IMPLEMENTED** — this is the gap                                                                                                                                     |

**Is it working today?** **Partially.** A seller _can_ update fulfillment status
from the UI and it **persists to the database** (you'll see the fulfillment state
change, and Packed/Delivered also update the order status). **But it does NOT send
`/on_status` to the buyer app** — so the buyer never learns of the update. The auto
`on_status` is the missing piece.

> ⚠️ Misleading comment: `fulfillment.service.ts` header says _"triggers unsolicited
> /on_status flows"_ — it does **not**. Every method only calls
> `fulfillmentModel.updateState(...)` / `orderModel.updateStatus(...)` and logs
> locally. There is no `buildOnStatus`, no `becknService.sendCallback`, no signing.

**What needs to be built (backend — the real work):**

After persisting the new state, each `fulfillmentService` method must build and
send a signed `on_status`. The good news: **everything needed is already
available** —

1. **The order's context is stored.** `ondc_orders` has `transaction_id`,
   `message_id`, `bap_id`, `bap_uri`, `domain`, `city`, `country`, `core_version`,
   and the full `raw_confirm_payload`. Reconstruct the Beckn `context` from these
   (load via `orderModel.findByOndcOrderId(ondcOrderId)`).
2. **The payload shape already exists as reference.** The Pramaan test-flow
   generators under [`flows/generators/`](src/ondc/flows/generators/) — e.g.
   `generateFlow3AOnStatus.ts` — already build a spec-complete `on_status` order
   object (provider, items with `fulfillment_id`, `fulfillments[]` each carrying
   `state.descriptor.code`, billing, quote, payment, timestamps). Reuse that shape:
   take the stored order from `raw_confirm_payload` and overlay the new fulfillment
   `state.descriptor.code`.
3. **Sending is already solved.** Wrap with `buildOnStatus(ctx, order)`
   ([`utils/payload.builder.ts`](src/ondc/utils/payload.builder.ts)), then
   `becknService.sendCallback(buildCallbackUrl(bapUri,'on_status'), 'on_status',
payload, txnId)` ([`services/beckn.service.ts`](src/ondc/services/beckn.service.ts))
   — that signs it and POSTs it, exactly like `confirm.controller` does for
   `on_confirm`. Then write an outbound row to `ondc_txn_logs` and patch
   `overall_txns.on_status = 1`.

   Sketch (per method, after the DB update):

   ```ts
   const order = await orderModel.findByOndcOrderId(ondcOrderId);
   const ctx = rebuildContextFromOrder(order); // from stored bap_uri/txn/etc.
   const statusOrder = buildStatusOrder(order, fulfillmentId, 'Order-picked-up'); // overlay state
   const payload = buildOnStatus(ctx, statusOrder);
   await becknService.sendCallback(
     becknService.buildCallbackUrl(order.bap_uri, 'on_status'),
     'on_status',
     payload,
     order.transaction_id,
   );
   ```

**Smaller fixes to fold in while you're here:**

- `markPickedUp`, `markOutForDelivery`, `initiateRto`, `initiateReturn` update the
  _fulfillment_ state but **not** `ondc_orders.status` — only `markPacked` and
  `markDelivered` do. Decide the order-status mapping for each and update
  consistently (and write to `ondc_order_status_history` via
  `orderModel.transitionStatus` so the UI "Status History" panel reflects it).
- After the change, the UI already refetches the order, so the new state/history
  will display automatically.

**How to verify once built:** trigger an update from the order page, then watch
`logs/ondc/status_outgoing.log` (or `on_status` outbound rows in `ondc_txn_logs`)
for an `ACK` from the BAP. With Pramaan, the corresponding flow step should go
green.
