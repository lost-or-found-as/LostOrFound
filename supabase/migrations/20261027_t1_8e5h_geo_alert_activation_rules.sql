-- T1.8E.5H - Area alert activation rules.
--
-- Rule 1: at most ONE live area alert per report at any time, regardless of radius/tier.
-- Rule 2: at most TWO paid area-alert activations per report in total.
-- Each activation gets its own campaign, so recipients are alerted again on the second
-- activation (maximum two alerts per person per report).
--
-- Contents:
--   0. Preconditions (cleanup must have run).
--   1. btree_gist extension (required by the exclusion constraint).
--   2. report_orders.status accepts SUPERSEDED (the backend already writes it).
--   3. Exclusion constraint: no overlapping live area-alert entitlements per report.
--   4. geo_alert_activation_state(report)  - read-only state for the order pre-check.
--   5. geo_alert_create_entitlement(order) - locks the report, expires stale rows,
--      enforces rules 1 and 2 and inserts the entitlement in one transaction.
--
-- Run AFTER scripts/sql/cleanup-t1-8e5h-overlapping-geo-alerts.sql.
-- Repeatable: safe to run more than once.

begin;

-- 0. Preconditions.
do $precondition$
declare
  v_reports text;
begin
  select string_agg(distinct a.report_id::text, ', ')
    into v_reports
  from public.report_entitlements a
  join public.report_entitlements b
    on b.report_id = a.report_id
   and b.id <> a.id
   and b.product_code like 'GEO_ALERT_TIER_%'
   and b.status in ('ACTIVE', 'GRACE', 'PAUSED')
   and tstzrange(b.starts_at, b.current_period_end, '[)')
       && tstzrange(a.starts_at, a.current_period_end, '[)')
  where a.product_code like 'GEO_ALERT_TIER_%'
    and a.status in ('ACTIVE', 'GRACE', 'PAUSED');

  if v_reports is not null then
    raise exception 'T1_8E5H_PRECONDITION_FAILED: overlapping area-alert entitlements on reports %. Run cleanup-t1-8e5h-overlapping-geo-alerts.sql first.', v_reports;
  end if;
end;
$precondition$;

-- 1. Extension.
create extension if not exists btree_gist with schema extensions;

-- 2. Allow SUPERSEDED on orders (written by reportCommerce.js; previously rejected silently).
alter table public.report_orders drop constraint if exists report_orders_status_check;
alter table public.report_orders add constraint report_orders_status_check
  check (status = any (array[
    'PENDING', 'AUTHORIZED', 'PAID', 'ACTIVE', 'CANCELLED',
    'REFUNDED', 'FAILED', 'EXPIRED', 'SUPERSEDED'
  ]::text[]));

-- 3. Database guarantee for rule 1, based on time ranges (status alone is not reliable,
--    because expired rows are not always moved out of ACTIVE).
alter table public.report_entitlements
  drop constraint if exists report_entitlements_geo_alert_no_overlap;
alter table public.report_entitlements
  add constraint report_entitlements_geo_alert_no_overlap
  exclude using gist (
    report_id with =,
    tstzrange(starts_at, current_period_end, '[)') with &&
  )
  where (product_code like 'GEO_ALERT_TIER_%' and status in ('ACTIVE', 'GRACE', 'PAUSED'));

-- 4. Read-only activation state.
create or replace function public.geo_alert_activation_state(p_report_id uuid)
returns table(active_until timestamptz, activation_count integer, max_activations integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select max(e.current_period_end) filter (
           where e.status in ('ACTIVE', 'GRACE', 'PAUSED')
             and e.current_period_end > now()
         ) as active_until,
         (count(*) filter (
           where e.status in ('ACTIVE', 'GRACE', 'PAUSED', 'EXPIRED')
         ))::integer as activation_count,
         2 as max_activations
  from public.report_entitlements e
  where e.report_id = p_report_id
    and e.product_code like 'GEO_ALERT_TIER_%';
$function$;

revoke all on function public.geo_alert_activation_state(uuid) from public, anon, authenticated;
grant execute on function public.geo_alert_activation_state(uuid) to service_role;

-- 5. Guarded entitlement creation.
create or replace function public.geo_alert_create_entitlement(
  p_order_id                uuid,
  p_user_id                 uuid,
  p_starts_at               timestamptz,
  p_period_end              timestamptz,
  p_provider                text,
  p_provider_transaction_id text,
  p_metadata                jsonb
)
returns setof public.report_entitlements
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_order public.report_orders%rowtype;
  v_state record;
  v_row   public.report_entitlements%rowtype;
begin
  select * into v_order
  from public.report_orders
  where id = p_order_id and user_id = p_user_id;
  if not found then
    raise exception using message = 'GEO_ALERT_ORDER_NOT_FOUND', errcode = 'P0001';
  end if;
  if v_order.product_code not like 'GEO_ALERT_TIER_%' then
    raise exception using message = 'GEO_ALERT_ORDER_INVALID_PRODUCT', errcode = 'P0001';
  end if;

  -- Serialize all activations for the same report.
  perform 1 from public.reports where id = v_order.report_id for update;
  if not found then
    raise exception using message = 'REPORT_NOT_FOUND', errcode = 'P0001';
  end if;

  -- Expire stale rows for this report so they neither block nor count as live.
  update public.report_entitlements
     set status = 'EXPIRED'
   where report_id = v_order.report_id
     and product_code like 'GEO_ALERT_TIER_%'
     and status in ('ACTIVE', 'GRACE', 'PAUSED')
     and current_period_end <= now();

  update public.geo_alert_campaigns
     set status = 'COMPLETED'
   where report_id = v_order.report_id
     and status = 'ACTIVE'
     and ends_at <= now();

  select * into v_state from public.geo_alert_activation_state(v_order.report_id);

  if v_state.active_until is not null then
    raise exception using
      message = 'GEO_ALERT_ALREADY_ACTIVE',
      detail  = to_char(v_state.active_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      errcode = 'P0001';
  end if;

  if v_state.activation_count >= v_state.max_activations then
    raise exception using
      message = 'GEO_ALERT_LIMIT_REACHED',
      detail  = v_state.activation_count::text,
      errcode = 'P0001';
  end if;

  insert into public.report_entitlements (
    user_id, report_id, product_code, order_id, status,
    starts_at, current_period_end, auto_renews,
    provider, provider_original_transaction_id, metadata
  ) values (
    p_user_id, v_order.report_id, v_order.product_code, v_order.id, 'ACTIVE',
    p_starts_at, p_period_end, false,
    coalesce(p_provider, 'TEST'), p_provider_transaction_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_row;

  return next v_row;
end;
$function$;

revoke all on function public.geo_alert_create_entitlement(uuid, uuid, timestamptz, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.geo_alert_create_entitlement(uuid, uuid, timestamptz, timestamptz, text, text, jsonb)
  to service_role;

commit;
