-- =============================================================================
-- 002 — Fix gaps between final_ondc_odop_db.sql (dump) and what the code needs.
-- Idempotent (MariaDB-native IF NOT EXISTS, no stored procedures — see 001).
-- Run against the database imported from final_ondc_odop_db.sql.
--
-- Found by cross-checking all 80 dump tables against every table/column the
-- ONDC code queries (models/adapters/controllers/services).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FIX 1 — ondc_fulfillments.fulfillment_json (MISSING in dump)
-- fulfillment.model.ts INSERTs/UPSERTs this column on every fulfillment write
-- (order confirm flow via order.service.ts). Dump only has meta_json.
-- Without this, every order-confirm fulfillment upsert throws
-- "Unknown column 'fulfillment_json'".
-- -----------------------------------------------------------------------------
ALTER TABLE `ondc_fulfillments`
  ADD COLUMN IF NOT EXISTS `fulfillment_json` LONGTEXT NULL AFTER `meta_json`;

-- -----------------------------------------------------------------------------
-- FIX 2 — ondc_settlements: dump has the RSF/recon-style shape (txn_id,
-- recon_status, settlement_amount_total, msg_*, payload_* ...), but
-- settlement.model.ts reads/writes a settlement-ledger shape. Reachable via the
-- RSF flow (recon.controller / webhook.service). Additive columns below let
-- both shapes coexist; existing recon columns are untouched.
-- -----------------------------------------------------------------------------
ALTER TABLE `ondc_settlements`
  ADD COLUMN IF NOT EXISTS `settlement_id`        VARCHAR(120)  NULL,
  ADD COLUMN IF NOT EXISTS `ondc_order_id`        VARCHAR(120)  NULL,
  ADD COLUMN IF NOT EXISTS `transaction_id`       VARCHAR(120)  NULL,
  ADD COLUMN IF NOT EXISTS `total_amount`         DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS `settlement_amount`    DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS `buyer_finder_fee`     DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS `withholding_amount`   DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS `status`               ENUM('PENDING','PROCESSING','SETTLED','FAILED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS `settlement_reference` VARCHAR(255)  NULL,
  ADD COLUMN IF NOT EXISTS `settlement_timestamp` DATETIME      NULL,
  ADD COLUMN IF NOT EXISTS `counterparty`         VARCHAR(255)  NULL,
  ADD COLUMN IF NOT EXISTS `utr`                  VARCHAR(120)  NULL,
  ADD COLUMN IF NOT EXISTS `raw_json`             LONGTEXT      NULL;

-- Lookups used by the code: UPDATE ... WHERE settlement_id / SELECT ... WHERE ondc_order_id / WHERE status
ALTER TABLE `ondc_settlements`
  ADD INDEX IF NOT EXISTS `idx_settlement_id` (`settlement_id`),
  ADD INDEX IF NOT EXISTS `idx_ondc_order_id` (`ondc_order_id`),
  ADD INDEX IF NOT EXISTS `idx_status` (`status`);

-- -----------------------------------------------------------------------------
-- FIX 3 — `User` vs `user` table-name case (MANUAL — read before running).
-- The dump defines `User` (capital U); Prisma maps to `user` (@@map) and
-- user.adapter queries `user`. On macOS/Windows MySQL (case-insensitive) this
-- is invisible; on a LINUX server (lower_case_table_names=0) `User` ≠ `user`
-- and queries fail with "table doesn't exist".
--
-- Run ONLY if `SHOW TABLES LIKE 'User';` returns a row AND
-- `SHOW TABLES LIKE 'user';` does not:
--
--   RENAME TABLE `User` TO `user`;
--
-- (Alternative: set lower_case_table_names=1 on the server before import.)
-- -----------------------------------------------------------------------------
