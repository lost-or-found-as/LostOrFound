-- T1.8E.5H - READ-ONLY post-migration verification. NOT a migration.
-- Run in the Supabase SQL editor after the cleanup and the migration. Every row must show ok = true.

with fns as (
  select p.proname, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('geo_alert_activation_state', 'geo_alert_create_entitlement')
)
select 'exclusion constraint present (all tiers, time based)' as check_name,
       exists (select 1 from pg_constraint
               where conname = 'report_entitlements_geo_alert_no_overlap' and contype = 'x'
                 and pg_get_constraintdef(oid) ilike '%tstzrange(starts_at, current_period_end%'
                 and pg_get_constraintdef(oid) ilike '%GEO_ALERT_TIER_%') as ok
union all
select 'orders accept SUPERSEDED',
       exists (select 1 from pg_constraint
               where conname = 'report_orders_status_check'
                 and pg_get_constraintdef(oid) ilike '%SUPERSEDED%')
union all
select 'btree_gist installed',
       exists (select 1 from pg_extension where extname = 'btree_gist')
union all
select 'state function present',
       exists (select 1 from fns where proname = 'geo_alert_activation_state')
union all
select 'create function locks report and enforces both rules',
       exists (select 1 from fns where proname = 'geo_alert_create_entitlement'
               and def ilike '%for update%'
               and def ilike '%GEO_ALERT_ALREADY_ACTIVE%'
               and def ilike '%GEO_ALERT_LIMIT_REACHED%')
union all
select 'functions executable by service_role only',
       (select count(*) from fns
         where acl ~ 'service_role=X' and acl !~ '(anon|authenticated)=X' and acl !~ '[{,]=X') = 2
union all
select 'no overlapping live area alerts remain',
       not exists (
         select 1 from public.report_entitlements a
         join public.report_entitlements b
           on b.report_id = a.report_id and b.id <> a.id
          and b.product_code like 'GEO_ALERT_TIER_%' and b.status in ('ACTIVE', 'GRACE', 'PAUSED')
          and tstzrange(b.starts_at, b.current_period_end, '[)') && tstzrange(a.starts_at, a.current_period_end, '[)')
         where a.product_code like 'GEO_ALERT_TIER_%' and a.status in ('ACTIVE', 'GRACE', 'PAUSED'))
union all
select 'test report 1d62352f: live until 03.11, one counted activation',
       exists (select 1 from public.geo_alert_activation_state('1d62352f-a218-4ed2-8eb4-62556fadefb3')
               where active_until is not null and activation_count = 1);
