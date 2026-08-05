-- =============================================================================
-- 008 — buyer app (BAP) toggle manager.
-- Idempotent. Run against the database ONDC_DB_URL points to, after 007.
-- Mirrored in ../prod/10_prod_ondc_tables.sql — these are ONDC-owned tables, so
-- prod gets them from that file, preprod from this one (see README).
--
-- ~20 buyer apps reach us through the gateway; a handful convert. Everything
-- else is discovery traffic we parse, expand into a catalog and log for nothing.
-- These tables let an admin turn a buyer app off and have its /search dropped
-- before any of that work happens.
-- =============================================================================

-- DEFAULT 1 is deliberate here, and is the opposite of ondc_provider_settings.
-- A missing row means "not configured yet", and an unconfigured buyer app must
-- keep being served — going dark for a whole BAP is a network-visible outage.
-- Only an explicit row with is_active = 0 filters anything.
CREATE TABLE IF NOT EXISTS `bap_management` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  -- ONDC subscriber id, e.g. 'ondc.airpay.co.in'. Stored lowercase; see the
  -- model's normalizeBapId. The utf8mb4_unicode_ci collation makes lookups
  -- case-insensitive anyway, so a BAP that changes its casing still matches.
  `bap_id` varchar(255) NOT NULL,
  `bap_name` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` text DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `config_updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bap_management_bap_id` (`bap_id`),
  KEY `idx_bap_management_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every toggle, so "last toggled by X on Y" is answerable and a wrong flip can
-- be traced to a person. Never updated, only appended.
CREATE TABLE IF NOT EXISTS `bap_management_audit` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `bap_id` varchar(255) NOT NULL,
  `old_value` tinyint(1) DEFAULT NULL,
  `new_value` tinyint(1) NOT NULL,
  `changed_by` int(11) DEFAULT NULL,
  `changed_by_name` varchar(255) DEFAULT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'toggle',
  `notes` text DEFAULT NULL,
  `changed_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bap_audit_bap` (`bap_id`, `changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only rows the filter DROPPED are written here. Requests we processed are
-- already one row each in ondc_txn_logs (bap_id, action, created_at), so
-- duplicating them would double the write load on the hottest table we have —
-- its PHP predecessor reached 992 MB — for data we can already query.
-- was_processed exists so the shape still reads correctly if that ever changes.
CREATE TABLE IF NOT EXISTS `bap_request_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `bap_id` varchar(255) NOT NULL,
  `request_type` varchar(32) NOT NULL,
  `was_processed` tinyint(1) NOT NULL DEFAULT 0,
  `error_code` varchar(32) DEFAULT NULL,
  `transaction_id` varchar(255) DEFAULT NULL,
  `message_id` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bap_request_log_bap` (`bap_id`, `created_at`),
  KEY `idx_bap_request_log_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed from the buyer apps already on record so the screen is populated on day
-- one instead of filling in as traffic arrives. All active — this migration
-- must not change who gets served.
INSERT INTO `bap_management` (`bap_id`, `bap_name`, `is_active`)
SELECT LOWER(TRIM(bt.`bap_id`)), NULLIF(TRIM(bt.`bap_id`), ''), 1
  FROM `bap_terms` bt
 WHERE TRIM(COALESCE(bt.`bap_id`, '')) <> ''
ON DUPLICATE KEY UPDATE `bap_id` = `bap_management`.`bap_id`;
