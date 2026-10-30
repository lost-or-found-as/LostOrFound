-- T1.9J: make sure the paid products exist in every database.
-- The product catalog was never part of the migrations (only the table was), so a database
-- built from migrations (staging) had no area-alert or extension products, and ordering them
-- failed with PRODUCT_NOT_AVAILABLE. Rows that already exist (production) are left unchanged.
-- Prices are TEST prices and match server/lib/geoAlertPricing.js (TIER_PRICES_ORE) and the
-- app's REACTIVATION_TEST_PRICE until the store products exist.
insert into public.product_catalog (code, name_no, name_en, product_type, billing_period, duration_count, base_price_ore, currency, active, metadata)
values
  ('REPORT_REACTIVATION', 'Forlengelse, 30 dager', 'Extension, 30 days', 'ONE_TIME', 'DAY', 30, 9900, 'NOK', true,
    '{"kind": "LOST_EXTENSION", "test_price": true}'::jsonb),
  ('GEO_ALERT_TIER_1', 'Områdevarsel, nivå 1', 'Area alert, tier 1', 'ONE_TIME', 'DAY', 7, 9900, 'NOK', true,
    '{"kind": "GEO_ALERT", "tier": 1, "test_price": true}'::jsonb),
  ('GEO_ALERT_TIER_2', 'Områdevarsel, nivå 2', 'Area alert, tier 2', 'ONE_TIME', 'DAY', 7, 14900, 'NOK', true,
    '{"kind": "GEO_ALERT", "tier": 2, "test_price": true}'::jsonb),
  ('GEO_ALERT_TIER_3', 'Områdevarsel, nivå 3', 'Area alert, tier 3', 'ONE_TIME', 'DAY', 7, 24900, 'NOK', true,
    '{"kind": "GEO_ALERT", "tier": 3, "test_price": true}'::jsonb),
  ('GEO_ALERT_TIER_4', 'Områdevarsel, nivå 4', 'Area alert, tier 4', 'ONE_TIME', 'DAY', 7, 39900, 'NOK', true,
    '{"kind": "GEO_ALERT", "tier": 4, "test_price": true}'::jsonb),
  ('GEO_ALERT_TIER_5', 'Områdevarsel, nivå 5', 'Area alert, tier 5', 'ONE_TIME', 'DAY', 7, 59900, 'NOK', true,
    '{"kind": "GEO_ALERT", "tier": 5, "test_price": true}'::jsonb)
on conflict (code) do nothing;
