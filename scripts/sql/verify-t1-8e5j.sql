-- T1.8E.5J - READ-ONLY post-migration verification. NOT a migration.
-- Run in the Supabase SQL editor AFTER the migration and AFTER one manual run of
--   select public.process_commerce_expiry();
-- Every row must show ok = true.

with fns as (
  select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname in ('geo_alert_eligible_users', 'preview_geo_alert_audience', 'refresh_geo_alert_estimate')
),
camps as (
  select c.id, c.report_id, c.radius_m, r.user_id as owner_id
  from public.geo_alert_campaigns c join public.reports r on r.id = c.report_id
  where public.geo_alert_campaign_is_dispatchable(c.id)
),
new_set as (
  select c.id as campaign_id, u.recipient_user_id
  from camps c cross join lateral public.geo_alert_eligible_users(c.id) u
),
old_set as (
  -- The T1.8E.5G.1 rule written out inline, with real PostGIS.
  select distinct c.id as campaign_id, wa.user_id as recipient_user_id
  from public.geo_alert_campaigns c
  join public.reports r on r.id = c.report_id
  join public.notification_watch_areas wa
    on wa.active = true
   and (wa.expires_at is null or wa.expires_at > now())
   and wa.user_id <> r.user_id
   and (wa.all_categories = true
        or upper(coalesce(r.category::text, '')) = any(coalesce(wa.category_keys, '{}'::text[])))
   and case
         when c.geometry is null then false
         when wa.area_type = 'POLYGON' then st_dwithin(wa.boundary, c.geometry, coalesce(c.radius_m, 0))
         else st_dwithin(wa.center, c.geometry, wa.radius_m + coalesce(c.radius_m, 0))
       end
  where c.id in (select id from camps)
)
select 'dispatch, preview and refresh use the shared rule' as check_name,
       (select count(*) from fns
         where proname in ('geo_alert_eligible_users', 'preview_geo_alert_audience')
           and def ilike '%geo_alert_qualifying_users(%') = 2
       and exists (select 1 from fns where proname = 'refresh_geo_alert_estimate'
                   and def ilike '%from public.geo_alert_eligible_users(p_campaign_id)%') as ok
union all
select 'dispatch unchanged: no recipient only in NEW',
       not exists (select * from new_set except select * from old_set)
union all
select 'dispatch unchanged: no recipient only in OLD',
       not exists (select * from old_set except select * from new_set)
union all
select 'commerce expiry job scheduled',
       exists (select 1 from cron.job where jobname = 'lost-or-found-commerce-expiry'
               and schedule = '7,22,37,52 * * * *' and command ilike '%process_commerce_expiry%')
union all
select 'report lifecycle job still scheduled',
       exists (select 1 from cron.job where jobname = 'lost-or-found-report-lifecycle')
union all
select 'no live entitlement past its end (non-renewing)',
       not exists (select 1 from public.report_entitlements
                   where status in ('ACTIVE', 'GRACE', 'PAUSED') and coalesce(auto_renews, false) = false
                     and current_period_end <= now())
union all
select 'no ACTIVE campaign past ends_at',
       not exists (select 1 from public.geo_alert_campaigns where upper(status::text) = 'ACTIVE' and ends_at <= now())
union all
select 'no PENDING/AUTHORIZED order older than 24h',
       not exists (select 1 from public.report_orders where status in ('PENDING', 'AUTHORIZED')
                   and created_at < now() - interval '24 hours')
union all
select 'test report 1d62352f still live until 03.11',
       exists (select 1 from public.geo_alert_activation_state('1d62352f-a218-4ed2-8eb4-62556fadefb3')
               where active_until is not null);
