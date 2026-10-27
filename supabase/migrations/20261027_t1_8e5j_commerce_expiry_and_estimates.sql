-- T1.8E.5J - One qualification rule for dispatch and estimates, and expiry of paid services.
--
--  1. geo_alert_qualifying_users(owner, point, radius, category)
--       The single definition of which watch areas match a point. Used by:
--         - geo_alert_eligible_users        (dispatch: Nearby + push)
--         - preview_geo_alert_audience      (price estimate before purchase)
--         - refresh_geo_alert_estimate      (campaign estimate)
--       Before this package the estimates counted only users with push and ignored polygon
--       areas and expiry, so the price tier could be lower than the real audience.
--  2. process_commerce_expiry() + its own pg_cron job (every 15 minutes, offset from the
--     existing lost-or-found-report-lifecycle job, which is NOT changed):
--       - entitlements past their period (not auto-renewing)  -> EXPIRED
--       - area-alert campaigns past ends_at                   -> COMPLETED
--       - ACTIVE orders whose entitlement has ended           -> EXPIRED
--       - PENDING / AUTHORIZED orders older than 24 hours     -> EXPIRED
--
-- Return types of existing functions are unchanged (create or replace only).
-- Repeatable: safe to run more than once.

begin;

-- 0. Preconditions.
do $precondition$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'T1_8E5J_PRECONDITION_FAILED: pg_cron is not installed';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'geo_alert_campaigns' and column_name = 'completed_at'
  ) then
    raise exception 'T1_8E5J_PRECONDITION_FAILED: geo_alert_campaigns.completed_at is missing';
  end if;
end;
$precondition$;

-- 1. Shared qualification core.
create or replace function public.geo_alert_qualifying_users(
  p_owner_id     uuid,
  p_point        geography,
  p_radius_m     integer,
  p_category_key text
)
returns table(
  recipient_user_id     uuid,
  watch_area_id         uuid,
  push_enabled          boolean,
  watch_area_updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select wa.user_id, wa.id, wa.push_enabled, wa.updated_at
  from public.notification_watch_areas wa
  where p_point is not null
    and wa.active = true
    and (wa.expires_at is null or wa.expires_at > now())
    and wa.user_id <> p_owner_id
    and (wa.all_categories = true
         or upper(coalesce(p_category_key, '')) = any(coalesce(wa.category_keys, '{}'::text[])))
    and case
          when wa.area_type = 'POLYGON'
            then st_dwithin(wa.boundary, p_point, coalesce(p_radius_m, 0))
          else st_dwithin(wa.center, p_point, wa.radius_m + coalesce(p_radius_m, 0))
        end;
$function$;

revoke all on function public.geo_alert_qualifying_users(uuid, geography, integer, text) from public, anon, authenticated;
grant execute on function public.geo_alert_qualifying_users(uuid, geography, integer, text) to service_role;

-- 2. Dispatch: same return type as T1.8E.5G.1, now built on the shared core.
create or replace function public.geo_alert_eligible_users(p_campaign_id uuid)
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
    select c.id as campaign_id, q.recipient_user_id, q.watch_area_id, q.push_enabled,
           q.watch_area_updated_at, c.report_id, c.report_title, c.category_key
    from campaign c
    cross join lateral public.geo_alert_qualifying_users(
      c.report_owner_id, c.geometry::geography, c.radius_m, c.category_key) q
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

-- 3. Price estimate before purchase: counts the same audience as the dispatch.
create or replace function public.preview_geo_alert_audience(p_report_id uuid, p_user_id uuid, p_radius_m integer)
returns table(
  report_id              uuid,
  latitude               double precision,
  longitude              double precision,
  radius_m               integer,
  area_sq_km             numeric,
  category_key           text,
  eligible_users         integer,
  eligible_installations integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with report_source as (
    select r.id,
           r.user_id,
           r.lat::double precision as latitude,
           r.lng::double precision as longitude,
           upper(coalesce(r.category::text, '')) as category_key,
           st_setsrid(st_makepoint(r.lng::double precision, r.lat::double precision), 4326)::geography as point
    from public.reports r
    where r.id = p_report_id
      and r.user_id = p_user_id
      and r.deleted_at is null
      and upper(r.type::text) = 'LOST'
      and r.lat is not null
      and r.lng is not null
  ),
  users as (
    select q.recipient_user_id, bool_or(q.push_enabled) as push_requested
    from report_source rs
    cross join lateral public.geo_alert_qualifying_users(rs.user_id, rs.point, p_radius_m, rs.category_key) q
    group by q.recipient_user_id
  ),
  installs as (
    select distinct pi.installation_id
    from users u
    join public.push_installations pi
      on pi.user_id = u.recipient_user_id
     and pi.active = true
     and pi.permission_status = 'granted'
    where u.push_requested = true
  )
  select rs.id,
         rs.latitude,
         rs.longitude,
         p_radius_m,
         round((pi() * p_radius_m * p_radius_m / 1000000.0)::numeric, 4),
         rs.category_key,
         (select count(*) from users)::integer,
         (select count(*) from installs)::integer
  from report_source rs
  where p_radius_m between 250 and 50000;
$function$;

revoke all on function public.preview_geo_alert_audience(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.preview_geo_alert_audience(uuid, uuid, integer) to service_role;

-- 4. Campaign estimate: users from the dispatch rule, installations from the push rule.
create or replace function public.refresh_geo_alert_estimate(p_campaign_id uuid)
returns table(eligible_users integer, eligible_installations integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_users integer;
  v_installations integer;
begin
  select count(*)::integer into v_users
  from public.geo_alert_eligible_users(p_campaign_id);

  select count(*)::integer into v_installations
  from public.geo_alert_eligible_installations(p_campaign_id);

  update public.geo_alert_campaigns
     set estimated_eligible_users = coalesce(v_users, 0),
         updated_at = now()
   where id = p_campaign_id;

  return query select coalesce(v_users, 0), coalesce(v_installations, 0);
end;
$function$;

revoke all on function public.refresh_geo_alert_estimate(uuid) from public, anon, authenticated;
grant execute on function public.refresh_geo_alert_estimate(uuid) to service_role;

-- 5. Expiry of paid services. Order matters: entitlements first, then the orders that depend on them.
create or replace function public.process_commerce_expiry()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_entitlements integer := 0;
  v_campaigns integer := 0;
  v_active_orders integer := 0;
  v_stale_orders integer := 0;
begin
  update public.report_entitlements e
     set status = 'EXPIRED'
   where e.status in ('ACTIVE', 'GRACE', 'PAUSED')
     and coalesce(e.auto_renews, false) = false
     and e.current_period_end is not null
     and e.current_period_end <= v_now;
  get diagnostics v_entitlements = row_count;

  update public.geo_alert_campaigns c
     set status = 'COMPLETED',
         completed_at = coalesce(c.completed_at, v_now),
         updated_at = v_now
   where upper(c.status::text) = 'ACTIVE'
     and c.ends_at is not null
     and c.ends_at <= v_now;
  get diagnostics v_campaigns = row_count;

  update public.report_orders o
     set status = 'EXPIRED', updated_at = v_now
   where o.status = 'ACTIVE'
     and exists (select 1 from public.report_entitlements e
                 where e.order_id = o.id and e.status = 'EXPIRED')
     and not exists (select 1 from public.report_entitlements e
                     where e.order_id = o.id and e.status in ('ACTIVE', 'GRACE', 'PAUSED'));
  get diagnostics v_active_orders = row_count;

  update public.report_orders o
     set status = 'EXPIRED', updated_at = v_now
   where o.status in ('PENDING', 'AUTHORIZED')
     and o.created_at < v_now - interval '24 hours';
  get diagnostics v_stale_orders = row_count;

  return jsonb_build_object(
    'expired_entitlements', v_entitlements,
    'completed_campaigns', v_campaigns,
    'expired_active_orders', v_active_orders,
    'expired_stale_orders', v_stale_orders
  );
end;
$function$;

revoke all on function public.process_commerce_expiry() from public, anon, authenticated;
grant execute on function public.process_commerce_expiry() to service_role;

-- 6. Own schedule. cron.schedule with an existing job name updates that job (repeatable).
select cron.schedule(
  'lost-or-found-commerce-expiry',
  '7,22,37,52 * * * *',
  $cron$select public.process_commerce_expiry();$cron$
);

commit;
