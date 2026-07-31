-- 30_check_view_drift.sql — read-only diagnostic. Safe to run any time; changes nothing.
--
-- WHEN TO RUN: after the ecom team changes the SCHEMA of any table the BPP reads
-- (ADD/RENAME/DROP COLUMN). Row data never needs this — only structure does.
--
-- WHY IT EXISTS: the BPP reads its store/product/seller tables from another
-- database, and depending on the environment that indirection is either
--   (a) a VIEW over the ecom DB  — MySQL freezes `SELECT *` at CREATE VIEW time,
--       so a new ecom column does NOT appear until the view is recreated, or
--   (b) a separate BASE TABLE   — a real copy, which needs its own ALTER TABLE.
-- Both fail identically at runtime: ER_BAD_FIELD_ERROR / "Unknown column".
--
-- HOW TO RUN: connect to the ONDC database the app uses (the schema in
-- ONDC_DB_URL) and run this file. Everything below keys off DATABASE(), so it
-- reports on whichever ONDC database you are connected to.

-- The ecom database that owns the real data. Change if yours differs.
SET @ecom := 'odopmartmp_new';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WHAT AM I CONNECTED TO, AND HOW IS EACH RELATION BACKED?
--    VIEW      -> fix drift with CREATE OR REPLACE VIEW (section 3a)
--    BASE TABLE-> fix drift with ALTER TABLE on THIS database (section 3b)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  DATABASE()                                   AS ondc_database,
  t.TABLE_NAME                                 AS relation,
  t.TABLE_TYPE                                 AS backed_by,
  (SELECT COUNT(*) FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = t.TABLE_NAME) AS cols_here,
  (SELECT COUNT(*) FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = @ecom
      AND c.TABLE_NAME = IF(t.TABLE_NAME = 'user', 'User', t.TABLE_NAME))  AS cols_in_ecom
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_NAME IN (
    'stores','store_locations','seller_profiles','user',
    'products','product_variants','product_images','variant_images',
    'product_ondc_attributes','product_serviceable_pincodes',
    'product_serviceable_cities','product_verification',
    'categories','ondc_categories','ondc_category_mappings')
ORDER BY (t.TABLE_TYPE = 'VIEW'), t.TABLE_NAME;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DRIFT: columns the ecom table has that this database is MISSING.
--    NO ROWS = in sync. Any row is a column the BPP cannot select.
--    Works for both views and base-table copies.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  here.TABLE_NAME                                          AS relation,
  here.TABLE_TYPE                                          AS backed_by,
  GROUP_CONCAT(b.COLUMN_NAME ORDER BY b.ORDINAL_POSITION)  AS missing_columns,
  IF(here.TABLE_TYPE = 'VIEW',
     'run section 3a (CREATE OR REPLACE VIEW)',
     'run section 3b (ALTER TABLE on this database)')      AS how_to_fix
FROM information_schema.COLUMNS b
JOIN information_schema.TABLES here
  ON here.TABLE_SCHEMA = DATABASE()
 AND here.TABLE_NAME   = IF(b.TABLE_NAME = 'User', 'user', b.TABLE_NAME)
WHERE b.TABLE_SCHEMA = @ecom
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = here.TABLE_NAME
      AND c.COLUMN_NAME  = b.COLUMN_NAME)
GROUP BY here.TABLE_NAME, here.TABLE_TYPE
ORDER BY here.TABLE_NAME;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FIXES — apply only the one section 2 points you to.
--
-- 3a. Relation is a VIEW (e.g. prod_ondc_db): re-run 20_prod_ondc_views.sql.
--     Every statement in it is CREATE OR REPLACE, so it is idempotent.
--     For just the stores view:
--
--       CREATE OR REPLACE SQL SECURITY INVOKER VIEW `stores`
--         AS SELECT * FROM `odopmartmp_new`.`stores`;
--
--     CAUTION: `seller_profiles` and `store_locations` are NOT `SELECT *` — they
--     list columns explicitly to synthesise bank_name / branch_name / radius_km.
--     If section 2 flags either, add the new column to 20_prod_ondc_views.sql
--     first; re-running it unchanged will not pick the column up.
--
-- 3b. Relation is a BASE TABLE (e.g. live_ondc_odop_db): it is a separate copy,
--     so the ecom ALTER did not reach it. Apply the same DDL here, e.g.
--
--       ALTER TABLE `stores`
--         ADD COLUMN IF NOT EXISTS `banner_photo` VARCHAR(500) NULL AFTER `store_photo`;
--
--     Adding the column leaves it NULL for every row — the BPP then falls back
--     to its bundled brand asset, which is correct behaviour, not an error.
--     Backfilling values is a separate decision.
--
-- No application restart is needed after either fix: the next query re-resolves.
-- ─────────────────────────────────────────────────────────────────────────────
