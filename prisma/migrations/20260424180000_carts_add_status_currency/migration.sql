-- Shadow DB replays all migrations from scratch; `carts` / `cart_items` were never created
-- in earlier migrations, so we create them here. On existing DBs, `CREATE TABLE IF NOT EXISTS` is a no-op.

CREATE TABLE IF NOT EXISTS `carts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `session_id` VARCHAR(100) NULL,
    `status` ENUM('active', 'abandoned', 'converted') NOT NULL DEFAULT 'active',
    `currency` CHAR(3) NULL DEFAULT 'INR',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `carts_user_id_key`(`user_id`),
    UNIQUE INDEX `carts_session_id_key`(`session_id`),
    INDEX `carts_user_id_idx`(`user_id`),
    INDEX `carts_session_id_idx`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cart_items` (
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
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `cart_items_cart_id_idx`(`cart_id`),
    INDEX `cart_items_store_id_idx`(`store_id`),
    INDEX `cart_items_product_id_idx`(`product_id`),
    INDEX `cart_items_variant_id_idx`(`variant_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `cart_items_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `cart_items_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Legacy DBs that already had `carts` without `status` / `currency` (MySQL 8.0.29+ / MariaDB 10.11+)
ALTER TABLE `carts` ADD COLUMN IF NOT EXISTS `status` ENUM('active', 'abandoned', 'converted') NOT NULL DEFAULT 'active';
ALTER TABLE `carts` ADD COLUMN IF NOT EXISTS `currency` CHAR(3) NULL DEFAULT 'INR';
