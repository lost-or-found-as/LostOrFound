-- T1.8E.5G.1 - READ-ONLY post-migration verification. NOT a migration.
-- Run in the Supabase SQL editor after 20261027_t1_8e5g1_area_alert_user_eligibility.sql.
-- Every row must show ok = true.

with defs as (
  select p.proname,
         pg_get_function_result(p.oid) as result_type,
         pg_get_functiondef(p.oid)     as def,
         p.proacl::text                as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('geo_alert_eligible_users',
                      'geo_alert_eligible_installations',
                      'geo_alert_create_in_app_notifications')
)
select 'users: exists with push_requested' as check_name,
       exists (select 1 from defs where proname = 'geo_alert_eligible_users'
               and result_type ilike '%push_requested boolean%') as ok
union all
select 'users: no push_installations dependency',
       exists (select 1 from defs where proname = 'geo_alert_eligible_users'
               and def not ilike '%push_installations%')
union all
select 'users: expired areas excluded',
       exists (select 1 from defs where proname = 'geo_alert_eligible_users'
               and def ilike '%wa.expires_at is null or wa.expires_at > now()%')
union all
select 'installations: derived from users',
       exists (select 1 from defs where proname = 'geo_alert_eligible_installations'
               and def ilike '%from public.geo_alert_eligible_users(p_campaign_id)%'
               and def not ilike '%notification_watch_areas%')
union all
select 'installations: push_requested + active + granted',
       exists (select 1 from defs where proname = 'geo_alert_eligible_installations'
               and def ilike '%u.push_requested = true%'
               and def ilike '%pi.active = true%'
               and def ilike '%pi.permission_status = ''granted''%')
union all
select 'in-app: idempotent on notification_key',
       exists (select 1 from defs where proname = 'geo_alert_create_in_app_notifications'
               and def ilike '%on conflict (notification_key)%do nothing%')
union all
select 'grants: service_role only on all three',
       (select count(*) from defs
         where acl ~ 'service_role=X'
           and acl !~ '(anon|authenticated)=X'
           and acl !~ '[{,]=X') = 3
union all
select 'dedup index present',
       exists (select 1 from pg_indexes
               where schemaname = 'public' and indexname = 'notifications_notification_key_uidx')
union all
select 'no duplicate AREA_ALERT rows',
       not exists (select 1 from public.notifications
                   where type = 'AREA_ALERT' and entity_type = 'area_alert_campaign'
                   group by user_id, entity_id having count(*) > 1);
