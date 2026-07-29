-- =============================================================================
-- 004 — ONDC-specific provider active/inactive toggle.
-- Idempotent (MariaDB-native IF NOT EXISTS). Run against the database
-- ONDC_DB_URL points to, after 001+002+003.
--
-- Independent of stores.is_active (the ecom site's own on/off switch) and of
-- seller_profiles.approval_status (the Super Admin seller-approval gate) —
-- this table lets the ONDC admin dashboard turn a store on/off for ONDC only,
-- without touching the ecom-owned `stores` table. No row for a store means
-- "active" (default); the admin toggle only ever needs to write when a store
-- is turned OFF or turned back ON after that.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ondc_provider_settings` (
  `store_id` bigint(20) unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`store_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
