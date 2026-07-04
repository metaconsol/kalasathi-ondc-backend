-- =============================================================================
-- ONDC setup migration — single idempotent script.
--
-- Run once against the live database (final_ondc_odop_db) via phpMyAdmin or
-- the mysql CLI. Safe to re-run: every step checks whether the column /
-- table already exists before creating it.
--
-- All CREATE TABLE statements are copied verbatim from the working dev DB
-- (ondc_odop_db) so the prod schema ends up byte-for-byte identical.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- STEP 1 — Add ONDC fulfilment / serviceability columns to store_locations
--
-- Uses MariaDB's native `ADD COLUMN IF NOT EXISTS` (supported since 10.0.2),
-- so this stays idempotent WITHOUT a stored procedure. Avoiding stored
-- procedures also sidesteps MariaDB error #1558 ("Column count of mysql.proc
-- is wrong") on servers whose data directory predates the running version.
-- -----------------------------------------------------------------------------
ALTER TABLE `store_locations` ADD COLUMN IF NOT EXISTS `radius_km` INT(11) NULL AFTER `longitude`;
ALTER TABLE `store_locations` ADD COLUMN IF NOT EXISTS `time_from` SMALLINT(6) NULL COMMENT 'HHMM, e.g. 900 = 09:00' AFTER `radius_km`;
ALTER TABLE `store_locations` ADD COLUMN IF NOT EXISTS `time_to` SMALLINT(6) NULL COMMENT 'HHMM, e.g. 2100 = 21:00' AFTER `time_from`;
ALTER TABLE `store_locations` ADD COLUMN IF NOT EXISTS `day_from` TINYINT(4) NULL COMMENT '1=Mon ... 7=Sun' AFTER `time_to`;
ALTER TABLE `store_locations` ADD COLUMN IF NOT EXISTS `day_to` TINYINT(4) NULL COMMENT '1=Mon ... 7=Sun' AFTER `day_from`;
ALTER TABLE `store_locations` ADD COLUMN IF NOT EXISTS `fulfillment_type` VARCHAR(32) NULL DEFAULT 'Delivery' AFTER `day_to`;

-- Backfill from the legacy columns. Safe to re-run (COALESCE only fills NULLs).
UPDATE `store_locations`
SET
  `radius_km`        = COALESCE(`radius_km`, CASE WHEN `radius` IS NOT NULL THEN GREATEST(1, ROUND(`radius` / 1000)) END),
  `time_from`        = COALESCE(`time_from`, `opening_time`),
  `time_to`          = COALESCE(`time_to`,   `closing_time`),
  `day_from`         = COALESCE(`day_from`, 1),
  `day_to`           = COALESCE(`day_to`,   7),
  `fulfillment_type` = COALESCE(`fulfillment_type`,
                                CASE WHEN `location_type` = 'SELF_PICKUP' THEN 'Self-Pickup' ELSE 'Delivery' END);

-- =============================================================================
-- STEP 3 — Create ONDC runtime tables (verbatim copies from ondc_odop_db)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `bap_terms` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bap_id` varchar(255) NOT NULL,
  `bap_uri` varchar(255) DEFAULT NULL,
  `unique_uid` varchar(255) DEFAULT NULL,
  `static_terms` text DEFAULT NULL,
  `static_terms_new` text DEFAULT NULL,
  `bff_percent` varchar(50) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bap_id` (`bap_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_attribute_rules` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ondc_category_id` bigint(20) unsigned NOT NULL,
  `attribute_code` varchar(80) NOT NULL,
  `is_mandatory` tinyint(1) NOT NULL DEFAULT 0,
  `data_type` enum('STRING','NUMBER','BOOLEAN','DATE','ENUM') NOT NULL DEFAULT 'STRING',
  `allowed_values` text DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cat_attr` (`ondc_category_id`,`attribute_code`),
  KEY `idx_cat` (`ondc_category_id`),
  CONSTRAINT `fk_ondc_attr_cat` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_catalog_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `main_db_product_id` bigint(20) unsigned NOT NULL,
  `provider_id` varchar(100) NOT NULL,
  `seller_id` bigint(20) unsigned NOT NULL,
  `ondc_item_id` varchar(100) NOT NULL,
  `ondc_category_code` varchar(100) NOT NULL,
  `domain` varchar(50) NOT NULL DEFAULT 'ONDC:RET12',
  `item_json` longtext NOT NULL,
  `sync_status` enum('synced','pending','rejected','inactive') NOT NULL DEFAULT 'pending',
  `rejection_reason` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_provider` (`ondc_item_id`,`provider_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_seller` (`seller_id`),
  KEY `idx_main_product` (`main_db_product_id`),
  KEY `idx_sync_status` (`sync_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_catalog_rejections` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(128) NOT NULL DEFAULT '',
  `bap_id` varchar(255) NOT NULL DEFAULT '',
  `bap_uri` varchar(512) NOT NULL DEFAULT '',
  `domain` varchar(96) NOT NULL DEFAULT '',
  `message_id` varchar(128) NOT NULL DEFAULT '',
  `bpp_id` varchar(255) NOT NULL DEFAULT '',
  `rejection_notes` mediumtext DEFAULT NULL,
  `payload_json` mediumtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_txn` (`transaction_id`(64)),
  KEY `idx_bap` (`bap_id`(128))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_customer_ticket` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ticket_id` varchar(120) NOT NULL,
  `txn_id` varchar(120) NOT NULL,
  `order_id` varchar(120) DEFAULT NULL,
  `provider_id` varchar(100) DEFAULT NULL,
  `seller_id` bigint(20) unsigned DEFAULT NULL,
  `domain` varchar(40) NOT NULL DEFAULT 'ONDC:RET12',
  `issue_level` varchar(30) DEFAULT 'ISSUE',
  `igm_status_raw` varchar(50) DEFAULT NULL,
  `display_status` varchar(50) NOT NULL DEFAULT 'OPEN',
  `priority` varchar(20) NOT NULL DEFAULT 'MEDIUM',
  `issue_type_code` varchar(10) DEFAULT NULL,
  `issue_type_label` varchar(100) DEFAULT NULL,
  `issue_category_code` varchar(10) DEFAULT NULL,
  `issue_category_label` varchar(100) DEFAULT NULL,
  `issue_source_type_code` varchar(10) DEFAULT NULL,
  `issue_source_type_label` varchar(100) DEFAULT NULL,
  `provider_type_code` varchar(10) DEFAULT NULL,
  `provider_type_label` varchar(100) DEFAULT NULL,
  `gro_type_code` varchar(10) DEFAULT NULL,
  `gro_type_label` varchar(100) DEFAULT NULL,
  `complainant_action_code` varchar(10) DEFAULT NULL,
  `complainant_action_label` varchar(100) DEFAULT NULL,
  `resolution_action_code` varchar(10) DEFAULT NULL,
  `resolution_action_label` varchar(100) DEFAULT NULL,
  `customer_actor_id` varchar(120) DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(40) DEFAULT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `source_id` varchar(120) DEFAULT NULL,
  `complainant_id` varchar(120) DEFAULT NULL,
  `respondent_ids_json` longtext DEFAULT NULL,
  `resolver_ids_json` longtext DEFAULT NULL,
  `bap_id` varchar(255) DEFAULT NULL,
  `bap_uri` varchar(500) DEFAULT NULL,
  `bpp_id` varchar(255) DEFAULT NULL,
  `bpp_uri` varchar(500) DEFAULT NULL,
  `country` varchar(20) DEFAULT NULL,
  `city` varchar(60) DEFAULT NULL,
  `core_version` varchar(20) DEFAULT NULL,
  `ttl` varchar(20) DEFAULT NULL,
  `reason_code` varchar(120) DEFAULT NULL,
  `reason_name` varchar(255) DEFAULT NULL,
  `reason_short_desc` longtext DEFAULT NULL,
  `reason_long_desc` longtext DEFAULT NULL,
  `descriptor_json` longtext DEFAULT NULL,
  `descriptor_attachments_json` longtext DEFAULT NULL,
  `refs_json` longtext DEFAULT NULL,
  `actors_json` longtext DEFAULT NULL,
  `actions_json` longtext DEFAULT NULL,
  `resolutions_json` longtext DEFAULT NULL,
  `payload_json` longtext DEFAULT NULL,
  `last_action_id` varchar(120) DEFAULT NULL,
  `last_action_code` varchar(100) DEFAULT NULL,
  `last_action_by` varchar(120) DEFAULT NULL,
  `last_actor_name` varchar(255) DEFAULT NULL,
  `selected_resolution_id` varchar(120) DEFAULT NULL,
  `selected_resolution_code` varchar(100) DEFAULT NULL,
  `selected_resolution_label` varchar(255) DEFAULT NULL,
  `actions_count` int(11) NOT NULL DEFAULT 0,
  `resolutions_count` int(11) NOT NULL DEFAULT 0,
  `open_info_request_count` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `db_created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `db_updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_id` (`ticket_id`),
  KEY `idx_txn` (`txn_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_seller` (`seller_id`),
  KEY `idx_display_status` (`display_status`),
  KEY `idx_customer_phone` (`customer_phone`),
  KEY `idx_updated_at` (`updated_at`),
  KEY `idx_category_code` (`issue_category_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_errors` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(100) DEFAULT NULL,
  `message_id` varchar(100) DEFAULT NULL,
  `error_type` varchar(20) DEFAULT NULL,
  `error_code` varchar(10) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_txn` (`transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_fulfillments` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ondc_order_id` varchar(128) NOT NULL,
  `transaction_id` varchar(128) NOT NULL,
  `fulfillment_id` varchar(64) NOT NULL,
  `fulfillment_type` varchar(50) NOT NULL DEFAULT 'Delivery',
  `fulfillment_role` varchar(32) NOT NULL DEFAULT 'primary_forward',
  `state` varchar(50) NOT NULL DEFAULT 'Pending',
  `contact_phone` varchar(64) DEFAULT NULL,
  `contact_email` varchar(255) DEFAULT NULL,
  `tracking_url` varchar(512) DEFAULT NULL,
  `awb_number` varchar(100) DEFAULT NULL,
  `courier_name` varchar(100) DEFAULT NULL,
  `agent_name` varchar(100) DEFAULT NULL,
  `agent_phone` varchar(20) DEFAULT NULL,
  `estimated_delivery` datetime DEFAULT NULL,
  `actual_delivery` datetime DEFAULT NULL,
  `meta_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_fulfillment_role` (`ondc_order_id`,`fulfillment_role`),
  KEY `idx_order` (`ondc_order_id`),
  KEY `idx_txn` (`transaction_id`),
  KEY `idx_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_issues` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `issue_id` varchar(128) NOT NULL,
  `transaction_id` varchar(128) NOT NULL DEFAULT '',
  `order_id` varchar(128) NOT NULL DEFAULT '',
  `bap_id` varchar(255) NOT NULL DEFAULT '',
  `category` enum('ITEM','FULFILLMENT','PAYMENT','AGENT','GRIEVANCE') NOT NULL DEFAULT 'ITEM',
  `sub_category` varchar(128) DEFAULT NULL,
  `short_desc` varchar(512) NOT NULL DEFAULT '',
  `long_desc` text DEFAULT NULL,
  `status` enum('OPEN','PROCESSING','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  `expected_resolution_time` datetime DEFAULT NULL,
  `expected_response_time` datetime DEFAULT NULL,
  `resolution_json` text DEFAULT NULL,
  `actions_json` text NOT NULL DEFAULT '[]',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_issue_id` (`issue_id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_txn_id` (`transaction_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_orders` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ondc_order_id` varchar(128) NOT NULL,
  `transaction_id` varchar(128) NOT NULL,
  `message_id` varchar(100) NOT NULL,
  `domain` varchar(64) NOT NULL,
  `city` varchar(64) DEFAULT NULL,
  `country` varchar(16) DEFAULT NULL,
  `core_version` varchar(16) DEFAULT NULL,
  `bap_id` varchar(255) NOT NULL,
  `bap_uri` varchar(512) NOT NULL,
  `bpp_id` varchar(255) DEFAULT NULL,
  `provider_id` varchar(100) NOT NULL,
  `seller_id` bigint(20) unsigned NOT NULL,
  `store_id` bigint(20) unsigned DEFAULT NULL,
  `status` enum('CREATED','CONFIRMED','PACKED','AGENT_ASSIGNED','ORDER_PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','RETURNED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  `status_updated_at` timestamp NULL DEFAULT NULL,
  `payment_method` enum('COD','PREPAID') DEFAULT NULL,
  `payment_status` enum('NOT_PAID','PAID','FAILED','REFUNDED') DEFAULT NULL,
  `payment_transaction_ref` varchar(255) DEFAULT NULL,
  `payment_json` longtext DEFAULT NULL,
  `item_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `delivery_charges` decimal(12,2) NOT NULL DEFAULT 0.00,
  `packing_charges` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `convenience_fee` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `order_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `item_count` int(11) DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(64) DEFAULT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `billing_json` longtext DEFAULT NULL,
  `tracking_number` varchar(128) DEFAULT NULL,
  `tracking_link` text DEFAULT NULL,
  `logistics_provider` varchar(128) DEFAULT NULL,
  `cancel_reason_id` varchar(8) DEFAULT NULL,
  `return_reason_id` varchar(8) DEFAULT NULL,
  `raw_confirm_payload` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ondc_order_id` (`ondc_order_id`),
  KEY `idx_txn` (`transaction_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_seller` (`seller_id`),
  KEY `idx_status` (`status`),
  KEY `idx_bap` (`bap_id`),
  KEY `idx_customer_phone` (`customer_phone`),
  KEY `idx_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_order_actions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(128) NOT NULL,
  `ondc_order_id` varchar(128) NOT NULL,
  `action_type` enum('partial_cancel','return') NOT NULL,
  `action_id` varchar(64) NOT NULL,
  `flow_type` varchar(8) NOT NULL DEFAULT '3a',
  `item_id` varchar(191) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `quantity` int(10) unsigned NOT NULL DEFAULT 1,
  `reason_id` varchar(8) NOT NULL DEFAULT '001',
  `rejection_reason_id` varchar(8) DEFAULT NULL,
  `refund_amount` decimal(12,2) DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'initiated',
  `last_phase_sent` varchar(32) DEFAULT NULL,
  `meta_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_txn` (`transaction_id`),
  KEY `idx_order` (`ondc_order_id`),
  KEY `idx_action` (`action_id`),
  KEY `idx_type` (`action_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_order_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ondc_order_id` varchar(128) NOT NULL,
  `transaction_id` varchar(128) NOT NULL,
  `item_id` varchar(191) NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `variant_id` bigint(20) unsigned DEFAULT NULL,
  `provider_id` varchar(100) NOT NULL,
  `seller_id` bigint(20) unsigned NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL,
  `tax_percent` decimal(5,2) DEFAULT NULL,
  `line_amount` decimal(12,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `fulfillment_id` varchar(64) DEFAULT NULL,
  `raw_item_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_item` (`ondc_order_id`,`item_id`),
  KEY `idx_txn` (`transaction_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_variant` (`variant_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_seller` (`seller_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_order_status_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ondc_order_id` varchar(128) NOT NULL,
  `from_status` varchar(50) DEFAULT NULL,
  `to_status` varchar(50) NOT NULL,
  `fulfillment_state` varchar(50) DEFAULT NULL,
  `triggered_by` varchar(50) NOT NULL DEFAULT 'system',
  `note` varchar(255) DEFAULT NULL,
  `payload_json` longtext DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_order` (`ondc_order_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_ppf_recon` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ondc_order_id` varchar(128) NOT NULL,
  `transaction_id` varchar(64) NOT NULL,
  `bap_id` varchar(191) NOT NULL DEFAULT '',
  `bap_uri` varchar(255) NOT NULL DEFAULT '',
  `message_id` varchar(191) NOT NULL DEFAULT '',
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `total_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `settlements_json` longtext NOT NULL,
  `recon_accord` tinyint(1) DEFAULT NULL COMMENT 'NULL=pending, 1=accord, 0=dispute',
  `on_recon_payload` longtext DEFAULT NULL COMMENT 'Raw on_receiver_recon body from BAP',
  `http_status` smallint(6) DEFAULT NULL COMMENT 'HTTP code from BAP recon endpoint',
  `status` enum('INITIATED','ACKED','ACCORD','DISPUTE','FAILED') NOT NULL DEFAULT 'INITIATED',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_order` (`ondc_order_id`),
  KEY `idx_txn` (`transaction_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_ratings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(128) NOT NULL DEFAULT '',
  `rating_category` varchar(50) NOT NULL DEFAULT 'Order',
  `rated_id` varchar(255) NOT NULL DEFAULT '',
  `rating_value` decimal(4,2) DEFAULT NULL,
  `bap_id` varchar(255) NOT NULL DEFAULT '',
  `domain` varchar(100) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_txn_category` (`transaction_id`,`rating_category`),
  KEY `idx_rated_id` (`rated_id`),
  KEY `idx_rating_category` (`rating_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `ondc_ratings`
  ADD COLUMN IF NOT EXISTS `order_id` varchar(128) NOT NULL DEFAULT '' AFTER `transaction_id`;
ALTER TABLE `ondc_ratings` DROP INDEX IF EXISTS `uq_txn_category`;
ALTER TABLE `ondc_ratings`
  ADD UNIQUE KEY IF NOT EXISTS `uq_txn_cat_rated` (`transaction_id`,`rating_category`,`rated_id`);
ALTER TABLE `ondc_ratings` ADD INDEX IF NOT EXISTS `idx_order_id` (`order_id`);

CREATE TABLE IF NOT EXISTS `ondc_rsf` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `recon_transaction_id` varchar(64) NOT NULL,
  `recon_message_id` varchar(191) NOT NULL DEFAULT '',
  `order_id` varchar(128) NOT NULL DEFAULT '',
  `provider_id` varchar(100) DEFAULT NULL,
  `seller_id` bigint(20) unsigned DEFAULT NULL,
  `recon_type` varchar(128) NOT NULL DEFAULT '',
  `buyer_bap_id` varchar(191) NOT NULL DEFAULT '',
  `buyer_bap_uri` varchar(255) NOT NULL DEFAULT '',
  `recon_status` varchar(32) NOT NULL DEFAULT '',
  `recon_accord` tinyint(1) DEFAULT NULL,
  `last_updated_at` datetime DEFAULT NULL,
  `settlement_row_ids` longtext DEFAULT NULL,
  `raw_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recon_txn` (`recon_transaction_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_seller` (`seller_id`),
  KEY `idx_recon_status` (`recon_status`),
  KEY `idx_last_updated` (`last_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_settlements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `txn_id` varchar(64) NOT NULL,
  `order_id` varchar(128) NOT NULL DEFAULT '',
  `provider_id` varchar(100) DEFAULT NULL,
  `seller_id` bigint(20) unsigned DEFAULT NULL,
  `buyer_bap_id` varchar(191) NOT NULL DEFAULT '',
  `buyer_bap_uri` varchar(255) NOT NULL DEFAULT '',
  `recon_type` varchar(128) NOT NULL DEFAULT '',
  `recon_status` varchar(32) NOT NULL DEFAULT '',
  `recon_accord` tinyint(1) DEFAULT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `order_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `settlement_total` decimal(18,2) NOT NULL DEFAULT 0.00,
  `settlement_amount_total` decimal(18,2) NOT NULL DEFAULT 0.00,
  `commission_total` decimal(18,2) NOT NULL DEFAULT 0.00,
  `withholding_total` decimal(18,2) NOT NULL DEFAULT 0.00,
  `tcs_total` decimal(18,2) NOT NULL DEFAULT 0.00,
  `tds_total` decimal(18,2) NOT NULL DEFAULT 0.00,
  `settlement_row_ids` longtext DEFAULT NULL,
  `settlement_statuses` longtext DEFAULT NULL,
  `settlement_breakup_json` longtext DEFAULT NULL,
  `collector_request_at` datetime DEFAULT NULL,
  `receiver_recon_received_at` datetime DEFAULT NULL,
  `receiver_on_recon_sent_at` datetime DEFAULT NULL,
  `collector_on_recon_received_at` datetime DEFAULT NULL,
  `last_updated_at` datetime DEFAULT NULL,
  `msg_collector_recon` varchar(191) NOT NULL DEFAULT '',
  `msg_receiver_in` varchar(191) NOT NULL DEFAULT '',
  `msg_receiver_on_recon` varchar(191) NOT NULL DEFAULT '',
  `msg_collector_receive` varchar(191) NOT NULL DEFAULT '',
  `collector_request_target` varchar(255) NOT NULL DEFAULT '',
  `collector_request_http_code` varchar(16) NOT NULL DEFAULT '',
  `collector_request_response_raw` mediumtext DEFAULT NULL,
  `collector_request_curl_error` text DEFAULT NULL,
  `receiver_on_recon_target` varchar(255) NOT NULL DEFAULT '',
  `receiver_on_recon_http_code` varchar(16) NOT NULL DEFAULT '',
  `receiver_on_recon_response_raw` mediumtext DEFAULT NULL,
  `receiver_on_recon_curl_error` text DEFAULT NULL,
  `payload_collector_recon` longtext DEFAULT NULL,
  `payload_receiver_in` longtext DEFAULT NULL,
  `payload_receiver_on_recon` longtext DEFAULT NULL,
  `payload_collector_on_recon` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_txn_id` (`txn_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_seller` (`seller_id`),
  KEY `idx_recon_status` (`recon_status`),
  KEY `idx_last_updated` (`last_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_transactions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(100) NOT NULL,
  `bap_id` varchar(255) DEFAULT NULL,
  `bpp_id` varchar(255) DEFAULT NULL,
  `domain` varchar(50) DEFAULT NULL,
  `city` varchar(20) DEFAULT NULL,
  `country` varchar(10) DEFAULT NULL,
  `core_version` varchar(10) DEFAULT NULL,
  `status` enum('SEARCH','SELECT','INIT','CONFIRM','COMPLETED','CANCELLED') DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_txn_id` (`transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ondc_txn_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(100) NOT NULL,
  `message_id` varchar(100) NOT NULL,
  `action` varchar(50) NOT NULL,
  `direction` enum('inbound','outbound') NOT NULL,
  `bap_id` varchar(255) DEFAULT NULL,
  `bpp_id` varchar(255) DEFAULT NULL,
  `domain` varchar(50) DEFAULT NULL,
  `http_status` smallint(5) unsigned DEFAULT NULL,
  `ack_status` enum('ACK','NACK') DEFAULT NULL,
  `payload_json` longtext NOT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_txn` (`transaction_id`),
  KEY `idx_msg` (`message_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `overall_txns` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `txn_id` varchar(128) NOT NULL,
  `provider_id` varchar(100) DEFAULT NULL,
  `on_search` tinyint(1) DEFAULT NULL,
  `on_select` tinyint(1) DEFAULT NULL,
  `product_id` varchar(191) DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `item_count` int(11) DEFAULT NULL,
  `on_init` tinyint(1) DEFAULT NULL,
  `on_confirm` tinyint(1) DEFAULT NULL,
  `order_amount` decimal(12,2) DEFAULT NULL,
  `payment_status` varchar(64) DEFAULT NULL,
  `payment_method` varchar(64) DEFAULT NULL,
  `on_status` tinyint(1) DEFAULT NULL,
  `on_track` tinyint(1) DEFAULT NULL,
  `track_link` text DEFAULT NULL,
  `order_status` varchar(96) DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_txn_id` (`txn_id`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_updated_at` (`updated_at`),
  KEY `idx_archived` (`is_archived`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- STEP 3 — PPF/RSF recon extended columns (NTS10 v2.0.0 bidirectional flow)
-- -----------------------------------------------------------------------------
ALTER TABLE `ondc_ppf_recon` ADD COLUMN IF NOT EXISTS `order_status` varchar(50) DEFAULT NULL AFTER `ondc_order_id`;
ALTER TABLE `ondc_ppf_recon` ADD COLUMN IF NOT EXISTS `quote_json` longtext DEFAULT NULL AFTER `total_amount`;
ALTER TABLE `ondc_ppf_recon` ADD COLUMN IF NOT EXISTS `direction` varchar(20) NOT NULL DEFAULT 'OUTBOUND' AFTER `settlements_json`;
ALTER TABLE `ondc_ppf_recon` ADD COLUMN IF NOT EXISTS `inbound_recon_payload` longtext DEFAULT NULL AFTER `direction`;
ALTER TABLE `ondc_ppf_recon` ADD COLUMN IF NOT EXISTS `outbound_on_recon_payload` longtext DEFAULT NULL AFTER `on_recon_payload`;

SET FOREIGN_KEY_CHECKS = 1;
