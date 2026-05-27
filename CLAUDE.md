# ONDC ODOP — Agent Context

This repo (`ondc_odop`, branch `odop_ondc_01`) holds the ONDC Beckn BPP that
sits in front of an existing ODOP storefront. Two top-level sub-projects live
here:

- **`odop_backend/`** — Express + TypeScript API, MySQL (mysql2), Prisma for
  some of the storefront tables (ONDC code uses raw SQL via `~/lib/ondcSql.ts`).
- **`odop_ui/`** — React + Vite + Tailwind + React Query admin/seller UI.

The PHP reference implementation we mirror behaviour from lives outside the
repo at `C:\xampp\htdocs\preprod_v1\` (`search.php` → `build_on_search_min` is
the canonical pattern for /on_search).

---

## 1. Architecture decisions (don't re-litigate)

| Decision                                                                                                                       | Why                                                                                                      | Where it shows up                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single DB** — everything in `ondc_odop_db` (prod: `final_ondc_odop_db`)                                                      | Cross-DB joins to `new_odop_db` caused schema-mismatch bugs and prod sync issues.                        | `src/ondc/**` uses only `~/lib/ondcSql.ts` (the `ONDC_DB_URL` pool). Never reach into `sqlQuery` / `DATABASE_URL`.                                                                                        |
| **No `ondc_catalog_items` cache** — `/on_search` builds the catalog live every request.                                        | Sync flow kept hitting column mismatches; PHP doesn't cache either; admin UX gain wasn't worth the bugs. | `catalogService.buildSearchCatalog` walks `stores → store_locations → products → product_variants` on every call.                                                                                         |
| **Multi-seller, every active store IS a provider**                                                                             | Removes the need for an `ondc_providers` table and an upsert flow.                                       | `provider_id = String(stores.id)`. `seller_id = stores.seller_user_id`. `providerModel` (in [src/ondc/models/provider.model.ts](src/ondc/models/provider.model.ts)) is a read-only adapter over `stores`. |
| **`np_type = MSN`** (Multi-Seller Network)                                                                                     | We're a marketplace BPP, not a single-seller storefront.                                                 | `buildProviderTags` and `buildBppDescriptor` in [src/ondc/utils/catalog.builders.ts](src/ondc/utils/catalog.builders.ts).                                                                                 |
| **Variant expansion at search time**                                                                                           | Per PHP convention, each leaf variant is its own ONDC item.                                              | One row per leaf variant (`parent_variant_id IS NULL` among children) or one row per product when no variants exist.                                                                                      |
| **Item ID format**: `prod_<product_id>_var_<variant_id>` (variant) or `prod_<product_id>` (standalone)                         | Matches PHP `ondc_canonical_item_id`; lets `/select` parse the id back to a product+variant pair.        | `buildOndcItemId` / `parseOndcItemId` in [src/ondc/adapters/product.adapter.ts](src/ondc/adapters/product.adapter.ts).                                                                                    |
| **Variant grouping**: items sharing the same product use `VG-<product_id>` and get `parent_item_id` set when ≥2 siblings exist | Same scheme as PHP `_ensure_variant_support` + `_add_variant_catalog_data`.                              | `applyVariantGrouping` in [src/ondc/utils/catalog.builders.ts](src/ondc/utils/catalog.builders.ts).                                                                                                       |
| **Dev console at `warn`, file logs at `debug`**                                                                                | Server terminal stays quiet; full payloads still in `logs/ondc/network_debug.log`.                       | [src/ondc/utils/logger.util.ts](src/ondc/utils/logger.util.ts).                                                                                                                                           |

---

## 2. Catalog data flow (`/on_search`)

```
POST /api/v1/ondc/search (handleSearch)
  ↳ ACK immediately, then setImmediate(async):
      catalogService.buildSearchCatalog(domain)
        getActiveStores()                       — stores WHERE is_active=1
        for each store:
          fetchStoreLocations(store.id)         — store_locations
          fetchOndcCatalogRows(store.id)
            ├─ products    WHERE store_id=? AND publish_status='publish'
            ├─ product_variants (leaf detection via parent_variant_id)
            ├─ product_ondc_attributes (merged: product-level + variant chain)
            ├─ product_images
            └─ variant_images
          for each row:
            buildOndcItemFromRow(row, providerCtx)
              resolveOndcCategory(row)
                1. row.category_domain + row.ondc_subcategory (display-name normalized)
                2. ondc_category_mappings  ←JOIN→  ondc_categories.ondc_category_code
                3. categoryRules.json fallback by category_id
                4. last-ditch: normalize row.category_name
                default: rules.default
              ↳ returns { item, domain, variantGroupId }
            filter where built.domain !== requestedDomain
          applyVariantGrouping(items)           — sets parent_item_id + variant categories
          buildProviderEntry(...)               — descriptor, locations, tags, items
      buildOnSearch(ctx, catalog)               — wraps with context envelope
      becknService.sendCallback(bap_uri+/on_search, ...)
```

**Do NOT** apply a server-side name/query filter — PHP doesn't, and ONDC
spec says BAP filters its own side. We tried it, it ate every item that
didn't contain the query string.

**Domain normalization is fragile** — `categories.domain` in prod is a
display name like `Fashion`, not `ONDC:RET12`. `normalizeOndcDomain()` maps
display strings to the 3 supported codes (RET10 / RET12 / RET16) — extend
that map when adding new domains, not the ad-hoc prefixing.

---

## 3. Database

**Live prod DB**: `final_ondc_odop_db` (local mirror at
`mysql://root:@localhost:3306/final_ondc_odop_db`).
**Local dev DB**: `ondc_odop_db` (the canonical schema source-of-truth).

Both should be byte-identical for table/column structure. There's a single
idempotent migration file:

```
src/ondc/db/migrations/001_setup_ondc.sql
```

Run it via phpMyAdmin or `mysql … < 001_setup_ondc.sql`. It:

1. Uses a stored-procedure helper to add 6 columns to `store_locations`
   (`radius_km`, `time_from`, `time_to`, `day_from`, `day_to`,
   `fulfillment_type`) only when missing, and backfills from the legacy
   `radius` / `opening_time` / `closing_time` / `location_type` columns.
2. `CREATE TABLE IF NOT EXISTS` for 19 ONDC tables, copied **verbatim** from
   the dev DB so prod ends up identical.

**Full schema reference**: [src/ondc/db/schema.sql](src/ondc/db/schema.sql)
is a `mysqldump --no-data` of the dev DB. Use it to recreate from scratch:

```
CREATE DATABASE ondc_odop_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
mysql ondc_odop_db < src/ondc/db/schema.sql
```

⚠ `schema.sql` is UTF-16 LE encoded — `cat` / Read it carefully; some
characters can look doubled. When editing, preserve the encoding.

---

## 4. Table-name & column gotchas (real prod schema)

These bit us — encode them rather than guessing:

| What the code might want                       | What prod actually has                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `users.phone`                                  | `user.phoneNumber` (singular table, camelCase column)                                                                           |
| `stores.seller_id`                             | `stores.seller_user_id` (FK to `user.id`)                                                                                       |
| `ondc_category_mappings.category_id` (varchar) | `ondc_category_mappings.ondc_category_id` (FK → `ondc_categories.id`); use the JOIN to get `ondc_categories.ondc_category_code` |
| `product_ondc_attributes.field_key` / `.value` | `attribute_key` / `attribute_value` (and `color_name` is a separate column)                                                     |
| `store_locations.radius_km` etc.               | Migration adds them; legacy DB has `radius` (meters), `opening_time` / `closing_time` (HHMM int), `serviceability`              |
| `categories.domain`                            | Display name (`Fashion`, `Home & Kitchen`), not ONDC code                                                                       |

---

## 5. Key files quick reference

**Backend (`odop_backend/src/ondc/`)**:

| Path                                                                                        | Role                                                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [routes/index.ts](src/ondc/routes/index.ts)                                                 | Mounts `becknRouter` at `/` and `adminRouter` at `/admin`                                                 |
| [routes/beckn.route.ts](src/ondc/routes/beckn.route.ts)                                     | `/search`, `/select`, `/init`, `/confirm`, `/cancel`, `/update`, `/status`, `/track`, `/rating`, `/issue` |
| [routes/admin.route.ts](src/ondc/routes/admin.route.ts)                                     | Admin REST: catalog, orders, providers, logs, txns, PPF, IGM                                              |
| [controllers/beckn/search.controller.ts](src/ondc/controllers/beckn/search.controller.ts)   | ACK + async catalog build + sign+POST to bap_uri                                                          |
| [controllers/beckn/select.controller.ts](src/ondc/controllers/beckn/select.controller.ts)   | Uses `resolveOndcCatalogRow(itemId)` to validate each line                                                |
| [controllers/beckn/confirm.controller.ts](src/ondc/controllers/beckn/confirm.controller.ts) | Resolves `seller_id`/`store_id` from `providerModel.findById(providerId)`                                 |
| [services/catalog.service.ts](src/ondc/services/catalog.service.ts)                         | `buildSearchCatalog(domain)` — the one entry point used by both `/search` and the admin viewer            |
| [adapters/product.adapter.ts](src/ondc/adapters/product.adapter.ts)                         | All variant expansion + item building lives here                                                          |
| [adapters/seller.adapter.ts](src/ondc/adapters/seller.adapter.ts)                           | `getActiveStores`, `fetchStoreLocations`, `mapStoreLocationToOndcLocation`                                |
| [models/provider.model.ts](src/ondc/models/provider.model.ts)                               | Read-only adapter over `stores` (provider abstraction)                                                    |
| [utils/catalog.builders.ts](src/ondc/utils/catalog.builders.ts)                             | `buildOndcItem`, `buildProviderEntry`, `applyVariantGrouping`, BPP descriptor / fulfillments / payments   |
| [utils/payload.builder.ts](src/ondc/utils/payload.builder.ts)                               | Context envelopes for every on_X callback                                                                 |
| [utils/logger.util.ts](src/ondc/utils/logger.util.ts)                                       | Winston — console at warn, files at debug                                                                 |
| [config/domain.config.ts](src/ondc/config/domain.config.ts)                                 | RET10/RET12/RET16 profile (FSSAI, veg flag, default category, etc.)                                       |
| [config/categoryRules.json](src/ondc/config/categoryRules.json)                             | Local category → ONDC domain/category fallback map                                                        |
| [db/schema.sql](src/ondc/db/schema.sql)                                                     | Full final schema (dumped from prod)                                                                      |
| [db/migrations/001_setup_ondc.sql](src/ondc/db/migrations/001_setup_ondc.sql)               | Single idempotent migration                                                                               |

**Frontend (`odop_ui/src/`)**:

| Path                                     | Role                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `route/adminRoutes.tsx`                  | Mounts `/admin/ondc/*` routes (dashboard, orders, catalog, providers, settlements, transactions, tickets, logs, request-monitor, settings) |
| `components/ondc/OndcSidebar.tsx`        | Flat sidebar (Catalog used to have a Rejections sub-link; removed in approach-1 refactor)                                                  |
| `pages/admin/ondc/OndcCatalogPage.tsx`   | Live preview of /on_search items via `ondcApi.getCatalogItems(providerId)`                                                                 |
| `pages/admin/ondc/OndcProvidersPage.tsx` | Lists every row in `stores` (active + inactive), toggle flips `stores.is_active`                                                           |
| `api/ondc.api.ts`                        | All admin REST wrappers; no `syncCatalog`, no `upsertProvider`, no `getRejections` (all removed)                                           |

---

## 6. Conventions

- **`provider_id` is always `String(stores.id)`** — every read/write across the
  ONDC code uses this. The PHP project does the same.
- **`/on_search` returns the full catalog**; the buyer filters their side. Don't
  add server-side query filtering.
- **Per ONDC contract, every callback ACKs synchronously, then does async work**
  (catalog build, callback POST) via `setImmediate`. Don't make any callback
  endpoint do its work before the response.
- **Use the `Skill`/`Edit`/`Write` tools and dedicated commands** — backend tsc
  is clean (ignore the pre-existing `src/generated/prisma` `#private` errors).
  Build with `npm run build` (esbuild via `esbuild.config.mjs` → `dist/main.js`).
- **UI uses React Query**. The catalog list page has no `staleTime` set →
  default 0; every mount/focus rebuilds the catalog server-side. If admin UX
  matters, add `staleTime: 60_000, refetchOnWindowFocus: false` to that query.

---

## 7. Anti-patterns / pitfalls

- **Don't reintroduce `ondc_catalog_items`** as a cache table. We dropped it,
  added a migration, and rewrote `/on_search` to build live. The PHP reference
  also builds live.
- **Don't create an `ondc_providers` table.** Providers are derived from
  `stores`. (If you need extra provider-level metadata, add columns on `stores`
  or a sidecar table keyed on `store_id`, never an `ondc_providers` parallel.)
- **Don't query `users` (plural).** The table is `\`user\``and the phone column
is`phoneNumber`.
- **Don't filter the `/on_search` catalog by `intent.item.descriptor.name`** on
  the server. PHP doesn't; the spec says BAP filters.
- **Don't write files via PowerShell `Set-Content` / `Out-File` without
  `-Encoding utf8`** — that's how mojibake got introduced (`â€" â‚¹ Ã—`). The
  `.gitattributes` (`* text=auto eol=lf`) + `.vscode/settings.json`
  (`files.encoding: utf8`) + `.editorconfig` (`charset = utf-8`) in both repos
  prevent recurrence.
- **`np_type` is `MSN`, not `ISN`.** ISN is single-seller (Independent Seller
  Network); we're multi-seller.

---

## 8. N+1 still open (admin viewer + /search both pay)

`resolveOndcCategory` in [src/ondc/adapters/product.adapter.ts](src/ondc/adapters/product.adapter.ts)
hits `ondc_category_mappings JOIN ondc_categories` once per product. For N
products you get N round-trips. Batch lookup is the obvious win — fetch all
mappings for the store's product_ids in one query, then resolve per-row from a
Map. Skipped during the live-build refactor because there were only ~16
products on prod; revisit when scaling.

---

## 9. PHP reference points (when in doubt)

The PHP BPP at `C:\xampp\htdocs\preprod_v1\` is the canonical "what the network
expects" reference. When unsure how a payload field should look:

- `search.php` → `build_on_search_min` — entry point for /on_search catalog
- `lib.php`:
  - `db_products_all` / `db_products_expand_with_variants` — how variant rows
    are materialized
  - `ondc_canonical_item_id` / `ondc_item_parts_from_id` — item ID format
  - `_ensure_variant_support` / `_add_variant_catalog_data` — variant grouping
  - `ondc_item_from_product` — full per-item payload assembly
- `confirm.php`, `select.php`, `init.php`, `cancel.php`, `update.php`,
  `recon.php` — callback handlers; useful as a behavioural baseline

---

## 10. Local dev setup (one-time)

```
# Backend
cd odop_backend
npm install                 # picks up pdfkit/@types/pdfkit and friends
# Set .env: DATABASE_URL=... ONDC_DB_URL=mysql://root:@localhost:3306/ondc_odop_db ...
npm run dev                 # tsx watch src/main.ts

# UI
cd odop_ui
npm install
npm run dev

# DB (one-time)
mysql -u root -e "CREATE DATABASE ondc_odop_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root ondc_odop_db < odop_backend/src/ondc/db/schema.sql
# For prod: run 001_setup_ondc.sql via phpMyAdmin against final_ondc_odop_db
```

Mount path: `/api/v1/ondc/*` (the `/api/v1` prefix comes from the main app
router; `/ondc` is mounted in `src/route/index.ts`). If `POST /api/v1/ondc/search`
returns 404, that mount got lost — check line ~72 of `src/route/index.ts`.

---

## 11. What "done" looks like for new features

- Backend: `tsc --noEmit` clean (ignore the Prisma `#private` warnings),
  `npm run build` produces a fresh `dist/main.js`.
- DB schema changes go into `001_setup_ondc.sql` as additional idempotent
  steps (use the `_ondc_add_column` helper for column additions; use
  `CREATE TABLE IF NOT EXISTS` for new tables). After the migration runs,
  regenerate `src/ondc/db/schema.sql` via `mysqldump --no-data`.
- UI: `tsc --noEmit` exit 0. No new `staleTime: 0` queries on heavy backend
  endpoints unless intentional.
- Test against the running server with the existing Postman collection at
  `odop_backend/ONDC_Postman_Collection.json`.
