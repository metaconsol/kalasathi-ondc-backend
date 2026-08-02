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
