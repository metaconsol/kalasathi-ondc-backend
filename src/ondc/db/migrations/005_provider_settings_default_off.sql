-- =============================================================================
-- 005 — ondc_provider_settings.is_active: DEFAULT 1 -> DEFAULT 0.
-- Idempotent (re-running an ALTER to the same default is a no-op). Run against
-- the database ONDC_DB_URL points to, after 004.
--
-- WHY
-- 004 created the column as `NOT NULL DEFAULT 1` back when an absent row meant
-- "active", so a defaulted insert matched that rule. The rule has since been
-- inverted: ondc_provider_settings is now the ONLY source of ONDC availability
-- and no row means OFF, because Super Admin approval must not publish a seller
-- to the network on its own — going live is a deliberate act in the ONDC
-- Providers tab.
--
-- Both writers (providerModel.setActive / setActiveBulk) pass is_active
-- explicitly, so the stale default is harmless today. It is a trap for later:
-- any future INSERT that omits the column — a settings screen, a backfill, a
-- hand-run SQL fix — would silently publish that store on ONDC. Flipping the
-- default makes "off unless someone says otherwise" structural instead of a
-- convention every future author has to know about.
--
-- SAFETY
-- ALTER ... SET DEFAULT changes only the default for FUTURE inserts. It does
-- not rewrite the table and does not touch a single existing row, so no
-- currently-live provider is affected. Verified on prod_ondc_db: 326 rows, all
-- with an explicit is_active (5 on / 321 off).
-- =============================================================================

ALTER TABLE `ondc_provider_settings`
  ALTER COLUMN `is_active` SET DEFAULT 0;
