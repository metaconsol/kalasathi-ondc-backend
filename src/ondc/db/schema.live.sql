-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Jul 08, 2026 at 12:59 PM
-- Server version: 10.3.39-MariaDB
-- PHP Version: 8.4.20

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `final_ondc_odop_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `Account`
--

CREATE TABLE `Account` (
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
  `updatedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `admin_district_assignments`
--

CREATE TABLE `admin_district_assignments` (
  `id` int(11) NOT NULL,
  `admin_id` int(11) NOT NULL,
  `district_name` varchar(120) NOT NULL,
  `assigned_by` int(11) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Announcement`
--

CREATE TABLE `Announcement` (
  `id` int(11) NOT NULL,
  `text` varchar(191) NOT NULL,
  `contactPhone` varchar(191) DEFAULT NULL,
  `contactEmail` varchar(191) DEFAULT NULL,
  `isPublished` tinyint(1) NOT NULL DEFAULT 0,
  `startAt` datetime(3) DEFAULT NULL,
  `endAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `deletedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `artisan_stories`
--

CREATE TABLE `artisan_stories` (
  `id` bigint(20) NOT NULL,
  `craft_name` varchar(255) DEFAULT NULL,
  `artisan_name` varchar(255) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `hero_title` varchar(500) DEFAULT NULL,
  `hero_subtitle` text DEFAULT NULL,
  `story_title` varchar(255) DEFAULT NULL,
  `story_content` longtext DEFAULT NULL,
  `artisan_image` varchar(500) DEFAULT NULL,
  `is_featured` tinyint(1) DEFAULT 0,
  `publish_status` enum('draft','published') DEFAULT 'draft',
  `sort_order` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `seller_user_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `artisan_story_slider`
--

CREATE TABLE `artisan_story_slider` (
  `id` bigint(20) NOT NULL,
  `artisan_story_id` bigint(20) DEFAULT NULL,
  `slider_label` varchar(255) DEFAULT NULL,
  `slider_title` varchar(500) DEFAULT NULL,
  `slider_description` text DEFAULT NULL,
  `slider_image` varchar(500) DEFAULT NULL,
  `button_text` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `AuthToken`
--

CREATE TABLE `AuthToken` (
  `token` varchar(191) NOT NULL,
  `phoneNumber` varchar(191) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `expiresAt` datetime(3) NOT NULL,
  `type` enum('RESET_PASSWORD','VERIFICATION','FORGOT_PASSWORD') NOT NULL,
  `usedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bap_terms`
--

CREATE TABLE `bap_terms` (
  `id` int(11) NOT NULL,
  `bap_id` varchar(255) NOT NULL,
  `bap_uri` varchar(255) DEFAULT NULL,
  `unique_uid` varchar(255) DEFAULT NULL,
  `static_terms` text DEFAULT NULL,
  `static_terms_new` text DEFAULT NULL,
  `bff_percent` varchar(50) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `blogs`
--

CREATE TABLE `blogs` (
  `id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `subheading` varchar(255) DEFAULT NULL,
  `content` longtext NOT NULL,
  `featured_image` varchar(500) DEFAULT NULL,
  `author_name` varchar(255) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'DRAFT',
  `is_featured` tinyint(1) NOT NULL DEFAULT 0,
  `published_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  `featuredImage` varchar(500) DEFAULT NULL,
  `slug` varchar(255) NOT NULL,
  `short_description` varchar(500) DEFAULT NULL,
  `isPublished` tinyint(1) NOT NULL DEFAULT 1,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `deletedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bulk_order_enquiries`
--

CREATE TABLE `bulk_order_enquiries` (
  `id` bigint(20) UNSIGNED NOT NULL,
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
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `carts`
--

CREATE TABLE `carts` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) DEFAULT NULL,
  `session_id` varchar(100) DEFAULT NULL,
  `status` enum('active','abandoned','converted') NOT NULL DEFAULT 'active',
  `currency` char(3) DEFAULT 'INR',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  `applied_coupon_code` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cart_items`
--

CREATE TABLE `cart_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `cart_id` bigint(20) UNSIGNED NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED NOT NULL DEFAULT 0,
  `qty` int(11) NOT NULL,
  `price_snapshot` decimal(12,2) NOT NULL,
  `mrp_snapshot` decimal(12,2) DEFAULT NULL,
  `tax_snapshot` decimal(12,2) DEFAULT NULL,
  `discount_snapshot` decimal(12,2) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `categories`
--

CREATE TABLE `categories` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `parent_id` bigint(20) UNSIGNED DEFAULT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `category_filters`
--

CREATE TABLE `category_filters` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `category_id` bigint(20) UNSIGNED NOT NULL,
  `filter_id` bigint(20) UNSIGNED NOT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `category_mappings`
--

CREATE TABLE `category_mappings` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `category_id` bigint(20) UNSIGNED NOT NULL,
  `ondc_category_id` bigint(20) UNSIGNED NOT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `confidence` varchar(50) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cmsSlider`
--

CREATE TABLE `cmsSlider` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `pageId` bigint(20) UNSIGNED DEFAULT NULL,
  `imageUploadId` bigint(20) UNSIGNED DEFAULT NULL,
  `imageUrl` varchar(800) DEFAULT NULL,
  `image` varchar(191) DEFAULT NULL,
  `imageMobile` varchar(191) DEFAULT NULL,
  `heading` varchar(200) NOT NULL,
  `subheading` varchar(240) DEFAULT NULL,
  `buttonText` varchar(60) DEFAULT NULL,
  `button_redirect` varchar(500) DEFAULT NULL,
  `sortOrder` int(11) NOT NULL DEFAULT 0,
  `isActive` tinyint(1) NOT NULL DEFAULT 1,
  `createdBy` bigint(20) UNSIGNED DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) DEFAULT NULL,
  `deletedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cms_filters`
--

CREATE TABLE `cms_filters` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(120) NOT NULL,
  `slug` varchar(140) NOT NULL,
  `group_type` enum('checkbox','radio','range','dropdown') NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint(20) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cms_filter_values`
--

CREATE TABLE `cms_filter_values` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `filter_id` bigint(20) UNSIGNED NOT NULL,
  `label` varchar(160) NOT NULL,
  `value` varchar(160) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `consent_notices`
--

CREATE TABLE `consent_notices` (
  `version` varchar(20) NOT NULL,
  `consent_type` enum('data_processing','verification','accuracy_declaration','terms_privacy','marketing') NOT NULL,
  `body_en` text NOT NULL,
  `body_hi` text NOT NULL,
  `published_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `consent_records`
--

CREATE TABLE `consent_records` (
  `id` bigint(20) NOT NULL,
  `seller_id` varchar(32) NOT NULL,
  `consent_type` enum('data_processing','verification','accuracy_declaration','terms_privacy','marketing') NOT NULL,
  `granted` tinyint(1) NOT NULL,
  `notice_version` varchar(20) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ContactMessage`
--

CREATE TABLE `ContactMessage` (
  `id` int(11) NOT NULL,
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
  `updatedAt` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `coupons`
--

CREATE TABLE `coupons` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `code` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `discount_type` enum('PERCENTAGE','FIXED','FREE_SHIPPING') NOT NULL,
  `discount_value` decimal(12,2) NOT NULL,
  `max_discount` decimal(12,2) DEFAULT NULL,
  `min_order_value` decimal(12,2) DEFAULT NULL,
  `starts_at` datetime(3) DEFAULT NULL,
  `expires_at` datetime(3) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `is_visible` tinyint(1) NOT NULL DEFAULT 1,
  `total_usage_limit` int(11) DEFAULT NULL,
  `used_count` int(11) NOT NULL DEFAULT 0,
  `per_user_limit` int(11) DEFAULT NULL,
  `first_order_only` tinyint(1) NOT NULL DEFAULT 0,
  `applies_to` enum('ENTIRE_CART','PRODUCT','CATEGORY','BRAND') NOT NULL DEFAULT 'ENTIRE_CART',
  `product_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `category_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `brand_names` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `coupon_redemptions`
--

CREATE TABLE `coupon_redemptions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `coupon_id` bigint(20) UNSIGNED NOT NULL,
  `user_id` int(11) NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `discount_applied` decimal(12,2) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `inventory`
--

CREATE TABLE `inventory` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `store_location_id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED NOT NULL,
  `qty_on_hand` int(11) NOT NULL DEFAULT 0,
  `qty_reserved` int(11) NOT NULL DEFAULT 0,
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `inventory_movements`
--

CREATE TABLE `inventory_movements` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `inventory_id` bigint(20) UNSIGNED NOT NULL,
  `movement_type` enum('IN','OUT','ADJUSTMENT','RETURN') NOT NULL,
  `qty_delta` int(11) NOT NULL,
  `reference_id` varchar(255) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `kotak_payment_sessions`
--

CREATE TABLE `kotak_payment_sessions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `checkout_reference` varchar(80) NOT NULL,
  `cart_id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `checkout_payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `customer_payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` char(3) NOT NULL DEFAULT 'INR',
  `status` enum('INITIATED','PENDING','PAID','FAILED','ABORTED') NOT NULL DEFAULT 'INITIATED',
  `request_payload` text DEFAULT NULL,
  `response_payload` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `media_files`
--

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
  `deleted_at` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_attribute_rules`
--

CREATE TABLE `ondc_attribute_rules` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ondc_category_id` bigint(20) UNSIGNED NOT NULL,
  `attribute_code` varchar(80) NOT NULL,
  `is_mandatory` tinyint(1) NOT NULL DEFAULT 0,
  `data_type` enum('STRING','NUMBER','BOOLEAN','DATE','ENUM') NOT NULL DEFAULT 'STRING',
  `allowed_values` text DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_catalog_items`
--

CREATE TABLE `ondc_catalog_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `main_db_product_id` bigint(20) UNSIGNED NOT NULL,
  `provider_id` varchar(100) NOT NULL,
  `seller_id` bigint(20) UNSIGNED NOT NULL,
  `ondc_item_id` varchar(100) NOT NULL,
  `ondc_category_code` varchar(100) NOT NULL,
  `domain` varchar(50) NOT NULL DEFAULT 'ONDC:RET12',
  `item_json` longtext NOT NULL,
  `sync_status` enum('synced','pending','rejected','inactive') NOT NULL DEFAULT 'pending',
  `rejection_reason` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_catalog_rejections`
--

CREATE TABLE `ondc_catalog_rejections` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `transaction_id` varchar(128) NOT NULL DEFAULT '',
  `bap_id` varchar(255) NOT NULL DEFAULT '',
  `bap_uri` varchar(512) NOT NULL DEFAULT '',
  `domain` varchar(96) NOT NULL DEFAULT '',
  `message_id` varchar(128) NOT NULL DEFAULT '',
  `bpp_id` varchar(255) NOT NULL DEFAULT '',
  `rejection_notes` mediumtext DEFAULT NULL,
  `payload_json` mediumtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_categories`
--

CREATE TABLE `ondc_categories` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `ondc_category_code` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `parent_id` bigint(20) UNSIGNED DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_category_mappings`
--

CREATE TABLE `ondc_category_mappings` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `domain_name` varchar(100) DEFAULT NULL,
  `category` varchar(255) DEFAULT NULL,
  `ondc_category_id` bigint(20) UNSIGNED DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_customer_ticket`
--

CREATE TABLE `ondc_customer_ticket` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ticket_id` varchar(120) NOT NULL,
  `txn_id` varchar(120) NOT NULL,
  `order_id` varchar(120) DEFAULT NULL,
  `provider_id` varchar(100) DEFAULT NULL,
  `seller_id` bigint(20) UNSIGNED DEFAULT NULL,
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
  `db_updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_errors`
--

CREATE TABLE `ondc_errors` (
  `id` bigint(20) NOT NULL,
  `transaction_id` varchar(100) DEFAULT NULL,
  `message_id` varchar(100) DEFAULT NULL,
  `error_type` varchar(20) DEFAULT NULL,
  `error_code` varchar(10) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_fulfillments`
--

CREATE TABLE `ondc_fulfillments` (
  `id` bigint(20) UNSIGNED NOT NULL,
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
  `fulfillment_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_issues`
--

CREATE TABLE `ondc_issues` (
  `id` int(10) UNSIGNED NOT NULL,
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
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_orders`
--

CREATE TABLE `ondc_orders` (
  `id` bigint(20) UNSIGNED NOT NULL,
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
  `seller_id` bigint(20) UNSIGNED NOT NULL,
  `store_id` bigint(20) UNSIGNED DEFAULT NULL,
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
  `delhivery_upload_wbn` varchar(100) DEFAULT NULL,
  `delhivery_pickup_id` varchar(100) DEFAULT NULL,
  `delhivery_shipment_status` varchar(100) DEFAULT NULL,
  `delhivery_last_scan_at` datetime DEFAULT NULL,
  `delhivery_last_response` longtext DEFAULT NULL,
  `cancel_reason_id` varchar(8) DEFAULT NULL,
  `return_reason_id` varchar(8) DEFAULT NULL,
  `raw_confirm_payload` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_order_actions`
--

CREATE TABLE `ondc_order_actions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `transaction_id` varchar(128) NOT NULL,
  `ondc_order_id` varchar(128) NOT NULL,
  `action_type` enum('partial_cancel','return') NOT NULL,
  `action_id` varchar(64) NOT NULL,
  `flow_type` varchar(8) NOT NULL DEFAULT '3a',
  `item_id` varchar(191) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `quantity` int(10) UNSIGNED NOT NULL DEFAULT 1,
  `reason_id` varchar(8) NOT NULL DEFAULT '001',
  `rejection_reason_id` varchar(8) DEFAULT NULL,
  `refund_amount` decimal(12,2) DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'initiated',
  `last_phase_sent` varchar(32) DEFAULT NULL,
  `meta_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_order_items`
--

CREATE TABLE `ondc_order_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ondc_order_id` varchar(128) NOT NULL,
  `transaction_id` varchar(128) NOT NULL,
  `item_id` varchar(191) NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED DEFAULT NULL,
  `provider_id` varchar(100) NOT NULL,
  `seller_id` bigint(20) UNSIGNED NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL,
  `tax_percent` decimal(5,2) DEFAULT NULL,
  `line_amount` decimal(12,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `fulfillment_id` varchar(64) DEFAULT NULL,
  `raw_item_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_order_status_history`
--

CREATE TABLE `ondc_order_status_history` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ondc_order_id` varchar(128) NOT NULL,
  `from_status` varchar(50) DEFAULT NULL,
  `to_status` varchar(50) NOT NULL,
  `fulfillment_state` varchar(50) DEFAULT NULL,
  `triggered_by` varchar(50) NOT NULL DEFAULT 'system',
  `note` varchar(255) DEFAULT NULL,
  `payload_json` longtext DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_ppf_recon`
--

CREATE TABLE `ondc_ppf_recon` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ondc_order_id` varchar(128) NOT NULL,
  `order_status` varchar(50) DEFAULT NULL,
  `transaction_id` varchar(64) NOT NULL,
  `bap_id` varchar(191) NOT NULL DEFAULT '',
  `bap_uri` varchar(255) NOT NULL DEFAULT '',
  `message_id` varchar(191) NOT NULL DEFAULT '',
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `total_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `quote_json` longtext DEFAULT NULL,
  `settlements_json` longtext NOT NULL,
  `direction` varchar(20) NOT NULL DEFAULT 'OUTBOUND',
  `inbound_recon_payload` longtext DEFAULT NULL,
  `recon_accord` tinyint(1) DEFAULT NULL COMMENT 'NULL=pending, 1=accord, 0=dispute',
  `on_recon_payload` longtext DEFAULT NULL COMMENT 'Raw on_receiver_recon body from BAP',
  `outbound_on_recon_payload` longtext DEFAULT NULL,
  `http_status` smallint(6) DEFAULT NULL COMMENT 'HTTP code from BAP recon endpoint',
  `status` enum('INITIATED','ACKED','ACCORD','DISPUTE','FAILED') NOT NULL DEFAULT 'INITIATED',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_ratings`
--

CREATE TABLE `ondc_ratings` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `transaction_id` varchar(128) NOT NULL DEFAULT '',
  `order_id` varchar(128) NOT NULL DEFAULT '',
  `rating_category` varchar(50) NOT NULL DEFAULT 'Order',
  `rated_id` varchar(255) NOT NULL DEFAULT '',
  `rating_value` decimal(4,2) DEFAULT NULL,
  `bap_id` varchar(255) NOT NULL DEFAULT '',
  `domain` varchar(100) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_rsf`
--

CREATE TABLE `ondc_rsf` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `recon_transaction_id` varchar(64) NOT NULL,
  `recon_message_id` varchar(191) NOT NULL DEFAULT '',
  `order_id` varchar(128) NOT NULL DEFAULT '',
  `provider_id` varchar(100) DEFAULT NULL,
  `seller_id` bigint(20) UNSIGNED DEFAULT NULL,
  `recon_type` varchar(128) NOT NULL DEFAULT '',
  `buyer_bap_id` varchar(191) NOT NULL DEFAULT '',
  `buyer_bap_uri` varchar(255) NOT NULL DEFAULT '',
  `recon_status` varchar(32) NOT NULL DEFAULT '',
  `recon_accord` tinyint(1) DEFAULT NULL,
  `last_updated_at` datetime DEFAULT NULL,
  `settlement_row_ids` longtext DEFAULT NULL,
  `raw_json` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_settlements`
--

CREATE TABLE `ondc_settlements` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `txn_id` varchar(64) NOT NULL,
  `order_id` varchar(128) NOT NULL DEFAULT '',
  `provider_id` varchar(100) DEFAULT NULL,
  `seller_id` bigint(20) UNSIGNED DEFAULT NULL,
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
  `settlement_id` varchar(120) DEFAULT NULL,
  `ondc_order_id` varchar(120) DEFAULT NULL,
  `transaction_id` varchar(120) DEFAULT NULL,
  `total_amount` decimal(12,2) DEFAULT NULL,
  `settlement_amount` decimal(12,2) DEFAULT NULL,
  `buyer_finder_fee` decimal(12,2) DEFAULT NULL,
  `withholding_amount` decimal(12,2) DEFAULT NULL,
  `status` enum('PENDING','PROCESSING','SETTLED','FAILED') NOT NULL DEFAULT 'PENDING',
  `settlement_reference` varchar(255) DEFAULT NULL,
  `settlement_timestamp` datetime DEFAULT NULL,
  `counterparty` varchar(255) DEFAULT NULL,
  `utr` varchar(120) DEFAULT NULL,
  `raw_json` longtext DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_transactions`
--

CREATE TABLE `ondc_transactions` (
  `id` bigint(20) NOT NULL,
  `transaction_id` varchar(100) NOT NULL,
  `bap_id` varchar(255) DEFAULT NULL,
  `bpp_id` varchar(255) DEFAULT NULL,
  `domain` varchar(50) DEFAULT NULL,
  `city` varchar(20) DEFAULT NULL,
  `country` varchar(10) DEFAULT NULL,
  `core_version` varchar(10) DEFAULT NULL,
  `status` enum('SEARCH','SELECT','INIT','CONFIRM','COMPLETED','CANCELLED') DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ondc_txn_logs`
--

CREATE TABLE `ondc_txn_logs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `transaction_id` varchar(100) NOT NULL,
  `message_id` varchar(100) NOT NULL,
  `action` varchar(50) NOT NULL,
  `direction` enum('inbound','outbound') NOT NULL,
  `bap_id` varchar(255) DEFAULT NULL,
  `bpp_id` varchar(255) DEFAULT NULL,
  `domain` varchar(50) DEFAULT NULL,
  `http_status` smallint(5) UNSIGNED DEFAULT NULL,
  `ack_status` enum('ACK','NACK') DEFAULT NULL,
  `payload_json` longtext NOT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `order_no` varchar(50) NOT NULL,
  `user_id` int(11) NOT NULL,
  `cart_id` bigint(20) UNSIGNED NOT NULL,
  `order_status` enum('CREATED','PAYMENT_PENDING','PAID','CONFIRMED','SHIPPED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  `total_items` int(11) DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT NULL,
  `tax_total` decimal(12,2) DEFAULT NULL,
  `shipping_total` decimal(12,2) DEFAULT NULL,
  `discount_total` decimal(12,2) DEFAULT NULL,
  `grand_total` decimal(12,2) DEFAULT NULL,
  `payment_status` enum('PENDING','PAID','FAILED','REFUNDED') DEFAULT NULL,
  `payment_method` varchar(20) DEFAULT NULL,
  `currency` char(3) NOT NULL DEFAULT 'INR',
  `invoice_url` longtext DEFAULT NULL,
  `ondc_order_id` varchar(100) DEFAULT NULL,
  `ondc_transaction_id` varchar(100) DEFAULT NULL,
  `total_amount` decimal(12,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `coupon_id` bigint(20) UNSIGNED DEFAULT NULL,
  `coupon_code` varchar(50) DEFAULT NULL,
  `coupon_discount_type` varchar(20) DEFAULT NULL,
  `coupon_discount_value` decimal(12,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `order_addresses`
--

CREATE TABLE `order_addresses` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `type` enum('billing','shipping') NOT NULL,
  `address_type` enum('Home','Work','Other') DEFAULT 'Home',
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `address_line1` varchar(255) NOT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `city` varchar(120) NOT NULL,
  `state` varchar(120) NOT NULL,
  `country` varchar(120) NOT NULL,
  `pincode` varchar(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `order_items`
--

CREATE TABLE `order_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `order_seller_unit_id` bigint(20) UNSIGNED DEFAULT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED NOT NULL DEFAULT 0,
  `qty` int(11) NOT NULL,
  `price_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_percent_snapshot` decimal(5,2) DEFAULT NULL,
  `base_unit_price` decimal(12,2) DEFAULT NULL,
  `gst_amount` decimal(12,2) DEFAULT NULL,
  `inclusive_total` decimal(12,2) DEFAULT NULL,
  `price` decimal(12,2) NOT NULL,
  `grand_total` decimal(12,2) NOT NULL,
  `item_status` enum('pending','confirmed','processing','shipped','delivered','cancelled','returned') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Otp`
--

CREATE TABLE `Otp` (
  `id` int(11) NOT NULL,
  `phoneNumber` varchar(191) NOT NULL,
  `code` varchar(191) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `expiresAt` datetime(3) NOT NULL,
  `usedAt` datetime(3) DEFAULT NULL,
  `authToken` varchar(191) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `overall_txns`
--

CREATE TABLE `overall_txns` (
  `id` bigint(20) UNSIGNED NOT NULL,
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
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payment_transactions`
--

CREATE TABLE `payment_transactions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `provider` varchar(40) NOT NULL DEFAULT 'KOTAK',
  `provider_order_id` varchar(80) NOT NULL,
  `provider_payment_id` varchar(120) DEFAULT NULL,
  `bank_ref_no` varchar(120) DEFAULT NULL,
  `payment_mode` varchar(80) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` char(3) NOT NULL DEFAULT 'INR',
  `status` enum('INITIATED','PENDING','PAID','FAILED','ABORTED','REFUNDED') NOT NULL DEFAULT 'INITIATED',
  `request_payload` text DEFAULT NULL,
  `response_payload` text DEFAULT NULL,
  `failure_message` varchar(255) DEFAULT NULL,
  `paid_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pincodes`
--

CREATE TABLE `pincodes` (
  `id` bigint(20) NOT NULL,
  `state` varchar(100) NOT NULL,
  `district` varchar(100) NOT NULL,
  `tehsil` varchar(100) NOT NULL,
  `pincode` varchar(10) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `category_id` bigint(20) UNSIGNED NOT NULL,
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
  `additional_information` text DEFAULT NULL,
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
  `artisan_story` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_attributes`
--

CREATE TABLE `product_attributes` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `attribute_key` varchar(255) NOT NULL,
  `attribute_value` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_filters`
--

CREATE TABLE `product_filters` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `filter_id` bigint(20) UNSIGNED NOT NULL,
  `filter_value_id` bigint(20) UNSIGNED NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_images`
--

CREATE TABLE `product_images` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `image_url` varchar(500) NOT NULL,
  `alt_text` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_ondc_attributes`
--

CREATE TABLE `product_ondc_attributes` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED DEFAULT NULL,
  `attribute_key` varchar(255) NOT NULL,
  `attribute_value` text DEFAULT NULL,
  `color_name` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_reviews`
--

CREATE TABLE `product_reviews` (
  `id` int(11) NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `user_id` int(11) NOT NULL,
  `rating` tinyint(4) NOT NULL,
  `review_text` text DEFAULT NULL,
  `review_image` varchar(500) DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_serviceable_cities`
--

CREATE TABLE `product_serviceable_cities` (
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `city` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_serviceable_pincodes`
--

CREATE TABLE `product_serviceable_pincodes` (
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `pincode` varchar(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_variants`
--

CREATE TABLE `product_variants` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `parent_variant_id` bigint(20) UNSIGNED DEFAULT NULL,
  `level_index` tinyint(3) UNSIGNED DEFAULT NULL,
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
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_verification`
--

CREATE TABLE `product_verification` (
  `id` int(11) NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `approval_status` enum('approved','rejected','pending') DEFAULT 'pending',
  `reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Profile`
--

CREATE TABLE `Profile` (
  `id` int(11) NOT NULL,
  `userId` int(11) NOT NULL,
  `about` varchar(191) DEFAULT NULL,
  `region` varchar(191) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `returns`
--

CREATE TABLE `returns` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `order_item_id` bigint(20) UNSIGNED NOT NULL,
  `reason` text NOT NULL,
  `refund_amount` decimal(12,2) NOT NULL,
  `refund_mode` enum('original','bank_transfer','wallet','store_credit') NOT NULL,
  `status` enum('pending','approved','rejected','refunded') NOT NULL DEFAULT 'pending',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `seller_profiles`
--

CREATE TABLE `seller_profiles` (
  `user_id` int(11) NOT NULL,
  `business_type` enum('GST','GST_COMPOSITION','Non-GST') DEFAULT NULL,
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
  `approval_status` enum('PENDING','UNDER_REVIEW','APPROVED','REJECTED','RESUBMITTED') NOT NULL DEFAULT 'PENDING',
  `reject_note` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  `seller_id` varchar(32) DEFAULT NULL,
  `seller_type` enum('Weaver','Artisan','Corporation','Corporative','Apex Corporative','Producing Company') DEFAULT NULL,
  `hsvn_card_number` varchar(100) DEFAULT NULL,
  `hsvn_card_image` varchar(500) DEFAULT NULL,
  `dch_card_number` varchar(100) DEFAULT NULL,
  `dch_card_image` varchar(500) DEFAULT NULL,
  `registration_certificate_id` varchar(150) DEFAULT NULL,
  `registration_certificate_image` varchar(500) DEFAULT NULL,
  `samagra_id` varchar(100) DEFAULT NULL,
  `samagra_image` varchar(500) DEFAULT NULL,
  `social_media_link` varchar(500) DEFAULT NULL,
  `category` enum('SC','ST','OBC','General') DEFAULT NULL,
  `gender` enum('Male','Female','Other') DEFAULT NULL,
  `artisan_photo` varchar(500) DEFAULT NULL,
  `store_photo` varchar(500) DEFAULT NULL,
  `craft` varchar(255) DEFAULT NULL,
  `bank_name` varchar(255) DEFAULT 'Kotak Mahindra Bank',
  `branch_name` varchar(255) DEFAULT 'Bhopal'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `seller_settlements`
--

CREATE TABLE `seller_settlements` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `seller_unit_id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `seller_id` int(11) NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `gross_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `commission_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `net_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` char(3) NOT NULL DEFAULT 'INR',
  `status` enum('PENDING','PROCESSING','SETTLED','FAILED','ON_HOLD') NOT NULL DEFAULT 'PENDING',
  `settlement_reference` varchar(120) DEFAULT NULL,
  `settled_at` datetime(3) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `seller_units`
--

CREATE TABLE `seller_units` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `seller_id` int(11) NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `status` enum('pending','confirmed','processing','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  `tracking_no` varchar(100) DEFAULT NULL,
  `logistics_provider` varchar(100) DEFAULT NULL,
  `delhivery_upload_wbn` varchar(100) DEFAULT NULL,
  `delhivery_pickup_id` varchar(100) DEFAULT NULL,
  `delhivery_shipment_status` varchar(100) DEFAULT NULL,
  `delhivery_last_scan_at` datetime DEFAULT NULL,
  `delhivery_last_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `settlement_items`
--

CREATE TABLE `settlement_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `settlement_id` bigint(20) UNSIGNED DEFAULT NULL,
  `order_item_id` bigint(20) UNSIGNED NOT NULL,
  `seller_id` int(11) NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `order_date` datetime DEFAULT NULL,
  `delivered_date` datetime DEFAULT NULL,
  `order_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `commission_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `shipping_charge` decimal(12,2) NOT NULL DEFAULT 0.00,
  `refund_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `adjustment_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `net_payable` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING',
  `utr_number` varchar(100) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `stores`
--

CREATE TABLE `stores` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `seller_user_id` int(11) NOT NULL,
  `store_name` varchar(255) NOT NULL,
  `store_slug` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `short_description` varchar(500) DEFAULT NULL,
  `support_email` varchar(255) DEFAULT NULL,
  `support_phone` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `deleted_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  `store_photo` varchar(500) DEFAULT NULL,
  `ondc_domain` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `ttl_timing` varchar(20) NOT NULL DEFAULT '1 day',
  `shop_opening_days` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `store_locations`
--

CREATE TABLE `store_locations` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `store_id` bigint(20) UNSIGNED NOT NULL,
  `location_type` enum('DELIVERY','SELF_PICKUP','RETURN','COMPANY_ADDRESS') NOT NULL,
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
  `radius` bigint(20) UNSIGNED DEFAULT NULL,
  `opening_time` int(11) DEFAULT NULL,
  `closing_time` int(11) DEFAULT NULL,
  `serviceability` int(11) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL,
  `tahsil` varchar(120) DEFAULT NULL,
  `delhivery_warehouse_name` varchar(80) DEFAULT NULL,
  `delhivery_warehouse_created_at` datetime(3) DEFAULT NULL,
  `delhivery_warehouse_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_tickets`
--

CREATE TABLE `support_tickets` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ticket_no` varchar(32) NOT NULL,
  `user_id` int(11) NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `order_item_id` bigint(20) UNSIGNED DEFAULT NULL,
  `order_seller_unit_id` bigint(20) DEFAULT NULL,
  `seller_user_id` bigint(20) UNSIGNED DEFAULT NULL,
  `store_id` bigint(20) UNSIGNED DEFAULT NULL,
  `reason_code` varchar(40) NOT NULL,
  `reason_text` varchar(200) DEFAULT NULL,
  `comment` varchar(1000) NOT NULL,
  `status` enum('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED','HARD_CLOSED','REJECTED') NOT NULL DEFAULT 'OPEN',
  `priority` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
  `assigned_to_user_id` bigint(20) UNSIGNED DEFAULT NULL,
  `resolution_note` varchar(1000) DEFAULT NULL,
  `last_message_at` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_ticket_attachments`
--

CREATE TABLE `support_ticket_attachments` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ticket_id` bigint(20) UNSIGNED NOT NULL,
  `file_url` varchar(1000) NOT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `file_size` bigint(20) UNSIGNED DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_ticket_messages`
--

CREATE TABLE `support_ticket_messages` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ticket_id` bigint(20) UNSIGNED NOT NULL,
  `sender_user_id` bigint(20) UNSIGNED NOT NULL,
  `sender_role` enum('USER','SELLER','ADMIN','SUPER_ADMIN') NOT NULL,
  `message` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_ticket_reasons`
--

CREATE TABLE `support_ticket_reasons` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `code` varchar(100) NOT NULL,
  `label` varchar(255) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `support_ticket_status_history`
--

CREATE TABLE `support_ticket_status_history` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `ticket_id` bigint(20) UNSIGNED NOT NULL,
  `old_status` enum('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED','HARD_CLOSED','REJECTED') DEFAULT NULL,
  `new_status` enum('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED','HARD_CLOSED','REJECTED') NOT NULL,
  `changed_by_user_id` bigint(20) UNSIGNED DEFAULT NULL,
  `note` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Testimonial`
--

CREATE TABLE `Testimonial` (
  `id` int(11) NOT NULL,
  `customerName` varchar(100) NOT NULL,
  `location` varchar(100) DEFAULT NULL,
  `testimonialText` text NOT NULL,
  `rating` int(11) NOT NULL DEFAULT 5,
  `customerPhoto` varchar(255) DEFAULT NULL,
  `productOrService` varchar(100) DEFAULT NULL,
  `isPublished` tinyint(1) NOT NULL DEFAULT 0,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `deletedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `User`
--

CREATE TABLE `User` (
  `id` int(11) NOT NULL,
  `username` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `email` varchar(191) DEFAULT NULL,
  `phoneNumber` varchar(191) NOT NULL,
  `password` varchar(191) DEFAULT NULL,
  `avatar` varchar(191) DEFAULT NULL,
  `role` enum('SUPER_ADMIN','ADMIN','COMMISSIONER','USER','SELLER') NOT NULL DEFAULT 'USER',
  `isTwoFactorEnabled` tinyint(1) NOT NULL DEFAULT 0,
  `createdAt` datetime(3) DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_addresses`
--

CREATE TABLE `user_addresses` (
  `id` int(11) NOT NULL,
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
  `updated_at` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `variant_images`
--

CREATE TABLE `variant_images` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `variant_id` bigint(20) UNSIGNED NOT NULL,
  `image_url` varchar(500) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `wishlist`
--

CREATE TABLE `wishlist` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `created_at` datetime(3) DEFAULT current_timestamp(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `Account`
--
ALTER TABLE `Account`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `Account_provider_providerAccountId_key` (`provider`,`providerAccountId`),
  ADD KEY `Account_userId_fkey` (`userId`);

--
-- Indexes for table `admin_district_assignments`
--
ALTER TABLE `admin_district_assignments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `admin_district_assignments_admin_id_key` (`admin_id`),
  ADD KEY `admin_district_assignments_district_name_idx` (`district_name`),
  ADD KEY `admin_district_assignments_assigned_by_idx` (`assigned_by`);

--
-- Indexes for table `Announcement`
--
ALTER TABLE `Announcement`
  ADD PRIMARY KEY (`id`),
  ADD KEY `Announcement_isPublished_idx` (`isPublished`),
  ADD KEY `Announcement_startAt_endAt_idx` (`startAt`,`endAt`);

--
-- Indexes for table `artisan_stories`
--
ALTER TABLE `artisan_stories`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `artisan_story_slider`
--
ALTER TABLE `artisan_story_slider`
  ADD PRIMARY KEY (`id`),
  ADD KEY `artisan_story_id` (`artisan_story_id`);

--
-- Indexes for table `AuthToken`
--
ALTER TABLE `AuthToken`
  ADD PRIMARY KEY (`token`),
  ADD UNIQUE KEY `AuthToken_phoneNumber_token_key` (`phoneNumber`,`token`);

--
-- Indexes for table `bap_terms`
--
ALTER TABLE `bap_terms`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_bap_id` (`bap_id`);

--
-- Indexes for table `blogs`
--
ALTER TABLE `blogs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `blogs_slug_key` (`slug`),
  ADD KEY `blogs_isPublished_idx` (`isPublished`),
  ADD KEY `blogs_status_idx` (`status`),
  ADD KEY `blogs_is_featured_idx` (`is_featured`),
  ADD KEY `blogs_deleted_at_idx` (`deleted_at`);

--
-- Indexes for table `bulk_order_enquiries`
--
ALTER TABLE `bulk_order_enquiries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_bulk_email` (`email`),
  ADD KEY `idx_bulk_status` (`status`),
  ADD KEY `idx_bulk_created` (`created_at`);

--
-- Indexes for table `carts`
--
ALTER TABLE `carts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `carts_user_id_key` (`user_id`),
  ADD UNIQUE KEY `carts_session_id_key` (`session_id`),
  ADD KEY `carts_user_id_idx` (`user_id`),
  ADD KEY `carts_session_id_idx` (`session_id`);

--
-- Indexes for table `cart_items`
--
ALTER TABLE `cart_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `cart_items_cart_id_idx` (`cart_id`),
  ADD KEY `cart_items_store_id_idx` (`store_id`),
  ADD KEY `cart_items_product_id_idx` (`product_id`),
  ADD KEY `cart_items_variant_id_idx` (`variant_id`);

--
-- Indexes for table `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `categories_slug_key` (`slug`),
  ADD KEY `categories_parent_id_idx` (`parent_id`);

--
-- Indexes for table `category_filters`
--
ALTER TABLE `category_filters`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `category_filters_category_id_filter_id_key` (`category_id`,`filter_id`),
  ADD KEY `category_filters_category_id_idx` (`category_id`),
  ADD KEY `category_filters_filter_id_idx` (`filter_id`);

--
-- Indexes for table `category_mappings`
--
ALTER TABLE `category_mappings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `category_mappings_category_id_idx` (`category_id`),
  ADD KEY `category_mappings_ondc_category_id_idx` (`ondc_category_id`);

--
-- Indexes for table `cmsSlider`
--
ALTER TABLE `cmsSlider`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `cms_filters`
--
ALTER TABLE `cms_filters`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `cms_filters_slug_key` (`slug`);

--
-- Indexes for table `cms_filter_values`
--
ALTER TABLE `cms_filter_values`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `cms_filter_values_filter_id_value_key` (`filter_id`,`value`),
  ADD KEY `cms_filter_values_filter_id_idx` (`filter_id`);

--
-- Indexes for table `consent_notices`
--
ALTER TABLE `consent_notices`
  ADD PRIMARY KEY (`version`,`consent_type`);

--
-- Indexes for table `consent_records`
--
ALTER TABLE `consent_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_seller` (`seller_id`),
  ADD KEY `idx_seller_type` (`seller_id`,`consent_type`);

--
-- Indexes for table `ContactMessage`
--
ALTER TABLE `ContactMessage`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `coupons`
--
ALTER TABLE `coupons`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `coupons_code_key` (`code`),
  ADD KEY `coupons_is_active_idx` (`is_active`),
  ADD KEY `coupons_expires_at_idx` (`expires_at`);

--
-- Indexes for table `coupon_redemptions`
--
ALTER TABLE `coupon_redemptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `coupon_redemptions_coupon_id_idx` (`coupon_id`),
  ADD KEY `coupon_redemptions_user_id_idx` (`user_id`),
  ADD KEY `coupon_redemptions_order_id_idx` (`order_id`);

--
-- Indexes for table `inventory`
--
ALTER TABLE `inventory`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `inventory_store_location_id_variant_id_key` (`store_location_id`,`variant_id`),
  ADD KEY `inventory_variant_id_idx` (`variant_id`);

--
-- Indexes for table `inventory_movements`
--
ALTER TABLE `inventory_movements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inventory_movements_inventory_id_idx` (`inventory_id`);

--
-- Indexes for table `kotak_payment_sessions`
--
ALTER TABLE `kotak_payment_sessions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `kotak_payment_sessions_checkout_reference_key` (`checkout_reference`),
  ADD KEY `kotak_payment_sessions_cart_id_idx` (`cart_id`),
  ADD KEY `kotak_payment_sessions_order_id_idx` (`order_id`),
  ADD KEY `kotak_payment_sessions_status_idx` (`status`);

--
-- Indexes for table `media_files`
--
ALTER TABLE `media_files`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `ondc_attribute_rules`
--
ALTER TABLE `ondc_attribute_rules`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_cat_attr` (`ondc_category_id`,`attribute_code`),
  ADD KEY `idx_cat` (`ondc_category_id`);

--
-- Indexes for table `ondc_catalog_items`
--
ALTER TABLE `ondc_catalog_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_item_provider` (`ondc_item_id`,`provider_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_seller` (`seller_id`),
  ADD KEY `idx_main_product` (`main_db_product_id`),
  ADD KEY `idx_sync_status` (`sync_status`);

--
-- Indexes for table `ondc_catalog_rejections`
--
ALTER TABLE `ondc_catalog_rejections`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_created` (`created_at`),
  ADD KEY `idx_txn` (`transaction_id`(64)),
  ADD KEY `idx_bap` (`bap_id`(128));

--
-- Indexes for table `ondc_categories`
--
ALTER TABLE `ondc_categories`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ondc_categories_parent_id_idx` (`parent_id`);

--
-- Indexes for table `ondc_category_mappings`
--
ALTER TABLE `ondc_category_mappings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ondc_category_mappings_product_id_idx` (`product_id`),
  ADD KEY `ondc_category_mappings_ondc_category_id_fkey` (`ondc_category_id`);

--
-- Indexes for table `ondc_customer_ticket`
--
ALTER TABLE `ondc_customer_ticket`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_ticket_id` (`ticket_id`),
  ADD KEY `idx_txn` (`txn_id`),
  ADD KEY `idx_order` (`order_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_seller` (`seller_id`),
  ADD KEY `idx_display_status` (`display_status`),
  ADD KEY `idx_customer_phone` (`customer_phone`),
  ADD KEY `idx_updated_at` (`updated_at`),
  ADD KEY `idx_category_code` (`issue_category_code`);

--
-- Indexes for table `ondc_errors`
--
ALTER TABLE `ondc_errors`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_txn` (`transaction_id`);

--
-- Indexes for table `ondc_fulfillments`
--
ALTER TABLE `ondc_fulfillments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_order_fulfillment_role` (`ondc_order_id`,`fulfillment_role`),
  ADD KEY `idx_order` (`ondc_order_id`),
  ADD KEY `idx_txn` (`transaction_id`),
  ADD KEY `idx_state` (`state`);

--
-- Indexes for table `ondc_issues`
--
ALTER TABLE `ondc_issues`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_issue_id` (`issue_id`),
  ADD KEY `idx_order_id` (`order_id`),
  ADD KEY `idx_txn_id` (`transaction_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `ondc_orders`
--
ALTER TABLE `ondc_orders`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_ondc_order_id` (`ondc_order_id`),
  ADD KEY `idx_txn` (`transaction_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_seller` (`seller_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_bap` (`bap_id`),
  ADD KEY `idx_customer_phone` (`customer_phone`),
  ADD KEY `idx_updated` (`updated_at`);

--
-- Indexes for table `ondc_order_actions`
--
ALTER TABLE `ondc_order_actions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_txn` (`transaction_id`),
  ADD KEY `idx_order` (`ondc_order_id`),
  ADD KEY `idx_action` (`action_id`),
  ADD KEY `idx_type` (`action_type`);

--
-- Indexes for table `ondc_order_items`
--
ALTER TABLE `ondc_order_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_order_item` (`ondc_order_id`,`item_id`),
  ADD KEY `idx_txn` (`transaction_id`),
  ADD KEY `idx_product` (`product_id`),
  ADD KEY `idx_variant` (`variant_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_seller` (`seller_id`);

--
-- Indexes for table `ondc_order_status_history`
--
ALTER TABLE `ondc_order_status_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_order` (`ondc_order_id`),
  ADD KEY `idx_created` (`created_at`);

--
-- Indexes for table `ondc_ppf_recon`
--
ALTER TABLE `ondc_ppf_recon`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_order` (`ondc_order_id`),
  ADD KEY `idx_txn` (`transaction_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_created` (`created_at`);

--
-- Indexes for table `ondc_ratings`
--
ALTER TABLE `ondc_ratings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_txn_cat_rated` (`transaction_id`,`rating_category`,`rated_id`),
  ADD KEY `idx_rated_id` (`rated_id`),
  ADD KEY `idx_rating_category` (`rating_category`),
  ADD KEY `idx_order_id` (`order_id`);

--
-- Indexes for table `ondc_rsf`
--
ALTER TABLE `ondc_rsf`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_recon_txn` (`recon_transaction_id`),
  ADD KEY `idx_order` (`order_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_seller` (`seller_id`),
  ADD KEY `idx_recon_status` (`recon_status`),
  ADD KEY `idx_last_updated` (`last_updated_at`);

--
-- Indexes for table `ondc_settlements`
--
ALTER TABLE `ondc_settlements`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_txn_id` (`txn_id`),
  ADD KEY `idx_order` (`order_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_seller` (`seller_id`),
  ADD KEY `idx_recon_status` (`recon_status`),
  ADD KEY `idx_last_updated` (`last_updated_at`),
  ADD KEY `idx_settlement_id` (`settlement_id`),
  ADD KEY `idx_ondc_order_id` (`ondc_order_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `ondc_transactions`
--
ALTER TABLE `ondc_transactions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_txn_id` (`transaction_id`);

--
-- Indexes for table `ondc_txn_logs`
--
ALTER TABLE `ondc_txn_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_txn` (`transaction_id`),
  ADD KEY `idx_msg` (`message_id`),
  ADD KEY `idx_action` (`action`),
  ADD KEY `idx_created` (`created_at`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `orders_order_no_key` (`order_no`),
  ADD KEY `orders_user_id_fkey` (`user_id`);

--
-- Indexes for table `order_addresses`
--
ALTER TABLE `order_addresses`
  ADD PRIMARY KEY (`id`),
  ADD KEY `order_addresses_order_id_fkey` (`order_id`);

--
-- Indexes for table `order_items`
--
ALTER TABLE `order_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `order_items_order_id_fkey` (`order_id`);

--
-- Indexes for table `Otp`
--
ALTER TABLE `Otp`
  ADD PRIMARY KEY (`id`),
  ADD KEY `Otp_authToken_fkey` (`authToken`);

--
-- Indexes for table `overall_txns`
--
ALTER TABLE `overall_txns`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_txn_id` (`txn_id`),
  ADD KEY `idx_provider` (`provider_id`),
  ADD KEY `idx_updated_at` (`updated_at`),
  ADD KEY `idx_archived` (`is_archived`);

--
-- Indexes for table `payment_transactions`
--
ALTER TABLE `payment_transactions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `payment_transactions_provider_order_key` (`provider`,`provider_order_id`),
  ADD KEY `payment_transactions_order_id_idx` (`order_id`),
  ADD KEY `payment_transactions_status_idx` (`status`);

--
-- Indexes for table `pincodes`
--
ALTER TABLE `pincodes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `pincode` (`pincode`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `products_alias_slug_key` (`alias_slug`),
  ADD KEY `products_store_id_idx` (`store_id`),
  ADD KEY `products_category_id_idx` (`category_id`),
  ADD KEY `products_publish_status_idx` (`publish_status`);

--
-- Indexes for table `product_attributes`
--
ALTER TABLE `product_attributes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_attributes_product_id_idx` (`product_id`);

--
-- Indexes for table `product_filters`
--
ALTER TABLE `product_filters`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `product_filters_product_filter_value_key` (`product_id`,`filter_id`,`filter_value_id`),
  ADD KEY `product_filters_product_id_idx` (`product_id`),
  ADD KEY `product_filters_filter_id_idx` (`filter_id`),
  ADD KEY `product_filters_filter_value_id_idx` (`filter_value_id`);

--
-- Indexes for table `product_images`
--
ALTER TABLE `product_images`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_images_product_id_idx` (`product_id`);

--
-- Indexes for table `product_ondc_attributes`
--
ALTER TABLE `product_ondc_attributes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_ondc_attributes_product_id_idx` (`product_id`),
  ADD KEY `product_ondc_attributes_variant_id_idx` (`variant_id`);

--
-- Indexes for table `product_reviews`
--
ALTER TABLE `product_reviews`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_product_id` (`product_id`),
  ADD KEY `idx_user_id` (`user_id`);

--
-- Indexes for table `product_serviceable_cities`
--
ALTER TABLE `product_serviceable_cities`
  ADD PRIMARY KEY (`product_id`,`city`);

--
-- Indexes for table `product_serviceable_pincodes`
--
ALTER TABLE `product_serviceable_pincodes`
  ADD PRIMARY KEY (`product_id`,`pincode`);

--
-- Indexes for table `product_variants`
--
ALTER TABLE `product_variants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `product_variants_sku_key` (`sku`),
  ADD UNIQUE KEY `product_variants_product_id_sku_key` (`product_id`,`sku`),
  ADD KEY `product_variants_product_id_idx` (`product_id`),
  ADD KEY `product_variants_parent_variant_id_fkey` (`parent_variant_id`);

--
-- Indexes for table `product_verification`
--
ALTER TABLE `product_verification`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_id` (`product_id`),
  ADD KEY `store_id` (`store_id`);

--
-- Indexes for table `Profile`
--
ALTER TABLE `Profile`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `Profile_userId_key` (`userId`);

--
-- Indexes for table `returns`
--
ALTER TABLE `returns`
  ADD PRIMARY KEY (`id`),
  ADD KEY `returns_order_id_fkey` (`order_id`),
  ADD KEY `returns_order_item_id_fkey` (`order_item_id`);

--
-- Indexes for table `seller_profiles`
--
ALTER TABLE `seller_profiles`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `seller_profiles_seller_id_key` (`seller_id`);

--
-- Indexes for table `seller_settlements`
--
ALTER TABLE `seller_settlements`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `seller_settlements_seller_unit_key` (`seller_unit_id`),
  ADD KEY `seller_settlements_order_id_idx` (`order_id`),
  ADD KEY `seller_settlements_seller_id_idx` (`seller_id`),
  ADD KEY `seller_settlements_status_idx` (`status`),
  ADD KEY `seller_settlements_store_id_fkey` (`store_id`);

--
-- Indexes for table `seller_units`
--
ALTER TABLE `seller_units`
  ADD PRIMARY KEY (`id`),
  ADD KEY `seller_units_order_id_fkey` (`order_id`);

--
-- Indexes for table `settlement_items`
--
ALTER TABLE `settlement_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `settlement_items_order_item_id_key` (`order_item_id`),
  ADD KEY `settlement_items_seller_store_idx` (`seller_id`,`store_id`),
  ADD KEY `settlement_items_order_idx` (`order_id`),
  ADD KEY `settlement_items_status_idx` (`status`),
  ADD KEY `settlement_items_settlement_id_idx` (`settlement_id`);

--
-- Indexes for table `stores`
--
ALTER TABLE `stores`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `stores_store_slug_key` (`store_slug`),
  ADD KEY `stores_seller_user_id_idx` (`seller_user_id`),
  ADD KEY `stores_seller_user_id_deleted_at_idx` (`seller_user_id`,`deleted_at`);

--
-- Indexes for table `store_locations`
--
ALTER TABLE `store_locations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `store_locations_delhivery_warehouse_name_key` (`delhivery_warehouse_name`),
  ADD KEY `store_locations_store_id_idx` (`store_id`),
  ADD KEY `store_locations_store_id_location_type_idx` (`store_id`,`location_type`);

--
-- Indexes for table `support_tickets`
--
ALTER TABLE `support_tickets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_support_tickets_ticket_no` (`ticket_no`),
  ADD KEY `idx_support_tickets_user_id` (`user_id`),
  ADD KEY `idx_support_tickets_order_id` (`order_id`),
  ADD KEY `idx_support_tickets_order_item_id` (`order_item_id`),
  ADD KEY `idx_support_tickets_order_seller_unit_id` (`order_seller_unit_id`),
  ADD KEY `idx_support_tickets_seller_user_id` (`seller_user_id`),
  ADD KEY `idx_support_tickets_store_id` (`store_id`),
  ADD KEY `idx_support_tickets_status` (`status`);

--
-- Indexes for table `support_ticket_attachments`
--
ALTER TABLE `support_ticket_attachments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_support_ticket_attachments_ticket_id` (`ticket_id`);

--
-- Indexes for table `support_ticket_messages`
--
ALTER TABLE `support_ticket_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_ticket_messages_ticket_id` (`ticket_id`),
  ADD KEY `idx_ticket_messages_sender_user_id` (`sender_user_id`);

--
-- Indexes for table `support_ticket_reasons`
--
ALTER TABLE `support_ticket_reasons`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_support_ticket_reasons_code` (`code`);

--
-- Indexes for table `support_ticket_status_history`
--
ALTER TABLE `support_ticket_status_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_ticket_history_ticket_id` (`ticket_id`);

--
-- Indexes for table `Testimonial`
--
ALTER TABLE `Testimonial`
  ADD PRIMARY KEY (`id`),
  ADD KEY `Testimonial_isPublished_idx` (`isPublished`);

--
-- Indexes for table `User`
--
ALTER TABLE `User`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `User_username_key` (`username`),
  ADD UNIQUE KEY `User_phoneNumber_key` (`phoneNumber`);

--
-- Indexes for table `user_addresses`
--
ALTER TABLE `user_addresses`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_addresses_user_id_idx` (`user_id`);

--
-- Indexes for table `variant_images`
--
ALTER TABLE `variant_images`
  ADD PRIMARY KEY (`id`),
  ADD KEY `variant_images_variant_id_idx` (`variant_id`);

--
-- Indexes for table `wishlist`
--
ALTER TABLE `wishlist`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `wishlist_user_id_product_id_key` (`user_id`,`product_id`),
  ADD KEY `wishlist_product_id_idx` (`product_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admin_district_assignments`
--
ALTER TABLE `admin_district_assignments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `Announcement`
--
ALTER TABLE `Announcement`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `artisan_stories`
--
ALTER TABLE `artisan_stories`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `artisan_story_slider`
--
ALTER TABLE `artisan_story_slider`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bap_terms`
--
ALTER TABLE `bap_terms`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `blogs`
--
ALTER TABLE `blogs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bulk_order_enquiries`
--
ALTER TABLE `bulk_order_enquiries`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `carts`
--
ALTER TABLE `carts`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `cart_items`
--
ALTER TABLE `cart_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `categories`
--
ALTER TABLE `categories`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `category_filters`
--
ALTER TABLE `category_filters`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `category_mappings`
--
ALTER TABLE `category_mappings`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `cmsSlider`
--
ALTER TABLE `cmsSlider`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `cms_filters`
--
ALTER TABLE `cms_filters`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `cms_filter_values`
--
ALTER TABLE `cms_filter_values`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `consent_records`
--
ALTER TABLE `consent_records`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ContactMessage`
--
ALTER TABLE `ContactMessage`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `coupons`
--
ALTER TABLE `coupons`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `coupon_redemptions`
--
ALTER TABLE `coupon_redemptions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `inventory`
--
ALTER TABLE `inventory`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `inventory_movements`
--
ALTER TABLE `inventory_movements`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `kotak_payment_sessions`
--
ALTER TABLE `kotak_payment_sessions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_attribute_rules`
--
ALTER TABLE `ondc_attribute_rules`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_catalog_items`
--
ALTER TABLE `ondc_catalog_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_catalog_rejections`
--
ALTER TABLE `ondc_catalog_rejections`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_categories`
--
ALTER TABLE `ondc_categories`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_category_mappings`
--
ALTER TABLE `ondc_category_mappings`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_customer_ticket`
--
ALTER TABLE `ondc_customer_ticket`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_errors`
--
ALTER TABLE `ondc_errors`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_fulfillments`
--
ALTER TABLE `ondc_fulfillments`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_issues`
--
ALTER TABLE `ondc_issues`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_orders`
--
ALTER TABLE `ondc_orders`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_order_actions`
--
ALTER TABLE `ondc_order_actions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_order_items`
--
ALTER TABLE `ondc_order_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_order_status_history`
--
ALTER TABLE `ondc_order_status_history`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_ppf_recon`
--
ALTER TABLE `ondc_ppf_recon`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_ratings`
--
ALTER TABLE `ondc_ratings`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_rsf`
--
ALTER TABLE `ondc_rsf`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_settlements`
--
ALTER TABLE `ondc_settlements`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_transactions`
--
ALTER TABLE `ondc_transactions`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ondc_txn_logs`
--
ALTER TABLE `ondc_txn_logs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `order_addresses`
--
ALTER TABLE `order_addresses`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `order_items`
--
ALTER TABLE `order_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `Otp`
--
ALTER TABLE `Otp`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `overall_txns`
--
ALTER TABLE `overall_txns`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payment_transactions`
--
ALTER TABLE `payment_transactions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pincodes`
--
ALTER TABLE `pincodes`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_attributes`
--
ALTER TABLE `product_attributes`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_filters`
--
ALTER TABLE `product_filters`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_images`
--
ALTER TABLE `product_images`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_ondc_attributes`
--
ALTER TABLE `product_ondc_attributes`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_reviews`
--
ALTER TABLE `product_reviews`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_variants`
--
ALTER TABLE `product_variants`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_verification`
--
ALTER TABLE `product_verification`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `Profile`
--
ALTER TABLE `Profile`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `returns`
--
ALTER TABLE `returns`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `seller_settlements`
--
ALTER TABLE `seller_settlements`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `seller_units`
--
ALTER TABLE `seller_units`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `settlement_items`
--
ALTER TABLE `settlement_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `stores`
--
ALTER TABLE `stores`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `store_locations`
--
ALTER TABLE `store_locations`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_tickets`
--
ALTER TABLE `support_tickets`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_ticket_attachments`
--
ALTER TABLE `support_ticket_attachments`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_ticket_messages`
--
ALTER TABLE `support_ticket_messages`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_ticket_reasons`
--
ALTER TABLE `support_ticket_reasons`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `support_ticket_status_history`
--
ALTER TABLE `support_ticket_status_history`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `Testimonial`
--
ALTER TABLE `Testimonial`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `User`
--
ALTER TABLE `User`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_addresses`
--
ALTER TABLE `user_addresses`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `variant_images`
--
ALTER TABLE `variant_images`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `wishlist`
--
ALTER TABLE `wishlist`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `Account`
--
ALTER TABLE `Account`
  ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `admin_district_assignments`
--
ALTER TABLE `admin_district_assignments`
  ADD CONSTRAINT `admin_district_assignments_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `admin_district_assignments_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `artisan_story_slider`
--
ALTER TABLE `artisan_story_slider`
  ADD CONSTRAINT `artisan_story_slider_ibfk_1` FOREIGN KEY (`artisan_story_id`) REFERENCES `artisan_stories` (`id`);

--
-- Constraints for table `cart_items`
--
ALTER TABLE `cart_items`
  ADD CONSTRAINT `cart_items_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `cart_items_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `categories`
--
ALTER TABLE `categories`
  ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `category_filters`
--
ALTER TABLE `category_filters`
  ADD CONSTRAINT `category_filters_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `category_filters_filter_id_fkey` FOREIGN KEY (`filter_id`) REFERENCES `cms_filters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `category_mappings`
--
ALTER TABLE `category_mappings`
  ADD CONSTRAINT `category_mappings_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `category_mappings_ondc_category_id_fkey` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `cms_filter_values`
--
ALTER TABLE `cms_filter_values`
  ADD CONSTRAINT `cms_filter_values_filter_id_fkey` FOREIGN KEY (`filter_id`) REFERENCES `cms_filters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `coupon_redemptions`
--
ALTER TABLE `coupon_redemptions`
  ADD CONSTRAINT `coupon_redemptions_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `inventory`
--
ALTER TABLE `inventory`
  ADD CONSTRAINT `inventory_store_location_id_fkey` FOREIGN KEY (`store_location_id`) REFERENCES `store_locations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `inventory_movements`
--
ALTER TABLE `inventory_movements`
  ADD CONSTRAINT `inventory_movements_inventory_id_fkey` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `kotak_payment_sessions`
--
ALTER TABLE `kotak_payment_sessions`
  ADD CONSTRAINT `kotak_payment_sessions_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `kotak_payment_sessions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `ondc_attribute_rules`
--
ALTER TABLE `ondc_attribute_rules`
  ADD CONSTRAINT `fk_ondc_attr_cat` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `ondc_categories`
--
ALTER TABLE `ondc_categories`
  ADD CONSTRAINT `ondc_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `ondc_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `ondc_category_mappings`
--
ALTER TABLE `ondc_category_mappings`
  ADD CONSTRAINT `ondc_category_mappings_ondc_category_id_fkey` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ondc_category_mappings_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `order_addresses`
--
ALTER TABLE `order_addresses`
  ADD CONSTRAINT `order_addresses_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `order_items`
--
ALTER TABLE `order_items`
  ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `Otp`
--
ALTER TABLE `Otp`
  ADD CONSTRAINT `Otp_authToken_fkey` FOREIGN KEY (`authToken`) REFERENCES `AuthToken` (`token`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `payment_transactions`
--
ALTER TABLE `payment_transactions`
  ADD CONSTRAINT `payment_transactions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `products_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_attributes`
--
ALTER TABLE `product_attributes`
  ADD CONSTRAINT `product_attributes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_images`
--
ALTER TABLE `product_images`
  ADD CONSTRAINT `product_images_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_ondc_attributes`
--
ALTER TABLE `product_ondc_attributes`
  ADD CONSTRAINT `product_ondc_attributes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `product_ondc_attributes_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_reviews`
--
ALTER TABLE `product_reviews`
  ADD CONSTRAINT `fk_product_reviews_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_product_reviews_user` FOREIGN KEY (`user_id`) REFERENCES `User` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `product_serviceable_cities`
--
ALTER TABLE `product_serviceable_cities`
  ADD CONSTRAINT `product_serviceable_cities_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_serviceable_pincodes`
--
ALTER TABLE `product_serviceable_pincodes`
  ADD CONSTRAINT `product_serviceable_pincodes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_variants`
--
ALTER TABLE `product_variants`
  ADD CONSTRAINT `product_variants_parent_variant_id_fkey` FOREIGN KEY (`parent_variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `product_variants_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `product_verification`
--
ALTER TABLE `product_verification`
  ADD CONSTRAINT `product_verification_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  ADD CONSTRAINT `product_verification_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`);

--
-- Constraints for table `Profile`
--
ALTER TABLE `Profile`
  ADD CONSTRAINT `Profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `returns`
--
ALTER TABLE `returns`
  ADD CONSTRAINT `returns_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `returns_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `seller_profiles`
--
ALTER TABLE `seller_profiles`
  ADD CONSTRAINT `seller_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `seller_settlements`
--
ALTER TABLE `seller_settlements`
  ADD CONSTRAINT `seller_settlements_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `seller_settlements_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `User` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `seller_settlements_seller_unit_id_fkey` FOREIGN KEY (`seller_unit_id`) REFERENCES `seller_units` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `seller_settlements_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `seller_units`
--
ALTER TABLE `seller_units`
  ADD CONSTRAINT `seller_units_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `stores`
--
ALTER TABLE `stores`
  ADD CONSTRAINT `stores_seller_user_id_fkey` FOREIGN KEY (`seller_user_id`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `store_locations`
--
ALTER TABLE `store_locations`
  ADD CONSTRAINT `store_locations_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `support_tickets`
--
ALTER TABLE `support_tickets`
  ADD CONSTRAINT `fk_support_tickets_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_support_tickets_order_item` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `support_ticket_attachments`
--
ALTER TABLE `support_ticket_attachments`
  ADD CONSTRAINT `fk_support_ticket_attachments_ticket_id` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `support_ticket_messages`
--
ALTER TABLE `support_ticket_messages`
  ADD CONSTRAINT `fk_ticket_messages_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `support_ticket_status_history`
--
ALTER TABLE `support_ticket_status_history`
  ADD CONSTRAINT `fk_ticket_history_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `user_addresses`
--
ALTER TABLE `user_addresses`
  ADD CONSTRAINT `user_addresses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `variant_images`
--
ALTER TABLE `variant_images`
  ADD CONSTRAINT `variant_images_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `wishlist`
--
ALTER TABLE `wishlist`
  ADD CONSTRAINT `wishlist_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `wishlist_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
