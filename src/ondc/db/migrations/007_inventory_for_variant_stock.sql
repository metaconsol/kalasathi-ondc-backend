-- =============================================================================
-- 007 — `inventory`, the source of per-variant stock for /on_search.
-- Idempotent. Run against the database ONDC_DB_URL points to, after 006.
--
-- Companion to the `inventory` view in ../prod/20_prod_ondc_views.sql. The two
-- cover different environments and BOTH are needed:
--   prod      prod_ondc_db reads ecom through views → the view file applies.
--   preprod   final_ondc_odop_db is its own base-table copy → this file applies.
--   local     whichever of the two that checkout points at.
--
-- WHY: products.stock is never maintained for variant products — the storefront
-- decrements inventory.qty_on_hand instead (odop_backend order.service.ts) — so
-- reading products.stock published every variant as sold out. Confirmed live on
-- RET12 products 6/27/30/43/83 and RET16 126/142, each of which holds real units.
--
-- Safe on a database where `inventory` is already a VIEW: tables and views share
-- one namespace in MariaDB, so IF NOT EXISTS sees the view and does nothing.
--
-- An empty table is safe too. fetchVariantStock treats "no rows at all" as stock
-- unknown, and an unknown stock is never hidden — the catalog still ships, items
-- simply are not filtered.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `inventory` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `store_location_id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED NOT NULL,
  `qty_on_hand` int(11) NOT NULL DEFAULT 0,
  `qty_reserved` int(11) NOT NULL DEFAULT 0,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_store_location_id_variant_id_key` (`store_location_id`, `variant_id`),
  KEY `inventory_variant_id_idx` (`variant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Read-only check — run it after the migration and read the two columns:
--   relation  VIEW on prod, BASE TABLE on preprod, empty if neither applied
--   rows      0 on a fresh preprod copy; variants then publish as "stock unknown"
-- SELECT
--   (SELECT TABLE_TYPE FROM information_schema.TABLES
--     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory') AS relation,
--   (SELECT COUNT(*) FROM inventory) AS rows_present;
