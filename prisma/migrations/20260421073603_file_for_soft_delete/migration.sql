-- AlterTable
ALTER TABLE `stores` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `stores_seller_user_id_deleted_at_idx` ON `stores`(`seller_user_id`, `deleted_at`);
