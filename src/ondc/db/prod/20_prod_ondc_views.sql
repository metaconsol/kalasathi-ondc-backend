-- 20_prod_ondc_views.sql — run against the NEW prod ONDC database, AFTER 10_prod_ondc_tables.sql.
-- One view per catalog table the ONDC code reads; data stays in odopmartmp_new (single source of truth, always fresh).
-- The ecom DB (odopmartmp_new) is owned by another team and is NEVER altered by this setup — every column the
-- ONDC code expects but odopmartmp_new doesn't have (store_locations.radius_km, seller_profiles.bank_name/
-- branch_name) is synthesized inside the view definition instead.
-- stores + store_locations stay updatable for their real (non-computed) columns: the provider is_active toggle
-- and the Delhivery warehouse registration write THROUGH them into odopmartmp_new.
-- The DB user running the app needs: SELECT + UPDATE on its own DB (where these views live, e.g. prod_ondc_db)
-- PLUS cross-database SELECT on odopmartmp_new.* and UPDATE on odopmartmp_new.stores / store_locations
-- (SQL SECURITY INVOKER — the view runs with the connecting app user's own grants, not the view definer's).

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `products` AS SELECT * FROM `odopmartmp_new`.`products`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `product_variants` AS SELECT * FROM `odopmartmp_new`.`product_variants`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `product_images` AS SELECT * FROM `odopmartmp_new`.`product_images`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `variant_images` AS SELECT * FROM `odopmartmp_new`.`variant_images`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `categories` AS SELECT * FROM `odopmartmp_new`.`categories`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `product_ondc_attributes` AS SELECT * FROM `odopmartmp_new`.`product_ondc_attributes`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `product_serviceable_pincodes` AS SELECT * FROM `odopmartmp_new`.`product_serviceable_pincodes`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `product_serviceable_cities` AS SELECT * FROM `odopmartmp_new`.`product_serviceable_cities`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `product_verification` AS SELECT * FROM `odopmartmp_new`.`product_verification`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `stores` AS SELECT * FROM `odopmartmp_new`.`stores`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `ondc_categories` AS SELECT * FROM `odopmartmp_new`.`ondc_categories`;
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `ondc_category_mappings` AS SELECT * FROM `odopmartmp_new`.`ondc_category_mappings`;

-- user.adapter.ts queries `user` (lowercase); the live table is `User` — this view bridges the case difference.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `user` AS SELECT * FROM `odopmartmp_new`.`User`;

-- -----------------------------------------------------------------------------
-- seller_profiles — odopmartmp_new has no bank_name/branch_name columns.
-- Every consumer in src/ondc already falls back to these exact same literals
-- when the value is NULL/empty (init.controller.ts, cancel.controller.ts,
-- order.adapter.ts), so synthesizing them here just moves that same default
-- from scattered `?? 'Kotak Mahindra Bank'` call sites into one place.
-- Read-only from the ONDC side (no INSERT/UPDATE anywhere in src/ondc), so a
-- computed column here is safe.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `seller_profiles` AS
SELECT
  sp.user_id, sp.business_type, sp.gstin, sp.gst_image, sp.business_name, sp.enrollment_number,
  sp.aadhar_number, sp.aadhar_image, sp.pan, sp.pan_image, sp.bank_account_no, sp.bank_image,
  sp.bank_ifsc, sp.upi_id, sp.district, sp.kyc_status, sp.approval_status, sp.reject_note,
  sp.created_at, sp.updated_at, sp.seller_id, sp.seller_type, sp.hsvn_card_number, sp.hsvn_card_image,
  sp.dch_card_number, sp.dch_card_image, sp.registration_certificate_id, sp.registration_certificate_image,
  sp.samagra_id, sp.samagra_image, sp.social_media_link, sp.category, sp.gender, sp.artisan_photo,
  sp.store_photo, sp.craft,
  'Kotak Mahindra Bank' AS bank_name,
  'Bhopal' AS branch_name
FROM `odopmartmp_new`.`seller_profiles` sp;

-- -----------------------------------------------------------------------------
-- store_locations — odopmartmp_new has no radius_km column. Operating-hours
-- (time_from/time_to/day_from/day_to) and fulfillment_type are NOT selected by
-- seller.adapter.ts at all — those are now one org-wide setting read from env
-- (PROVIDER_TIMING in src/ondc/config/constants.ts) applied uniformly to every
-- provider, not a per-row DB value, so this view doesn't need to fake them.
--
-- radius_km DOES feed the provider location's serviceability radius (used by
-- mapStoreLocationToOndcLocation), so it's computed per-row instead of a flat
-- guess: great-circle distance from this location's own GPS to each of
-- mainland India's four extreme points (Kashmir/Kanyakumari/Arunachal/Gujarat),
-- take the farthest of the four (that's the point the seller would need to
-- reach for true pan-India coverage from where they actually are), add a 150km
-- buffer for hub/last-mile slack, and floor at 1500km as a safety net. A seller
-- in Gujarat (near the west edge) gets a larger radius than one in Bhopal
-- (central), because they're farther from India's east edge — exactly mirrors
-- how far a real pan-India shipment from that city would need to travel.
-- Missing GPS (NULL, or literal 0/0 "Null Island" data-entry bug) falls back to
-- Bhopal's coordinates, matching the same fallback mapStoreLocationToOndcLocation
-- already applies on the JS side.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE SQL SECURITY INVOKER VIEW `store_locations` AS
SELECT
  sl.id, sl.store_id, sl.location_type, sl.address_line1, sl.address_line2, sl.city, sl.state,
  sl.country, sl.pincode, sl.latitude, sl.longitude,
  GREATEST(
    1500,
    ROUND(
      150 + 6371 * GREATEST(
        ACOS(LEAST(1, GREATEST(-1,
          SIN(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * SIN(RADIANS(35.5))
          + COS(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * COS(RADIANS(35.5))
            * COS(RADIANS(78.0) - RADIANS(COALESCE(NULLIF(sl.longitude, 0), 77.4126)))
        ))),
        ACOS(LEAST(1, GREATEST(-1,
          SIN(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * SIN(RADIANS(8.1))
          + COS(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * COS(RADIANS(8.1))
            * COS(RADIANS(77.5) - RADIANS(COALESCE(NULLIF(sl.longitude, 0), 77.4126)))
        ))),
        ACOS(LEAST(1, GREATEST(-1,
          SIN(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * SIN(RADIANS(28.2))
          + COS(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * COS(RADIANS(28.2))
            * COS(RADIANS(97.4) - RADIANS(COALESCE(NULLIF(sl.longitude, 0), 77.4126)))
        ))),
        ACOS(LEAST(1, GREATEST(-1,
          SIN(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * SIN(RADIANS(23.9))
          + COS(RADIANS(COALESCE(NULLIF(sl.latitude, 0), 23.2599))) * COS(RADIANS(23.9))
            * COS(RADIANS(68.1) - RADIANS(COALESCE(NULLIF(sl.longitude, 0), 77.4126)))
        )))
      )
    )
  ) AS radius_km,
  sl.radius, sl.opening_time, sl.closing_time, sl.serviceability, sl.is_active, sl.created_at,
  sl.updated_at, sl.tahsil, sl.delhivery_warehouse_name, sl.delhivery_warehouse_created_at,
  sl.delhivery_warehouse_response
FROM `odopmartmp_new`.`store_locations` sl;
