# ONDC database migrations

Everything the ONDC module needs beyond the base storefront schema, as
idempotent MariaDB scripts (`IF NOT EXISTS` everywhere — safe to re-run).

## Run order

Run against the database `ONDC_DB_URL` points to, in this exact order:

| #   | File                                    | What it does                                                                                                                                                   |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `001_setup_ondc.sql`                    | store*locations ONDC columns (radius/timing/fulfillment_type), all `ondc*\*` runtime tables, ondc_ppf_recon extensions, seller_profiles bank columns           |
| 2   | `002_fix_dump_gaps.sql`                 | ondc_fulfillments.fulfillment_json, ondc_settlements ledger columns + indexes. FIX 3 (User table-name case) is a MANUAL note — read it, currently not required |
| 3   | `003_delhivery_logistics.sql`           | ondc*orders delhivery*\* columns (booking/tracking state for the ONDC order page)                                                                              |
| 4   | `004_ondc_provider_settings.sql`        | ondc_provider_settings table — independent per-store ONDC on/off toggle, decoupled from stores.is_active                                                       |
| 5   | `005_provider_settings_default_off.sql` | ondc_provider_settings.is_active DEFAULT 1 → 0, so a defaulted insert can never publish a store on ONDC. Touches no existing row                               |
| 6   | `006_buyer_finder_fee.sql`              | ondc*orders.buyer_finder_fee*_, ondc*transactions.bff*_, bap*terms.bff_type — so every on*\* callback echoes the fee the BAP sent on /search                   |
| 7   | `007_inventory_for_variant_stock.sql`   | `inventory` — per-variant stock for /on_search. Pairs with the `inventory` view in `../prod/20_prod_ondc_views.sql`; see the rule below                        |

## Anything prod needs goes in BOTH places

The two environments get their schema from different files, so a change written
in only one of them silently skips the other:

| Environment | Database             | Reads ecom tables via       | Applied from    |
| ----------- | -------------------- | --------------------------- | --------------- |
| prod        | `prod_ondc_db`       | views onto `odopmartmp_new` | `../prod/*.sql` |
| preprod     | `final_ondc_odop_db` | its own base tables         | this folder     |

So when a change needs SQL run on prod, add it **here as a numbered migration**
_and_ in `../prod/` — a view in `20_prod_ondc_views.sql` when prod reads the
table from ecom, or a table in `10_prod_ondc_tables.sql` when the ONDC module
owns it. Both files are idempotent, and tables and views share one namespace in
MariaDB, so `CREATE TABLE IF NOT EXISTS` is a no-op where the view already
exists — the same migration is safe on both.

`inventory` (007) is the worked example: a view on prod, a base table on preprod.

## Moving to the single/ecom database later

The same files, in the same order, bring the ecom DB (`odopmartmp_new`)
up to ONDC-ready state — it already has the storefront base tables the
migrations build on (products, stores, store*locations incl. the
delhivery_warehouse*\* columns, seller_profiles, ...). After running them,
point `ONDC_DB_URL` at that database. Nothing else to run.

## What is deliberately NOT in this folder

- `../schema.live.sql` — full structure snapshot of the live ONDC DB
  (2026-07-08, post-001/002/003). Reference only; do NOT execute it against an
  existing database (its CREATE TABLEs have no IF NOT EXISTS and will fail /
  conflict on shared tables). Use it only to create a brand-new empty DB.
- `../testdata/test_order_seed.sql` — seeds one fake ONDC order for UI
  testing, with matching cleanup statements. Test data, never a migration.
