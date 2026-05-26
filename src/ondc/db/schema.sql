-- =============================================================================
-- ondc_odop_db — complete schema (storefront + ONDC BPP).
--
-- Dumped from final_ondc_odop_db after migration 001_setup_ondc.sql ran. To
-- bring a fresh database to this exact shape:
--   CREATE DATABASE ondc_odop_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   mysql ondc_odop_db < src/ondc/db/schema.sql
-- =============================================================================

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `account` (
  `id` varchar(191) NOT NULL,
  `userId` int(11) NOT NULL,
  `type` enum('CREDENTIALS','GOOGLE','GITHUB') NOT NULL,
  `provider` enum('CREDENTIALS','GOOGLE','GITHUB') NOT NULL,
  `providerAccountId` varchar(191) NOT NULL,
  `refreshToken` text DEFAULT NULL,
  `accessToken` text DEFAULT NULL,
  `expiresAt` int(11) DEFAULT NULL,
  `tokenType` varchar(191) DEFAULT NULL,
  `scope` varchar(191) DEFAULT NULL,
  `idToken` text DEFAULT NULL,
  `sessionState` varchar(191) DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE','PENDING','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  `phoneNumberVerifiedAt` datetime(3) DEFAULT NULL,
  `emailVerifiedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Account_provider_providerAccountId_key` (`provider`,`providerAccountId`),
  KEY `Account_userId_fkey` (`userId`),
  CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admin_district_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) NOT NULL,
  `district_name` varchar(120) NOT NULL,
  `assigned_by` int(11) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_district_assignments_admin_id_key` (`admin_id`),
  KEY `admin_district_assignments_district_name_idx` (`district_name`),
  KEY `admin_district_assignments_assigned_by_idx` (`assigned_by`),
  CONSTRAINT `admin_district_assignments_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `admin_district_assignments_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `announcement` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `text` varchar(191) NOT NULL,
  `contactPhone` varchar(191) DEFAULT NULL,
  `contactEmail` varchar(191) DEFAULT NULL,
  `isPublished` tinyint(1) NOT NULL DEFAULT 0,
  `startAt` datetime(3) DEFAULT NULL,
  `endAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `deletedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Announcement_isPublished_idx` (`isPublished`),
  KEY `Announcement_startAt_endAt_idx` (`startAt`,`endAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `authtoken` (
  `token` varchar(191) NOT NULL,
  `phoneNumber` varchar(191) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `expiresAt` datetime(3) NOT NULL,
  `type` enum('RESET_PASSWORD','VERIFICATION','FORGOT_PASSWORD') NOT NULL,
  `usedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`token`),
  UNIQUE KEY `AuthToken_phoneNumber_token_key` (`phoneNumber`,`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `bap_terms` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `blogs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `subheading` varchar(255) DEFAULT NULL,
  `content` longtext NOT NULL,
  `featuredImage` varchar(500) DEFAULT NULL,
  `slug` varchar(255) NOT NULL,
  `isPublished` tinyint(1) NOT NULL DEFAULT 1,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `deletedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `blogs_slug_key` (`slug`),
  KEY `blogs_isPublished_idx` (`isPublished`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `bulk_order_enquiries` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `department_name` varchar(255) NOT NULL COMMENT 'Department or Organization Name',
  `contact_person` varchar(255) NOT NULL COMMENT 'Name of the contact person',
  `email` varchar(255) NOT NULL COMMENT 'Official Email ID',
  `country_code` varchar(10) NOT NULL DEFAULT '+91',
  `mobile_number` varchar(20) NOT NULL,
  `office_address` text NOT NULL COMMENT 'Complete office address',
  `requirement_description` text NOT NULL COMMENT 'Details of items, quantities, etc.',
  `attachment_url` varchar(1024) DEFAULT NULL COMMENT 'Path to uploaded file (PDF/DOC)',
  `status` enum('pending','in_progress','reviewed','completed','cancelled') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bulk_email` (`email`),
  KEY `idx_bulk_status` (`status`),
  KEY `idx_bulk_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cart_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cart_id` bigint(20) unsigned NOT NULL,
  `store_id` bigint(20) unsigned NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `variant_id` bigint(20) unsigned NOT NULL DEFAULT 0,
  `qty` int(11) NOT NULL,
  `price_snapshot` decimal(12,2) NOT NULL,
  `mrp_snapshot` decimal(12,2) DEFAULT NULL,
  `tax_snapshot` decimal(12,2) DEFAULT NULL,
  `discount_snapshot` decimal(12,2) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `cart_items_cart_id_idx` (`cart_id`),
  KEY `cart_items_store_id_idx` (`store_id`),
  KEY `cart_items_product_id_idx` (`product_id`),
  KEY `cart_items_variant_id_idx` (`variant_id`),
  CONSTRAINT `cart_items_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `cart_items_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `carts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `session_id` varchar(100) DEFAULT NULL,
  `status` enum('active','abandoned','converted') NOT NULL DEFAULT 'active',
  `currency` char(3) DEFAULT 'INR',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `carts_user_id_key` (`user_id`),
  UNIQUE KEY `carts_session_id_key` (`session_id`),
  KEY `carts_user_id_idx` (`user_id`),
  KEY `carts_session_id_idx` (`session_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `categories` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `parent_id` bigint(20) unsigned DEFAULT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `categories_slug_key` (`slug`),
  KEY `categories_parent_id_idx` (`parent_id`),
  CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24001 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `category_filters` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `category_id` bigint(20) unsigned NOT NULL,
  `filter_id` bigint(20) unsigned NOT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_filters_category_id_filter_id_key` (`category_id`,`filter_id`),
  KEY `category_filters_category_id_idx` (`category_id`),
  KEY `category_filters_filter_id_idx` (`filter_id`),
  CONSTRAINT `category_filters_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_filters_filter_id_fkey` FOREIGN KEY (`filter_id`) REFERENCES `cms_filters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=158 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `category_mappings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `category_id` bigint(20) unsigned NOT NULL,
  `ondc_category_id` bigint(20) unsigned NOT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `confidence` varchar(50) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `category_mappings_category_id_idx` (`category_id`),
  KEY `category_mappings_ondc_category_id_idx` (`ondc_category_id`),
  CONSTRAINT `category_mappings_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_mappings_ondc_category_id_fkey` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cms_filter_values` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `filter_id` bigint(20) unsigned NOT NULL,
  `label` varchar(160) NOT NULL,
  `value` varchar(160) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cms_filter_values_filter_id_value_key` (`filter_id`,`value`),
  KEY `cms_filter_values_filter_id_idx` (`filter_id`),
  CONSTRAINT `cms_filter_values_filter_id_fkey` FOREIGN KEY (`filter_id`) REFERENCES `cms_filters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=147 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cms_filters` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `slug` varchar(140) NOT NULL,
  `group_type` enum('checkbox','radio','range','dropdown') NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cms_filters_slug_key` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cmsslider` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pageId` bigint(20) unsigned DEFAULT NULL,
  `imageUploadId` bigint(20) unsigned DEFAULT NULL,
  `imageUrl` varchar(800) DEFAULT NULL,
  `image` varchar(191) DEFAULT NULL,
  `imageMobile` varchar(191) DEFAULT NULL,
  `heading` varchar(200) NOT NULL,
  `subheading` varchar(240) DEFAULT NULL,
  `buttonText` varchar(60) DEFAULT NULL,
  `button_redirect` varchar(500) DEFAULT NULL,
  `sortOrder` int(11) NOT NULL DEFAULT 0,
  `isActive` tinyint(1) NOT NULL DEFAULT 1,
  `createdBy` bigint(20) unsigned DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) DEFAULT NULL,
  `deletedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `contactmessage` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fullName` varchar(191) NOT NULL,
  `email` varchar(191) NOT NULL,
  `orderNumber` varchar(191) DEFAULT NULL,
  `topic` enum('GENERAL_INQUIRY','ORDER_STATUS','RETURNS') NOT NULL,
  `message` varchar(191) NOT NULL,
  `status` enum('RESOLVED','UNRESOLVED') NOT NULL DEFAULT 'UNRESOLVED',
  `adminNotes` varchar(191) DEFAULT NULL,
  `resolvedBy` int(11) DEFAULT NULL,
  `resolvedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inventory` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `store_location_id` bigint(20) unsigned NOT NULL,
  `variant_id` bigint(20) unsigned NOT NULL,
  `qty_on_hand` int(11) NOT NULL DEFAULT 0,
  `qty_reserved` int(11) NOT NULL DEFAULT 0,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_store_location_id_variant_id_key` (`store_location_id`,`variant_id`),
  KEY `inventory_variant_id_idx` (`variant_id`),
  CONSTRAINT `inventory_store_location_id_fkey` FOREIGN KEY (`store_location_id`) REFERENCES `store_locations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inventory_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=313 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inventory_movements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `inventory_id` bigint(20) unsigned NOT NULL,
  `movement_type` enum('IN','OUT','ADJUSTMENT','RETURN') NOT NULL,
  `qty_delta` int(11) NOT NULL,
  `reference_id` varchar(255) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `inventory_movements_inventory_id_idx` (`inventory_id`),
  CONSTRAINT `inventory_movements_inventory_id_fkey` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `media_files` (
  `id` varchar(191) NOT NULL,
  `file_type` enum('IMAGE','PDF','DOC','OTHER') NOT NULL,
  `original_name` varchar(191) NOT NULL,
  `mime_type` varchar(191) NOT NULL,
  `file_size_bytes` int(11) NOT NULL,
  `storage_provider` enum('LOCAL','S3','CDN') NOT NULL DEFAULT 'LOCAL',
  `storage_path` varchar(191) NOT NULL,
  `public_url` varchar(191) NOT NULL,
  `checksum_sha256` varchar(191) NOT NULL,
  `uploaded_by` int(11) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_attribute_rules` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_catalog_items` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_catalog_rejections` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_categories` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `domain` varchar(100) DEFAULT NULL,
  `ondc_category_code` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `parent_id` bigint(20) unsigned DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `ondc_categories_parent_id_idx` (`parent_id`),
  CONSTRAINT `ondc_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `ondc_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_category_mappings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `domain_name` varchar(100) DEFAULT NULL,
  `category` varchar(255) DEFAULT NULL,
  `ondc_category_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ondc_category_mappings_product_id_idx` (`product_id`),
  KEY `ondc_category_mappings_ondc_category_id_fkey` (`ondc_category_id`),
  CONSTRAINT `ondc_category_mappings_ondc_category_id_fkey` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ondc_category_mappings_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_customer_ticket` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_errors` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_fulfillments` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_issues` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_order_actions` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_order_items` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_order_status_history` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_orders` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_ppf_recon` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_ratings` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_rsf` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_settlements` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_transactions` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ondc_txn_logs` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `order_addresses` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint(20) unsigned NOT NULL,
  `type` enum('billing','shipping') NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `address_line1` varchar(255) NOT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `city` varchar(120) NOT NULL,
  `state` varchar(120) NOT NULL,
  `country` varchar(120) NOT NULL,
  `pincode` varchar(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `order_addresses_order_id_fkey` (`order_id`),
  CONSTRAINT `order_addresses_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `order_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint(20) unsigned NOT NULL,
  `order_seller_unit_id` bigint(20) unsigned DEFAULT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `variant_id` bigint(20) unsigned NOT NULL DEFAULT 0,
  `qty` int(11) NOT NULL,
  `price_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `item_status` enum('pending','confirmed','processing','shipped','delivered','cancelled','returned') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `order_items_order_id_fkey` (`order_id`),
  CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `orders` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_no` varchar(50) NOT NULL,
  `user_id` int(11) NOT NULL,
  `cart_id` bigint(20) unsigned NOT NULL,
  `order_status` enum('CREATED','PAYMENT_PENDING','PAID','CONFIRMED','SHIPPED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  `total_items` int(11) DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT NULL,
  `tax_total` decimal(12,2) DEFAULT NULL,
  `shipping_total` decimal(12,2) DEFAULT NULL,
  `discount_total` decimal(12,2) DEFAULT NULL,
  `grand_total` decimal(12,2) DEFAULT NULL,
  `payment_status` enum('PENDING','PAID','FAILED','REFUNDED') DEFAULT NULL,
  `currency` char(3) NOT NULL DEFAULT 'INR',
  `invoice_url` longtext DEFAULT NULL,
  `ondc_order_id` varchar(100) DEFAULT NULL,
  `ondc_transaction_id` varchar(100) DEFAULT NULL,
  `total_amount` decimal(12,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `orders_order_no_key` (`order_no`),
  KEY `orders_user_id_fkey` (`user_id`),
  CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `otp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `phoneNumber` varchar(191) NOT NULL,
  `code` varchar(191) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `expiresAt` datetime(3) NOT NULL,
  `usedAt` datetime(3) DEFAULT NULL,
  `authToken` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Otp_authToken_fkey` (`authToken`),
  CONSTRAINT `Otp_authToken_fkey` FOREIGN KEY (`authToken`) REFERENCES `authtoken` (`token`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `overall_txns` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_attributes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `attribute_key` varchar(255) NOT NULL,
  `attribute_value` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `product_attributes_product_id_idx` (`product_id`),
  CONSTRAINT `product_attributes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=342 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_filters` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `filter_id` bigint(20) unsigned NOT NULL,
  `filter_value_id` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `product_filters_product_filter_value_key` (`product_id`,`filter_id`,`filter_value_id`),
  KEY `product_filters_product_id_idx` (`product_id`),
  KEY `product_filters_filter_id_idx` (`filter_id`),
  KEY `product_filters_filter_value_id_idx` (`filter_value_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1821 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_images` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `image_url` varchar(500) NOT NULL,
  `alt_text` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `product_images_product_id_idx` (`product_id`),
  CONSTRAINT `product_images_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1884 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_ondc_attributes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `variant_id` bigint(20) unsigned DEFAULT NULL,
  `attribute_key` varchar(255) NOT NULL,
  `attribute_value` text DEFAULT NULL,
  `color_name` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `product_ondc_attributes_product_id_idx` (`product_id`),
  KEY `product_ondc_attributes_variant_id_idx` (`variant_id`),
  CONSTRAINT `product_ondc_attributes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `product_ondc_attributes_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1407 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_reviews` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `user_id` int(11) NOT NULL,
  `rating` tinyint(4) NOT NULL,
  `review_text` text DEFAULT NULL,
  `review_image` varchar(500) DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_product_reviews_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_product_reviews_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_serviceable_cities` (
  `product_id` bigint(20) unsigned NOT NULL,
  `city` varchar(255) NOT NULL,
  PRIMARY KEY (`product_id`,`city`),
  CONSTRAINT `product_serviceable_cities_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_serviceable_pincodes` (
  `product_id` bigint(20) unsigned NOT NULL,
  `pincode` varchar(20) NOT NULL,
  PRIMARY KEY (`product_id`,`pincode`),
  CONSTRAINT `product_serviceable_pincodes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_variants` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `parent_variant_id` bigint(20) unsigned DEFAULT NULL,
  `level_index` tinyint(3) unsigned DEFAULT NULL,
  `level_name` varchar(255) DEFAULT NULL,
  `attribute_value` varchar(255) DEFAULT NULL,
  `color_code` varchar(255) DEFAULT NULL,
  `variant_name` varchar(255) NOT NULL,
  `sku` varchar(255) DEFAULT NULL,
  `gtin_ean` varchar(255) DEFAULT NULL,
  `price` decimal(12,2) DEFAULT NULL,
  `mrp` decimal(12,2) DEFAULT NULL,
  `unit_count` decimal(10,2) DEFAULT NULL,
  `unit_type` enum('unit','gram','kilogram','tonne','millilitre','litre','dozen') DEFAULT NULL,
  `product_weight_gm` int(11) DEFAULT NULL,
  `product_length_cm` decimal(8,2) DEFAULT NULL,
  `product_width_cm` decimal(8,2) DEFAULT NULL,
  `product_height_cm` decimal(8,2) DEFAULT NULL,
  `shipping_pkg_weight_gm` int(11) DEFAULT NULL,
  `shipping_pkg_length_cm` decimal(8,2) DEFAULT NULL,
  `shipping_pkg_width_cm` decimal(8,2) DEFAULT NULL,
  `shipping_pkg_height_cm` decimal(8,2) DEFAULT NULL,
  `min_purchase_limit` int(11) DEFAULT NULL,
  `max_purchase_limit` int(11) DEFAULT NULL,
  `standard_package_qty` int(11) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `product_variants_sku_key` (`sku`),
  UNIQUE KEY `product_variants_product_id_sku_key` (`product_id`,`sku`),
  KEY `product_variants_product_id_idx` (`product_id`),
  KEY `product_variants_parent_variant_id_fkey` (`parent_variant_id`),
  CONSTRAINT `product_variants_parent_variant_id_fkey` FOREIGN KEY (`parent_variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `product_variants_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=329 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_verification` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` bigint(20) unsigned NOT NULL,
  `store_id` bigint(20) unsigned NOT NULL,
  `approval_status` enum('approved','rejected','pending') DEFAULT 'pending',
  `reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  KEY `store_id` (`store_id`),
  CONSTRAINT `product_verification_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `product_verification_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=153 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `products` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `store_id` bigint(20) unsigned NOT NULL,
  `category_id` bigint(20) unsigned NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `artisan_name` varchar(255) DEFAULT NULL,
  `artisan_location` varchar(255) DEFAULT NULL,
  `district` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `hsn_sac_code` varchar(255) DEFAULT NULL,
  `gst_percent` int(11) NOT NULL DEFAULT 0,
  `gtin_ean` varchar(255) DEFAULT NULL,
  `stock` bigint(20) NOT NULL DEFAULT 0,
  `force_out_of_stock` tinyint(1) NOT NULL DEFAULT 0,
  `unit_count` decimal(10,2) DEFAULT NULL,
  `unit_type` enum('unit','gram','kilogram','tonne','millilitre','litre','dozen') DEFAULT NULL,
  `brand` varchar(255) DEFAULT NULL,
  `manufacturing_month` varchar(50) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `country_of_origin` varchar(100) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `return_days_window` int(11) DEFAULT NULL,
  `seller_pickup_return` tinyint(1) NOT NULL DEFAULT 0,
  `is_cod_available` tinyint(1) NOT NULL DEFAULT 1,
  `publish_status` enum('draft','publish','unpublish') NOT NULL DEFAULT 'draft',
  `is_manufacturer` tinyint(1) NOT NULL DEFAULT 0,
  `manufacturer_name` varchar(255) DEFAULT NULL,
  `manufacturer_address` text DEFAULT NULL,
  `currency` char(3) NOT NULL DEFAULT 'INR',
  `default_price` decimal(12,2) NOT NULL,
  `mrp` decimal(12,2) NOT NULL,
  `avg_rating` decimal(10,2) NOT NULL DEFAULT 0.00,
  `review_count` int(11) NOT NULL DEFAULT 0,
  `min_purchase_limit` int(11) DEFAULT 1,
  `max_purchase_limit` int(11) DEFAULT NULL,
  `standard_package_qty` int(11) DEFAULT NULL,
  `low_stock_qty` int(11) DEFAULT NULL,
  `order_mode` enum('ONLINE','BUYQ','BOTH') NOT NULL DEFAULT 'ONLINE',
  `visibility` enum('PUBLIC','BUSINESS') NOT NULL DEFAULT 'PUBLIC',
  `alias_slug` varchar(255) DEFAULT NULL,
  `seo_title` varchar(255) DEFAULT NULL,
  `seo_description` varchar(500) DEFAULT NULL,
  `seo_keywords` varchar(500) DEFAULT NULL,
  `disable_for_bots` tinyint(1) NOT NULL DEFAULT 0,
  `availability_mode` enum('SELLER_DEFAULT','ALL_INDIA','CITIES','PINCODES') NOT NULL DEFAULT 'SELLER_DEFAULT',
  `cancellable` enum('DEFAULT','YES','NO') NOT NULL DEFAULT 'DEFAULT',
  `returnable` enum('DEFAULT','YES','NO') NOT NULL DEFAULT 'DEFAULT',
  `time_to_ship_value` int(11) DEFAULT NULL,
  `time_to_ship_unit` enum('MINUTES','HOURS','DAYS') DEFAULT NULL,
  `instructions` text DEFAULT NULL,
  `storage_conditions` text DEFAULT NULL,
  `included_items` text DEFAULT NULL,
  `size_chart_url` varchar(500) DEFAULT NULL,
  `gi_tag` tinyint(1) NOT NULL DEFAULT 0,
  `silk_mark` tinyint(1) NOT NULL DEFAULT 0,
  `no_of_variants` int(11) NOT NULL DEFAULT 0,
  `have_ondc_attributes` tinyint(1) NOT NULL DEFAULT 0,
  `product_weight_gm` int(11) DEFAULT NULL,
  `product_length_cm` decimal(8,2) DEFAULT NULL,
  `product_width_cm` decimal(8,2) DEFAULT NULL,
  `product_height_cm` decimal(8,2) DEFAULT NULL,
  `package_weight_gm` int(11) DEFAULT NULL,
  `package_length_cm` decimal(8,2) DEFAULT NULL,
  `package_width_cm` decimal(8,2) DEFAULT NULL,
  `package_height_cm` decimal(8,2) DEFAULT NULL,
  `ondc_subcategory` varchar(512) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `products_alias_slug_key` (`alias_slug`),
  KEY `products_store_id_idx` (`store_id`),
  KEY `products_category_id_idx` (`category_id`),
  KEY `products_publish_status_idx` (`publish_status`),
  CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `products_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=161 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `profile` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userId` int(11) NOT NULL,
  `about` varchar(191) DEFAULT NULL,
  `region` varchar(191) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Profile_userId_key` (`userId`),
  CONSTRAINT `Profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `returns` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint(20) unsigned NOT NULL,
  `order_item_id` bigint(20) unsigned NOT NULL,
  `reason` text NOT NULL,
  `refund_amount` decimal(12,2) NOT NULL,
  `refund_mode` enum('original','bank_transfer','wallet','store_credit') NOT NULL,
  `status` enum('pending','approved','rejected','refunded') NOT NULL DEFAULT 'pending',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `returns_order_id_fkey` (`order_id`),
  KEY `returns_order_item_id_fkey` (`order_item_id`),
  CONSTRAINT `returns_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `returns_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `seller_profiles` (
  `user_id` int(11) NOT NULL,
  `business_type` enum('GST','Non-GST') DEFAULT NULL,
  `gstin` varchar(15) DEFAULT NULL,
  `gst_image` varchar(500) DEFAULT NULL,
  `business_name` varchar(255) DEFAULT NULL,
  `enrollment_number` varchar(100) DEFAULT NULL,
  `aadhar_number` varchar(12) DEFAULT NULL,
  `aadhar_image` varchar(500) DEFAULT NULL,
  `pan` varchar(10) DEFAULT NULL,
  `pan_image` varchar(500) DEFAULT NULL,
  `bank_account_no` varchar(34) DEFAULT NULL,
  `bank_image` varchar(500) DEFAULT NULL,
  `bank_ifsc` varchar(11) DEFAULT NULL,
  `upi_id` varchar(256) DEFAULT NULL,
  `district` varchar(100) DEFAULT NULL,
  `kyc_status` enum('PENDING','SUBMITTED','IN_REVIEW','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `approval_status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `reject_note` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `seller_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `seller_units` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint(20) unsigned NOT NULL,
  `seller_id` int(11) NOT NULL,
  `store_id` bigint(20) unsigned NOT NULL,
  `status` enum('pending','confirmed','processing','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  `tracking_no` varchar(100) DEFAULT NULL,
  `logistics_provider` varchar(100) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `seller_units_order_id_fkey` (`order_id`),
  CONSTRAINT `seller_units_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `store_locations` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `store_id` bigint(20) unsigned NOT NULL,
  `location_type` enum('DELIVERY','SELF_PICKUP','RETURN') NOT NULL,
  `address_line1` varchar(255) NOT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `city` varchar(120) NOT NULL,
  `state` varchar(120) NOT NULL,
  `country` varchar(120) NOT NULL,
  `pincode` varchar(20) NOT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `radius_km` int(11) DEFAULT NULL,
  `time_from` smallint(6) DEFAULT NULL COMMENT 'HHMM, e.g. 900 = 09:00',
  `time_to` smallint(6) DEFAULT NULL COMMENT 'HHMM, e.g. 2100 = 21:00',
  `day_from` tinyint(4) DEFAULT NULL COMMENT '1=Mon ... 7=Sun',
  `day_to` tinyint(4) DEFAULT NULL COMMENT '1=Mon ... 7=Sun',
  `fulfillment_type` varchar(32) DEFAULT 'Delivery',
  `radius` bigint(20) unsigned DEFAULT NULL,
  `opening_time` int(11) DEFAULT NULL,
  `closing_time` int(11) DEFAULT NULL,
  `serviceability` int(11) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `store_locations_store_id_idx` (`store_id`),
  KEY `store_locations_store_id_location_type_idx` (`store_id`,`location_type`),
  CONSTRAINT `store_locations_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `seller_user_id` int(11) NOT NULL,
  `store_name` varchar(255) NOT NULL,
  `store_slug` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `support_email` varchar(255) DEFAULT NULL,
  `support_phone` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `deleted_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `stores_store_slug_key` (`store_slug`),
  KEY `stores_seller_user_id_idx` (`seller_user_id`),
  KEY `stores_seller_user_id_deleted_at_idx` (`seller_user_id`,`deleted_at`),
  CONSTRAINT `stores_seller_user_id_fkey` FOREIGN KEY (`seller_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `support_ticket_messages` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint(20) unsigned NOT NULL,
  `sender_user_id` bigint(20) unsigned NOT NULL,
  `sender_role` enum('USER','SELLER','ADMIN') NOT NULL,
  `message` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ticket_messages_ticket_id` (`ticket_id`),
  KEY `idx_ticket_messages_sender_user_id` (`sender_user_id`),
  CONSTRAINT `fk_ticket_messages_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `support_ticket_status_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint(20) unsigned NOT NULL,
  `old_status` varchar(40) DEFAULT NULL,
  `new_status` varchar(40) NOT NULL,
  `changed_by_user_id` bigint(20) unsigned DEFAULT NULL,
  `note` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ticket_history_ticket_id` (`ticket_id`),
  CONSTRAINT `fk_ticket_history_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `support_tickets` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ticket_no` varchar(32) NOT NULL,
  `user_id` int(11) NOT NULL,
  `order_id` bigint(20) unsigned NOT NULL,
  `order_item_id` bigint(20) unsigned DEFAULT NULL,
  `order_seller_unit_id` bigint(20) DEFAULT NULL,
  `seller_user_id` bigint(20) unsigned DEFAULT NULL,
  `store_id` bigint(20) unsigned DEFAULT NULL,
  `reason_code` varchar(40) NOT NULL,
  `reason_text` varchar(200) DEFAULT NULL,
  `comment` varchar(1000) NOT NULL,
  `status` enum('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED','REJECTED') NOT NULL DEFAULT 'OPEN',
  `priority` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
  `assigned_to_user_id` bigint(20) unsigned DEFAULT NULL,
  `resolution_note` varchar(1000) DEFAULT NULL,
  `last_message_at` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_support_tickets_ticket_no` (`ticket_no`),
  KEY `idx_support_tickets_user_id` (`user_id`),
  KEY `idx_support_tickets_order_id` (`order_id`),
  KEY `idx_support_tickets_order_item_id` (`order_item_id`),
  KEY `idx_support_tickets_order_seller_unit_id` (`order_seller_unit_id`),
  KEY `idx_support_tickets_seller_user_id` (`seller_user_id`),
  KEY `idx_support_tickets_store_id` (`store_id`),
  KEY `idx_support_tickets_status` (`status`),
  CONSTRAINT `fk_support_tickets_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_support_tickets_order_item` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `testimonial` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customerName` varchar(100) NOT NULL,
  `location` varchar(100) DEFAULT NULL,
  `testimonialText` text NOT NULL,
  `rating` int(11) NOT NULL DEFAULT 5,
  `customerPhoto` varchar(255) DEFAULT NULL,
  `productOrService` varchar(100) DEFAULT NULL,
  `isPublished` tinyint(1) NOT NULL DEFAULT 0,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `deletedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Testimonial_isPublished_idx` (`isPublished`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `email` varchar(191) DEFAULT NULL,
  `phoneNumber` varchar(191) NOT NULL,
  `password` varchar(191) DEFAULT NULL,
  `avatar` varchar(191) DEFAULT NULL,
  `role` enum('SUPER_ADMIN','ADMIN','USER','SELLER') NOT NULL DEFAULT 'USER',
  `isTwoFactorEnabled` tinyint(1) NOT NULL DEFAULT 0,
  `createdAt` datetime(3) DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_username_key` (`username`),
  UNIQUE KEY `User_phoneNumber_key` (`phoneNumber`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_addresses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `address_line1` varchar(255) NOT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `city` varchar(120) NOT NULL,
  `state` varchar(120) NOT NULL,
  `state_id` int(11) DEFAULT NULL,
  `city_id` int(11) DEFAULT NULL,
  `country` varchar(120) NOT NULL DEFAULT 'India',
  `pincode` varchar(20) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_addresses_user_id_idx` (`user_id`),
  CONSTRAINT `user_addresses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `variant_images` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `variant_id` bigint(20) unsigned NOT NULL,
  `image_url` varchar(500) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `variant_images_variant_id_idx` (`variant_id`),
  CONSTRAINT `variant_images_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=241 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `wishlist` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `product_id` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `wishlist_user_id_product_id_key` (`user_id`,`product_id`),
  KEY `wishlist_product_id_idx` (`product_id`),
  CONSTRAINT `wishlist_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `wishlist_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=122 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
