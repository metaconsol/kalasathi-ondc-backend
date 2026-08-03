-- =============================================================================
-- 006 — persist the buyer app finder fee so every callback can echo the value
-- the BAP actually sent on /search. Idempotent. Run after 005.
--
-- The fee was never stored per transaction or per order, so callbacks fell back
-- to ONDC_BUYER_FINDER_FEE_DEFAULT ('3'). Live bap_terms shows 16 of 21 buyer
-- apps send something else (DigiHaat 4.23, most 5, lekhha 2, gcr.ondc.org 0),
-- so that default was wrong for nearly every BAP and fed the /recon commission.
--
-- Three stores, in the order the resolver reads them:
--   ondc_orders.buyer_finder_fee_*  frozen at /confirm — authoritative for the
--                                   life of the order, immune to later searches
--   ondc_transactions.bff_*         captured at /search, per transaction_id
--   bap_terms.bff_type              per BAP; bff_percent already existed but had
--                                   no type beside it, so 'amount' was unechoable
-- =============================================================================

-- Frozen per order. VARCHAR, not DECIMAL: the echo must be byte-identical to
-- what the BAP sent ('5.0' must not become '5').
ALTER TABLE `ondc_orders`
  ADD COLUMN IF NOT EXISTS `buyer_finder_fee_amount` VARCHAR(16) NULL AFTER `order_total`,
  ADD COLUMN IF NOT EXISTS `buyer_finder_fee_type` VARCHAR(16) NULL AFTER `buyer_finder_fee_amount`;

-- Captured per transaction at /search. Reuses the existing per-transaction row
-- rather than adding a table — it is already upserted by every Beckn handler.
ALTER TABLE `ondc_transactions`
  ADD COLUMN IF NOT EXISTS `bff_amount` VARCHAR(16) NULL AFTER `core_version`,
  ADD COLUMN IF NOT EXISTS `bff_type` VARCHAR(16) NULL AFTER `bff_amount`;

-- Per-BAP fallback for transactions whose /search we never saw.
ALTER TABLE `bap_terms`
  ADD COLUMN IF NOT EXISTS `bff_type` VARCHAR(16) NULL AFTER `bff_percent`;

-- Backfill the frozen columns from what each order already carries. Only from
-- the order's own payloads — never from bap_terms, whose single row per BAP is
-- last-search-wins and cannot be attributed to a particular order.
UPDATE `ondc_orders`
   SET `buyer_finder_fee_amount` = JSON_UNQUOTE(
         JSON_EXTRACT(`payment_json`, '$."@ondc/org/buyer_app_finder_fee_amount"')),
       `buyer_finder_fee_type` = JSON_UNQUOTE(
         JSON_EXTRACT(`payment_json`, '$."@ondc/org/buyer_app_finder_fee_type"'))
 WHERE `buyer_finder_fee_amount` IS NULL
   AND `payment_json` IS NOT NULL
   AND JSON_VALID(`payment_json`)
   AND JSON_EXTRACT(`payment_json`, '$."@ondc/org/buyer_app_finder_fee_amount"') IS NOT NULL;
