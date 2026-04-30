-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL,
    `avatar` VARCHAR(191) NULL,
    `role` ENUM('ADMIN', 'USER', 'SELLER') NOT NULL DEFAULT 'USER',
    `isTwoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_phoneNumber_key`(`phoneNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `type` ENUM('CREDENTIALS', 'GOOGLE', 'GITHUB') NOT NULL,
    `provider` ENUM('CREDENTIALS', 'GOOGLE', 'GITHUB') NOT NULL,
    `providerAccountId` VARCHAR(191) NOT NULL,
    `refreshToken` TEXT NULL,
    `accessToken` TEXT NULL,
    `expiresAt` INTEGER NULL,
    `tokenType` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NULL,
    `idToken` TEXT NULL,
    `sessionState` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'PENDING', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
    `phoneNumberVerifiedAt` DATETIME(3) NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Account_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Otp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `authToken` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthToken` (
    `token` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `type` ENUM('RESET_PASSWORD', 'VERIFICATION', 'FORGOT_PASSWORD') NOT NULL,
    `usedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AuthToken_phoneNumber_token_key`(`phoneNumber`, `token`),
    PRIMARY KEY (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Profile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `about` VARCHAR(191) NULL,
    `region` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Profile_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cmsSlider` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pageId` BIGINT UNSIGNED NULL,
    `imageUploadId` BIGINT UNSIGNED NULL,
    `imageUrl` VARCHAR(800) NULL,
    `image` VARCHAR(191) NULL,
    `imageMobile` VARCHAR(191) NULL,
    `heading` VARCHAR(200) NOT NULL,
    `subheading` VARCHAR(240) NULL,
    `buttonText` VARCHAR(60) NULL,
    `button_redirect` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` BIGINT UNSIGNED NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_files` (
    `id` VARCHAR(191) NOT NULL,
    `file_type` ENUM('IMAGE', 'PDF', 'DOC', 'OTHER') NOT NULL,
    `original_name` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `file_size_bytes` INTEGER NOT NULL,
    `storage_provider` ENUM('LOCAL', 'S3', 'CDN') NOT NULL DEFAULT 'LOCAL',
    `storage_path` VARCHAR(191) NOT NULL,
    `public_url` VARCHAR(191) NOT NULL,
    `checksum_sha256` VARCHAR(191) NOT NULL,
    `uploaded_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Announcement_isPublished_idx`(`isPublished`),
    INDEX `Announcement_startAt_endAt_idx`(`startAt`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Testimonial` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerName` VARCHAR(100) NOT NULL,
    `location` VARCHAR(100) NULL,
    `testimonialText` TEXT NOT NULL,
    `rating` INTEGER NOT NULL DEFAULT 5,
    `customerPhoto` VARCHAR(255) NULL,
    `productOrService` VARCHAR(100) NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Testimonial_isPublished_idx`(`isPublished`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NULL,
    `topic` ENUM('GENERAL_INQUIRY', 'ORDER_STATUS', 'RETURNS') NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `status` ENUM('RESOLVED', 'UNRESOLVED') NOT NULL DEFAULT 'UNRESOLVED',
    `adminNotes` VARCHAR(191) NULL,
    `resolvedBy` INTEGER NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_profiles` (
    `user_id` INTEGER NOT NULL,
    `gstin` VARCHAR(15) NULL,
    `pan` VARCHAR(10) NULL,
    `bank_account_no` VARCHAR(34) NULL,
    `bank_ifsc` VARCHAR(11) NULL,
    `upi_id` VARCHAR(256) NULL,
    `kyc_status` ENUM('PENDING', 'SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stores` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `seller_user_id` INTEGER NOT NULL,
    `store_name` VARCHAR(255) NOT NULL,
    `store_slug` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `support_email` VARCHAR(255) NULL,
    `support_phone` VARCHAR(20) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stores_store_slug_key`(`store_slug`),
    INDEX `stores_seller_user_id_idx`(`seller_user_id`),
    INDEX `stores_seller_user_id_deleted_at_idx`(`seller_user_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_locations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `location_type` ENUM('DELIVERY', 'SELF_PICKUP', 'RETURN') NOT NULL,
    `address_line1` VARCHAR(255) NOT NULL,
    `address_line2` VARCHAR(255) NULL,
    `city` VARCHAR(120) NOT NULL,
    `state` VARCHAR(120) NOT NULL,
    `country` VARCHAR(120) NOT NULL,
    `pincode` VARCHAR(20) NOT NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `radius` BIGINT UNSIGNED NULL,
    `opening_time` INTEGER NULL,
    `closing_time` INTEGER NULL,
    `serviceability` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `store_locations_store_id_idx`(`store_id`),
    INDEX `store_locations_store_id_location_type_idx`(`store_id`, `location_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `session_id` VARCHAR(100) NULL,
    `status` ENUM('active', 'abandoned', 'converted') NOT NULL DEFAULT 'active',
    `currency` CHAR(3) NULL DEFAULT 'INR',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carts_user_id_key`(`user_id`),
    UNIQUE INDEX `carts_session_id_key`(`session_id`),
    INDEX `carts_user_id_idx`(`user_id`),
    INDEX `carts_session_id_idx`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `cart_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `variant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `qty` INTEGER NOT NULL,
    `price_snapshot` DECIMAL(12, 2) NOT NULL,
    `mrp_snapshot` DECIMAL(12, 2) NULL,
    `tax_snapshot` DECIMAL(12, 2) NULL,
    `discount_snapshot` DECIMAL(12, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `cart_items_cart_id_idx`(`cart_id`),
    INDEX `cart_items_store_id_idx`(`store_id`),
    INDEX `cart_items_product_id_idx`(`product_id`),
    INDEX `cart_items_variant_id_idx`(`variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blogs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `subheading` VARCHAR(255) NULL,
    `content` LONGTEXT NOT NULL,
    `featuredImage` VARCHAR(500) NULL,
    `slug` VARCHAR(255) NOT NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `blogs_slug_key`(`slug`),
    INDEX `blogs_isPublished_idx`(`isPublished`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT UNSIGNED NULL,
    `domain` VARCHAR(100) NULL,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(255) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `categories_slug_key`(`slug`),
    INDEX `categories_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `product_name` VARCHAR(255) NOT NULL,
    `district` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `hsn_sac_code` VARCHAR(255) NULL,
    `gst_percent` INTEGER NOT NULL DEFAULT 0,
    `gtin_ean` VARCHAR(255) NULL,
    `stock` BIGINT NOT NULL DEFAULT 0,
    `force_out_of_stock` BOOLEAN NOT NULL DEFAULT false,
    `unit_count` DECIMAL(10, 2) NULL,
    `unit_type` ENUM('unit', 'gram', 'kilogram', 'tonne', 'millilitre', 'litre', 'dozen') NULL,
    `brand` VARCHAR(255) NULL,
    `manufacturing_month` VARCHAR(50) NULL,
    `expiry_date` DATE NULL,
    `country_of_origin` VARCHAR(100) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `return_days_window` INTEGER NULL,
    `seller_pickup_return` BOOLEAN NOT NULL DEFAULT false,
    `is_cod_available` BOOLEAN NOT NULL DEFAULT true,
    `publish_status` ENUM('draft', 'publish', 'unpublish') NOT NULL DEFAULT 'draft',
    `is_manufacturer` BOOLEAN NOT NULL DEFAULT false,
    `manufacturer_name` VARCHAR(255) NULL,
    `manufacturer_address` TEXT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `default_price` DECIMAL(12, 2) NOT NULL,
    `mrp` DECIMAL(12, 2) NOT NULL,
    `avg_rating` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `review_count` INTEGER NOT NULL DEFAULT 0,
    `min_purchase_limit` INTEGER NULL DEFAULT 1,
    `max_purchase_limit` INTEGER NULL,
    `standard_package_qty` INTEGER NULL,
    `low_stock_qty` INTEGER NULL,
    `order_mode` ENUM('ONLINE', 'BUYQ', 'BOTH') NOT NULL DEFAULT 'ONLINE',
    `visibility` ENUM('PUBLIC', 'BUSINESS') NOT NULL DEFAULT 'PUBLIC',
    `alias_slug` VARCHAR(255) NULL,
    `seo_title` VARCHAR(255) NULL,
    `seo_description` VARCHAR(500) NULL,
    `seo_keywords` VARCHAR(500) NULL,
    `disable_for_bots` BOOLEAN NOT NULL DEFAULT false,
    `availability_mode` ENUM('SELLER_DEFAULT', 'ALL_INDIA', 'CITIES', 'PINCODES') NOT NULL DEFAULT 'SELLER_DEFAULT',
    `cancellable` ENUM('DEFAULT', 'YES', 'NO') NOT NULL DEFAULT 'DEFAULT',
    `returnable` ENUM('DEFAULT', 'YES', 'NO') NOT NULL DEFAULT 'DEFAULT',
    `time_to_ship_value` INTEGER NULL,
    `time_to_ship_unit` ENUM('MINUTES', 'HOURS', 'DAYS') NULL,
    `instructions` TEXT NULL,
    `storage_conditions` TEXT NULL,
    `included_items` TEXT NULL,
    `size_chart_url` VARCHAR(500) NULL,
    `gi_tag` BOOLEAN NOT NULL DEFAULT false,
    `silk_mark` BOOLEAN NOT NULL DEFAULT false,
    `no_of_variants` INTEGER NOT NULL DEFAULT 0,
    `have_ondc_attributes` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_alias_slug_key`(`alias_slug`),
    INDEX `products_store_id_idx`(`store_id`),
    INDEX `products_category_id_idx`(`category_id`),
    INDEX `products_publish_status_idx`(`publish_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_variants` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `parent_variant_id` BIGINT UNSIGNED NULL,
    `level_index` TINYINT UNSIGNED NULL,
    `level_name` VARCHAR(255) NULL,
    `attribute_value` VARCHAR(255) NULL,
    `color_code` VARCHAR(255) NULL,
    `variant_name` VARCHAR(255) NOT NULL,
    `sku` VARCHAR(255) NULL,
    `gtin_ean` VARCHAR(255) NULL,
    `price` DECIMAL(12, 2) NULL,
    `mrp` DECIMAL(12, 2) NULL,
    `unit_count` DECIMAL(10, 2) NULL,
    `unit_type` ENUM('unit', 'gram', 'kilogram', 'tonne', 'millilitre', 'litre', 'dozen') NULL,
    `product_weight_gm` INTEGER NULL,
    `product_length_cm` DECIMAL(8, 2) NULL,
    `product_width_cm` DECIMAL(8, 2) NULL,
    `product_height_cm` DECIMAL(8, 2) NULL,
    `shipping_pkg_weight_gm` INTEGER NULL,
    `shipping_pkg_length_cm` DECIMAL(8, 2) NULL,
    `shipping_pkg_width_cm` DECIMAL(8, 2) NULL,
    `shipping_pkg_height_cm` DECIMAL(8, 2) NULL,
    `min_purchase_limit` INTEGER NULL,
    `max_purchase_limit` INTEGER NULL,
    `standard_package_qty` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_variants_sku_key`(`sku`),
    INDEX `product_variants_product_id_idx`(`product_id`),
    UNIQUE INDEX `product_variants_product_id_sku_key`(`product_id`, `sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_images` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(500) NOT NULL,
    `alt_text` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_images_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_location_id` BIGINT UNSIGNED NOT NULL,
    `variant_id` BIGINT UNSIGNED NOT NULL,
    `qty_on_hand` INTEGER NOT NULL DEFAULT 0,
    `qty_reserved` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_variant_id_idx`(`variant_id`),
    UNIQUE INDEX `inventory_store_location_id_variant_id_key`(`store_location_id`, `variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_movements` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `inventory_id` BIGINT UNSIGNED NOT NULL,
    `movement_type` ENUM('IN', 'OUT', 'ADJUSTMENT', 'RETURN') NOT NULL,
    `qty_delta` INTEGER NOT NULL,
    `reference_id` VARCHAR(255) NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_movements_inventory_id_idx`(`inventory_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `user_id` INTEGER NULL,
    `rating` INTEGER NOT NULL DEFAULT 5,
    `review_text` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `product_reviews_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_serviceable_cities` (
    `product_id` BIGINT UNSIGNED NOT NULL,
    `city` VARCHAR(255) NOT NULL,

    PRIMARY KEY (`product_id`, `city`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_serviceable_pincodes` (
    `product_id` BIGINT UNSIGNED NOT NULL,
    `pincode` VARCHAR(20) NOT NULL,

    PRIMARY KEY (`product_id`, `pincode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ondc_categories` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(100) NULL,
    `ondc_category_code` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `parent_id` BIGINT UNSIGNED NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `ondc_categories_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `category_mappings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `ondc_category_id` BIGINT UNSIGNED NOT NULL,
    `domain` VARCHAR(100) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `confidence` VARCHAR(50) NULL,
    `notes` VARCHAR(255) NULL,

    INDEX `category_mappings_category_id_idx`(`category_id`),
    INDEX `category_mappings_ondc_category_id_idx`(`ondc_category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ondc_category_mappings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `domain` VARCHAR(100) NULL,
    `domain_name` VARCHAR(100) NULL,
    `category` VARCHAR(255) NULL,
    `ondc_category_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ondc_category_mappings_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_attributes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `attribute_key` VARCHAR(255) NOT NULL,
    `attribute_value` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_attributes_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_ondc_attributes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `variant_id` BIGINT UNSIGNED NULL,
    `attribute_key` VARCHAR(255) NOT NULL,
    `attribute_value` TEXT NULL,
    `color_name` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `product_ondc_attributes_product_id_idx`(`product_id`),
    INDEX `product_ondc_attributes_variant_id_idx`(`variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `variant_images` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `variant_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(500) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `variant_images_variant_id_idx`(`variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(50) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `cart_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    `payment_status` ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_order_no_key`(`order_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `variant_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `item_status` ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned') NOT NULL DEFAULT 'pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_addresses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('billing', 'shipping') NOT NULL,
    `full_name` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `address_line1` VARCHAR(255) NOT NULL,
    `address_line2` VARCHAR(255) NULL,
    `city` VARCHAR(120) NOT NULL,
    `state` VARCHAR(120) NOT NULL,
    `country` VARCHAR(120) NOT NULL,
    `pincode` VARCHAR(20) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `returns` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `reason` TEXT NOT NULL,
    `refund_amount` DECIMAL(12, 2) NOT NULL,
    `refund_mode` ENUM('original', 'bank_transfer', 'wallet', 'store_credit') NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'refunded') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_units` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `seller_id` INTEGER NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    `tracking_no` VARCHAR(100) NULL,
    `logistics_provider` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Otp` ADD CONSTRAINT `Otp_authToken_fkey` FOREIGN KEY (`authToken`) REFERENCES `AuthToken`(`token`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Profile` ADD CONSTRAINT `Profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_profiles` ADD CONSTRAINT `seller_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stores` ADD CONSTRAINT `stores_seller_user_id_fkey` FOREIGN KEY (`seller_user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_locations` ADD CONSTRAINT `store_locations_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_parent_variant_id_fkey` FOREIGN KEY (`parent_variant_id`) REFERENCES `product_variants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory` ADD CONSTRAINT `inventory_store_location_id_fkey` FOREIGN KEY (`store_location_id`) REFERENCES `store_locations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory` ADD CONSTRAINT `inventory_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_inventory_id_fkey` FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_reviews` ADD CONSTRAINT `product_reviews_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serviceable_cities` ADD CONSTRAINT `product_serviceable_cities_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serviceable_pincodes` ADD CONSTRAINT `product_serviceable_pincodes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ondc_categories` ADD CONSTRAINT `ondc_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `ondc_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `category_mappings` ADD CONSTRAINT `category_mappings_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `category_mappings` ADD CONSTRAINT `category_mappings_ondc_category_id_fkey` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ondc_category_mappings` ADD CONSTRAINT `ondc_category_mappings_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ondc_category_mappings` ADD CONSTRAINT `ondc_category_mappings_ondc_category_id_fkey` FOREIGN KEY (`ondc_category_id`) REFERENCES `ondc_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_attributes` ADD CONSTRAINT `product_attributes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_ondc_attributes` ADD CONSTRAINT `product_ondc_attributes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_ondc_attributes` ADD CONSTRAINT `product_ondc_attributes_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `variant_images` ADD CONSTRAINT `variant_images_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_addresses` ADD CONSTRAINT `order_addresses_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `returns` ADD CONSTRAINT `returns_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `returns` ADD CONSTRAINT `returns_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_units` ADD CONSTRAINT `seller_units_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
