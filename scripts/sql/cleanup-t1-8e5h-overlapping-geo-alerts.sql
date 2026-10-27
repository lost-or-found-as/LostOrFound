-- T1.8E.5H - One-off data cleanup. NOT a migration. Run ONCE in the Supabase SQL editor
-- BEFORE 20261027_t1_8e5h_geo_alert_activation_rules.sql.
--
-- Purpose: two reports have two overlapping area-alert activations, which the new
-- exclusion constraint does not allow. The LATER activation on each report is cancelled.
-- The earlier activation is kept unchanged.
--
--   Report 1d62352f-a218-4ed2-8eb4-62556fadefb3 (test 27.10.2026)
--     keep:   order 6fc8fa9a / entitlement da773c83 / campaign acab8f8b (12:40 UTC, 3000 m)
--     cancel: order bc7bf2af / entitlement 7909a99c / campaign 3ece7ad3 (13:09 UTC, 1500 m)
--   Report cca1024e-445a-4649-8ea9-2300ebb5c224 (test 15.10.2026, already expired)
--     keep:   order 4604a664 / entitlement eb355255 / campaign f6bd6f81 (18:02 UTC, 5000 m)
--     cancel: order 6e1c470a / entitlement 7d15f6b7 / campaign 87fc9cfb (19:25 UTC, 1500 m)
--
-- Safe to re-run: rows already CANCELLED are left alone. The whole script rolls back if
-- any of the six rows is missing or ends in an unexpected state.
-- Notifications already delivered are NOT deleted (test accounts only; kept as evidence).

begin;

update public.report_entitlements
   set status = 'CANCELLED'
 where id in ('7909a99c-fe4a-4e65-8eb0-70da328f390c', '7d15f6b7-7565-453a-802a-a6c1536cd501')
   and status = 'ACTIVE';

update public.report_orders
   set status = 'CANCELLED', updated_at = now()
 where id in ('bc7bf2af-674c-4f23-ad5c-fb701bccd35e', '6e1c470a-8ad0-4e6c-9fdb-8a8cdebc972e')
   and status = 'ACTIVE';

update public.geo_alert_campaigns
   set status = 'CANCELLED'
 where id in ('3ece7ad3-9367-4d69-9371-ea6b6806008b', '87fc9cfb-f948-4fc2-9b3f-47c622ac03cf')
   and status = 'ACTIVE';

do $verify$
declare
  v_ok integer;
begin
  select (select count(*) from public.report_entitlements
           where id in ('7909a99c-fe4a-4e65-8eb0-70da328f390c', '7d15f6b7-7565-453a-802a-a6c1536cd501')
             and status = 'CANCELLED')
       + (select count(*) from public.report_orders
           where id in ('bc7bf2af-674c-4f23-ad5c-fb701bccd35e', '6e1c470a-8ad0-4e6c-9fdb-8a8cdebc972e')
             and status = 'CANCELLED')
       + (select count(*) from public.geo_alert_campaigns
           where id in ('3ece7ad3-9367-4d69-9371-ea6b6806008b', '87fc9cfb-f948-4fc2-9b3f-47c622ac03cf')
             and status = 'CANCELLED')
    into v_ok;
  if v_ok <> 6 then
    raise exception 'T1_8E5H_CLEANUP_FAILED: expected 6 cancelled rows, found %', v_ok;
  end if;

  -- The kept activations must be untouched.
  if (select count(*) from public.report_entitlements
       where id in ('da773c83-50af-436f-9e2a-071d9ac00c3a', 'eb355255-059d-462f-a462-f3bcfaa588c7')
         and status = 'ACTIVE') <> 2 then
    raise exception 'T1_8E5H_CLEANUP_FAILED: kept entitlements are not ACTIVE';
  end if;
end;
$verify$;

commit;

-- Result for the screenshot: every row below must show the expected status.
select 'entitlement' as kind, id, status from public.report_entitlements
 where id in ('7909a99c-fe4a-4e65-8eb0-70da328f390c', '7d15f6b7-7565-453a-802a-a6c1536cd501',
              'da773c83-50af-436f-9e2a-071d9ac00c3a', 'eb355255-059d-462f-a462-f3bcfaa588c7')
union all
select 'order', id, status from public.report_orders
 where id in ('bc7bf2af-674c-4f23-ad5c-fb701bccd35e', '6e1c470a-8ad0-4e6c-9fdb-8a8cdebc972e',
              '6fc8fa9a-bdfc-4d4e-90ee-3de96505fffe', '4604a664-b8ce-4640-be54-0c8b08dc140c')
union all
select 'campaign', id, status from public.geo_alert_campaigns
 where id in ('3ece7ad3-9367-4d69-9371-ea6b6806008b', '87fc9cfb-f948-4fc2-9b3f-47c622ac03cf',
              'acab8f8b-0f7c-4739-b552-a3c2c8ae22ae', 'f6bd6f81-aa57-4124-a439-8e5b930221a6')
order by 1, 3, 2;
