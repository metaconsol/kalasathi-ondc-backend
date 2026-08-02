-- =============================================================================
-- 004 — ONDC-specific provider active/inactive toggle.
-- Idempotent (MariaDB-native IF NOT EXISTS). Run against the database
-- ONDC_DB_URL points to, after 001+002+003.
--
-- Independent of stores.is_active (the ecom site's own on/off switch) and of
-- seller_profiles.approval_status (the Super Admin seller-approval gate) —
-- this table lets the ONDC admin dashboard turn a store on/off for ONDC only,
-- without touching the ecom-owned `stores` table.
--
-- No row for a store means INACTIVE. This table is the only source of ONDC
-- availability: Super Admin approval alone must never publish a seller to the
-- network, so a store reaches ONDC only once someone activates it in the ONDC
-- Providers tab, which is what writes the row.
--
-- The default below was 1 in the original version of this file, when an absent
-- row meant "active". 005 flips it on databases created before that change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ondc_provider_settings` (
  `store_id` bigint(20) unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`store_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
