-- T1.9T: prices decided 01.11.2026 and the simpler area alert.
--   Lost case: extension 49 kr; historic case 199 / 349 / 449 kr for 1 / 2 / 3 years,
--   with one or two paid extensions credited (rounded to store price points).
--   Area alert: one push product in three sizes (149 / 249 / 399 kr); tiers 4 and 5 retired.
--   Orders get a refund flag for an area alert that reached nobody.
-- Repeatable: updates set fixed values; columns are added only when missing.

update public.product_catalog set base_price_ore = 4900, active = true where code = 'REPORT_REACTIVATION';

update public.product_catalog c
   set base_price_ore = v.price, active = true
  from (values
    ('LONG_TERM_WATCH_1Y', 19900), ('LONG_TERM_WATCH_1Y_C1', 14900), ('LONG_TERM_WATCH_1Y_C2', 9900),
    ('LONG_TERM_WATCH_2Y', 34900), ('LONG_TERM_WATCH_2Y_C1', 29900), ('LONG_TERM_WATCH_2Y_C2', 24900),
    ('LONG_TERM_WATCH_3Y', 44900), ('LONG_TERM_WATCH_3Y_C1', 39900), ('LONG_TERM_WATCH_3Y_C2', 34900),
    ('GEO_ALERT_TIER_1', 14900), ('GEO_ALERT_TIER_2', 24900), ('GEO_ALERT_TIER_3', 39900)
  ) as v(code, price)
 where c.code = v.code;

update public.product_catalog set active = false where code in ('GEO_ALERT_TIER_4', 'GEO_ALERT_TIER_5');

update public.product_catalog
   set name_no = 'Områdevarsel, opptil 1 km', name_en = 'Area alert, up to 1 km'
 where code = 'GEO_ALERT_TIER_1';
update public.product_catalog
   set name_no = 'Områdevarsel, opptil 3 km', name_en = 'Area alert, up to 3 km'
 where code = 'GEO_ALERT_TIER_2';
update public.product_catalog
   set name_no = 'Områdevarsel, over 3 km', name_en = 'Area alert, over 3 km'
 where code = 'GEO_ALERT_TIER_3';

alter table public.report_orders add column if not exists refund_reason text;
alter table public.report_orders add column if not exists refund_flagged_at timestamptz;
