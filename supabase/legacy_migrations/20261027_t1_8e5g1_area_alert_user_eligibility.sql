-- T1.8E.5G.1 - Area alert user-level eligibility as the single qualification source.
--
-- Layer 1 (user):         public.geo_alert_eligible_users
--                         Decides who receives the internal AREA_ALERT under Nearby.
--                         Never depends on push installations.
-- Layer 2 (installation): public.geo_alert_eligible_installations
--                         Derived strictly from layer 1. Push is attempted only for users
--                         with at least one qualifying push-enabled area and an active,
--                         granted installation.
-- Inbox write:            public.geo_alert_create_in_app_notifications
--                         Set-based and idempotent through notifications_notification_key_uidx.
--
-- Product decisions (27.10.2026):
--   - Expired watch areas (expires_at <= now()) do not qualify.
--   - A qualifying area with push_enabled = false gives Nearby only, never push.
--
-- Repeatable: safe to run more than once.

begin;

-- 0. Preconditions. Fail loudly instead of silently weakening deduplication or breaking callers.
do $precondition$
declare
  v_dependents text;
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'notifications'
      and indexname = 'notifications_notification_key_uidx'
      and indexdef ilike '%unique%'
  ) then
    raise exception 'T1_8E5G1_PRECONDITION_FAILED: unique index notifications_notification_key_uidx is missing';
  end if;

  -- geo_alert_eligible_users is dropped and recreated below because its return type changes.
  -- Refuse to continue if any other function body still calls it.
  select string_agg(p.proname, ', ' order by p.proname)
    into v_dependents
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not in (
      'geo_alert_eligible_users',
      'geo_alert_eligible_installations',
      'geo_alert_create_in_app_notifications'
    )
    and p.prosrc ilike '%geo_alert_eligible_users%';

  if v_dependents is not null then
    raise exception 'T1_8E5G1_PRECONDITION_FAILED: geo_alert_eligible_users is referenced by %', v_dependents;
  end if;
end;
$precondition$;

-- 1. User-level eligibility.
drop function if exists public.geo_alert_eligible_users(uuid);

create function public.geo_alert_eligible_users(p_campaign_id uuid)
returns table(
  campaign_id       uuid,
  recipient_user_id uuid,
  watch_area_id     uuid,
  push_requested    boolean,
  report_id         uuid,
  report_title      text,
  category_key      text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with campaign as (
    select c.id,
           c.report_id,
           c.geometry,
           c.radius_m,
           r.user_id as report_owner_id,
           r.title   as report_title,
           upper(coalesce(r.category::text, '')) as category_key
    from public.geo_alert_campaigns c
    join public.reports r on r.id = c.report_id
    where c.id = p_campaign_id
      and upper(c.status::text) = 'ACTIVE'
      and coalesce(c.ends_at, now() + interval '1 minute') > now()
      and r.deleted_at is null
      and upper(r.status::text) = 'ACTIVE'
      and upper(r.type::text) = 'LOST'
  ),
  qualifying as (
    select c.id          as campaign_id,
           wa.user_id    as recipient_user_id,
           wa.id         as watch_area_id,
           wa.push_enabled,
           wa.updated_at as watch_area_updated_at,
           c.report_id,
           c.report_title,
           c.category_key
    from campaign c
    join public.notification_watch_areas wa
      on wa.active = true
     and (wa.expires_at is null or wa.expires_at > now())
     and wa.user_id <> c.report_owner_id
     and (wa.all_categories = true
          or c.category_key = any(coalesce(wa.category_keys, '{}'::text[])))
     and case
           when c.geometry is null then false
           when wa.area_type = 'POLYGON'
             then st_dwithin(wa.boundary, c.geometry, coalesce(c.radius_m, 0))
           else st_dwithin(wa.center, c.geometry, wa.radius_m + coalesce(c.radius_m, 0))
         end
  )
  select distinct on (q.recipient_user_id)
         q.campaign_id,
         q.recipient_user_id,
         q.watch_area_id,
         bool_or(q.push_enabled) over (partition by q.recipient_user_id) as push_requested,
         q.report_id,
         q.report_title,
         q.category_key
  from qualifying q
  order by q.recipient_user_id,
           q.push_enabled desc,
           q.watch_area_updated_at desc,
           q.watch_area_id;
$function$;

revoke all on function public.geo_alert_eligible_users(uuid) from public, anon, authenticated;
grant execute on function public.geo_alert_eligible_users(uuid) to service_role;

-- 2. Installation-level eligibility, derived from layer 1. Return type unchanged.
create or replace function public.geo_alert_eligible_installations(p_campaign_id uuid)
returns table(
  campaign_id       uuid,
  recipient_user_id uuid,
  installation_id   text,
  expo_push_token   text,
  language          text,
  watch_area_id     uuid,
  report_id         uuid,
  report_title      text,
  category_key      text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct on (pi.installation_id)
         u.campaign_id,
         u.recipient_user_id,
         pi.installation_id,
         pi.expo_push_token,
         pi.language,
         u.watch_area_id,
         u.report_id,
         u.report_title,
         u.category_key
  from public.geo_alert_eligible_users(p_campaign_id) u
  join public.push_installations pi
    on pi.user_id = u.recipient_user_id
   and pi.active = true
   and pi.permission_status = 'granted'
  where u.push_requested = true
  order by pi.installation_id, pi.last_seen_at desc, u.recipient_user_id;
$function$;

revoke all on function public.geo_alert_eligible_installations(uuid) from public, anon, authenticated;
grant execute on function public.geo_alert_eligible_installations(uuid) to service_role;

-- 3. Idempotent inbox write. Title and body are technical values; the app renders
--    AREA_ALERT text from the Norwegian and English localization files.
create or replace function public.geo_alert_create_in_app_notifications(p_campaign_id uuid)
returns table(eligible_users integer, created_notifications integer)
language sql
volatile
security definer
set search_path to 'public'
as $function$
  with eligible as (
    select * from public.geo_alert_eligible_users(p_campaign_id)
  ),
  inserted as (
    insert into public.notifications
      (user_id, type, entity_type, entity_id, title, body, notification_key, agg_count)
    select e.recipient_user_id,
           'AREA_ALERT',
           'area_alert_campaign',
           e.campaign_id,
           'AREA_ALERT',
           coalesce(e.report_title, 'AREA_ALERT'),
           'AREA_ALERT:' || e.campaign_id::text || ':' || e.recipient_user_id::text,
           1
    from eligible e
    on conflict (notification_key) where notification_key is not null do nothing
    returning 1
  )
  select (select count(*) from eligible)::integer,
         (select count(*) from inserted)::integer;
$function$;

revoke all on function public.geo_alert_create_in_app_notifications(uuid) from public, anon, authenticated;
grant execute on function public.geo_alert_create_in_app_notifications(uuid) to service_role;

commit;
