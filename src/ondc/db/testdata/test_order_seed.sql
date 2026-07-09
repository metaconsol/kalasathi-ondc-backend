-- =============================================================================
-- TEST DATA (not a migration!) — seeds one fake ONDC order so the seller
-- dashboard's ONDC Orders tab / order detail page can be exercised without a
-- real buyer app. Run the CLEANUP block at the bottom when done.
--
-- Before running, replace the three ids:
--   @SELLER_ID  = the `User`.id you LOG IN with (role SELLER) — the order list
--                 is filtered by this, wrong id = order invisible
--   @STORE_ID   = stores.id for that seller  (SELECT id FROM stores WHERE seller_user_id = @SELLER_ID)
--   @PRODUCT_ID = a real products.id from that store (name/image resolve on the page)
--
-- bap_uri points at 127.0.0.1:9 so any Update-Fulfillment callback attempt
-- fails instantly and harmlessly. If you Book Shipment on this order, CANCEL
-- the shipment before deleting the order (a real Delhivery manifest is live).
-- =============================================================================

SET @SELLER_ID  = 1;                       -- <-- replace
SET @STORE_ID   = 45;                      -- <-- replace
SET @PRODUCT_ID = 32;                      -- <-- replace
SET @ORDER_ID   = 'TEST-ONDC-ORDER-001';
SET @TXN_ID     = 'test-txn-0001';

INSERT INTO ondc_orders
  (ondc_order_id, transaction_id, message_id, domain, city, country, core_version,
   bap_id, bap_uri, bpp_id, provider_id, seller_id, store_id,
   status, payment_method, payment_status,
   item_total, delivery_charges, tax_total, order_total, currency, item_count,
   customer_name, customer_phone, customer_email, billing_json)
VALUES
  (@ORDER_ID, @TXN_ID, 'test-msg-0001', 'ONDC:RET12', 'std:0755', 'IND', '1.2.5',
   'test-buyer-app.local', 'http://127.0.0.1:9', 'preprod.odopmartmp.com',
   CAST(@STORE_ID AS CHAR), @SELLER_ID, @STORE_ID,
   'CREATED', 'PREPAID', 'PAID',
   99.00, 37.40, 2.97, 139.37, 'INR', 1,
   'Test Buyer', '9999999999', 'testbuyer@example.com',
   '{"name":"Test Buyer","phone":"9999999999","address":{"street":"MIG 90 Test Street","city":"Bhopal","state":"Madhya Pradesh","area_code":"462003"}}');

INSERT INTO ondc_order_items
  (ondc_order_id, transaction_id, item_id, product_id, provider_id, seller_id,
   quantity, unit_price, line_amount, currency, fulfillment_id)
VALUES
  (@ORDER_ID, @TXN_ID, CAST(@PRODUCT_ID AS CHAR), @PRODUCT_ID,
   CAST(@STORE_ID AS CHAR), @SELLER_ID, 1, 99.00, 99.00, 'INR', 'F1');

INSERT INTO ondc_fulfillments
  (ondc_order_id, transaction_id, fulfillment_id, fulfillment_type, state, contact_phone)
VALUES
  (@ORDER_ID, @TXN_ID, 'F1', 'Delivery', 'Pending', '9999999999');

INSERT INTO ondc_order_status_history
  (ondc_order_id, from_status, to_status, fulfillment_state, triggered_by, note)
VALUES
  (@ORDER_ID, NULL, 'CREATED', 'Pending', 'system', 'Test order seeded via SQL');

-- =============================================================================
-- CLEANUP — removes every trace of the test order. Run when testing is done.
-- =============================================================================
-- SET @ORDER_ID = 'TEST-ONDC-ORDER-001';
-- DELETE FROM ondc_order_status_history WHERE ondc_order_id = @ORDER_ID;
-- DELETE FROM ondc_order_actions        WHERE ondc_order_id = @ORDER_ID;
-- DELETE FROM ondc_order_items          WHERE ondc_order_id = @ORDER_ID;
-- DELETE FROM ondc_fulfillments         WHERE ondc_order_id = @ORDER_ID;
-- DELETE FROM ondc_orders               WHERE ondc_order_id = @ORDER_ID;
