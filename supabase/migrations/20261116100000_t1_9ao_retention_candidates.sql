-- T1.9AO: cases that may be deleted under the retention rule (Personvern i Lost or Found, ch. 6):
-- closed or expired cases with no activity for 12 months, no running paid service and no legal
-- hold. The server job (server/lib/retentionPurge.js) reads this list; in mode "report" it only
-- counts, in mode "delete" it deletes. Never fewer than 6 months, at most 1000 per call.
-- Repeatable: the function is replaced.
create or replace function public.report_retention_candidates(p_months integer default 12, p_limit integer default 200)
returns table(report_id uuid, user_id uuid, report_type text, status text, has_orders boolean, last_activity timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with base as (
    select r.id,
           r.user_id,
           r.type::text as report_type,
           r.status,
           -- greatest() skips nulls: the latest of everything that happened on the case.
           greatest(
             r.created_at, r.closed_at, r.archived_at, r.visible_until, r.last_extended_at, r.last_critical_edit_at,
             (select max(o.created_at) from public.area_alert_observations o where o.report_id = r.id),
             (select max(s.created_at) from public.report_owner_sightings s where s.report_id = r.id)
           ) as last_activity
    from public.reports r
    where r.deleted_at is null
      and r.purged_at is null
      and r.legal_hold_at is null
      and (r.status in ('CLOSED', 'EXPIRED', 'ARCHIVED') or r.closed_at is not null)
      and not exists (
        select 1 from public.report_entitlements e
        where e.report_id = r.id
          and upper(e.status) = 'ACTIVE'
          and (e.current_period_end is null or e.current_period_end > now())
      )
      and not exists (
        select 1 from public.long_term_watches w
        where w.report_id = r.id
          and upper(w.status) = 'ACTIVE'
          and (w.current_period_end is null or w.current_period_end > now())
      )
  )
  select b.id,
         b.user_id,
         b.report_type,
         b.status,
         exists (select 1 from public.report_orders o where o.report_id = b.id),
         b.last_activity
  from base b
  where b.last_activity < now() - make_interval(months => greatest(coalesce(p_months, 12), 6))
  order by b.last_activity
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.report_retention_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.report_retention_candidates(integer, integer) to service_role;
