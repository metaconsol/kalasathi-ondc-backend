-- =============================================================================
-- 003 — Delhivery logistics columns for ONDC orders.
-- Idempotent (MariaDB-native IF NOT EXISTS). Run after 001 + 002 against the
-- ONDC database (the one ONDC_DB_URL points to).
--
-- Mirrors odop_backend's seller_units.delhivery_* + store_locations
-- warehouse columns so the ONDC order page can book/track/cancel shipments,
-- download packing slips and schedule pickups exactly like a normal order.
-- =============================================================================

ALTER TABLE `ondc_orders`
  ADD COLUMN IF NOT EXISTS `delhivery_upload_wbn`      VARCHAR(100) NULL AFTER `logistics_provider`,
  ADD COLUMN IF NOT EXISTS `delhivery_pickup_id`       VARCHAR(100) NULL AFTER `delhivery_upload_wbn`,
  ADD COLUMN IF NOT EXISTS `delhivery_shipment_status` VARCHAR(100) NULL AFTER `delhivery_pickup_id`,
  ADD COLUMN IF NOT EXISTS `delhivery_last_scan_at`    DATETIME     NULL AFTER `delhivery_shipment_status`,
  ADD COLUMN IF NOT EXISTS `delhivery_last_response`   LONGTEXT     NULL AFTER `delhivery_last_scan_at`;
