-- T1.9AE: store product ids for every paid product, the same id in App Store Connect and Google
-- Play (lowercase, digits and underscores work in both). These ids must be created exactly like
-- this in both stores and in RevenueCat (Products), as consumable / one-time products.
-- Repeatable: the same values are written every time.
update public.product_catalog c
   set apple_product_id = v.store_id,
       google_product_id = v.store_id,
       updated_at = now()
  from (values
    ('REPORT_REACTIVATION',   'lof_extension_30d'),
    ('GEO_ALERT_TIER_1',      'lof_area_alert_1km'),
    ('GEO_ALERT_TIER_2',      'lof_area_alert_3km'),
    ('GEO_ALERT_TIER_3',      'lof_area_alert_large'),
    ('LONG_TERM_WATCH_1Y',    'lof_historic_1y'),
    ('LONG_TERM_WATCH_1Y_C1', 'lof_historic_1y_c1'),
    ('LONG_TERM_WATCH_1Y_C2', 'lof_historic_1y_c2'),
    ('LONG_TERM_WATCH_2Y',    'lof_historic_2y'),
    ('LONG_TERM_WATCH_2Y_C1', 'lof_historic_2y_c1'),
    ('LONG_TERM_WATCH_2Y_C2', 'lof_historic_2y_c2'),
    ('LONG_TERM_WATCH_3Y',    'lof_historic_3y'),
    ('LONG_TERM_WATCH_3Y_C1', 'lof_historic_3y_c1'),
    ('LONG_TERM_WATCH_3Y_C2', 'lof_historic_3y_c2')
  ) as v(code, store_id)
 where c.code = v.code
   and (c.apple_product_id is distinct from v.store_id or c.google_product_id is distinct from v.store_id);

-- Inactive tiers never get a store id.
update public.product_catalog
   set apple_product_id = null, google_product_id = null, updated_at = now()
 where code in ('GEO_ALERT_TIER_4', 'GEO_ALERT_TIER_5')
   and (apple_product_id is not null or google_product_id is not null);
