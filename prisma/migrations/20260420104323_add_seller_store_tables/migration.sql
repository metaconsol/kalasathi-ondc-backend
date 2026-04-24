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
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stores_store_slug_key`(`store_slug`),
    INDEX `stores_seller_user_id_idx`(`seller_user_id`),
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

-- AddForeignKey
ALTER TABLE `seller_profiles` ADD CONSTRAINT `seller_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stores` ADD CONSTRAINT `stores_seller_user_id_fkey` FOREIGN KEY (`seller_user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_locations` ADD CONSTRAINT `store_locations_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
