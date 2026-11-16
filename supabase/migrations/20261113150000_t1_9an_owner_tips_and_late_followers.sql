-- T1.9AN: two additions to the lost-case flow. Repeatable.
--
-- 1. Owner tips in «Sist sett». Owners often hear about sightings by phone or on social media,
--    not in the app. They can put such a tip on the map themselves. Server only (service role).
create table if not exists public.report_owner_sightings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists report_owner_sightings_report_idx on public.report_owner_sightings (report_id, seen_at desc);

alter table public.report_owner_sightings enable row level security;
revoke all on table public.report_owner_sightings from anon, authenticated;

-- 2. Late followers. Someone who adds or moves an alert area while an area alert or
--    «Synlig i nærheten» is running there gets the case in «I nærheten» too. In-app only:
--    nobody gets a push for an alert that went out before they followed the area.
--    Returns the number of cases added.
create or replace function public.geo_alert_backfill_user(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  with live as (
    select c.id, coalesce(c.kind, 'ALERT') as kind
    from public.geo_alert_campaigns c
    join public.reports r on r.id = c.report_id
    where upper(c.status::text) = 'ACTIVE'
      and c.ends_at > now()
      and r.deleted_at is null
      and upper(r.status::text) = 'ACTIVE'
      and upper(r.type::text) = 'LOST'
      and r.user_id <> p_user_id
  ),
  eligible as (
    select e.campaign_id, e.recipient_user_id, e.report_title, l.kind
    from live l
    cross join lateral public.geo_alert_eligible_users(l.id) e
    where e.recipient_user_id = p_user_id
  ),
  inserted as (
    insert into public.notifications
      (user_id, type, entity_type, entity_id, title, body, notification_key, agg_count)
    select e.recipient_user_id,
           'AREA_ALERT',
           'area_alert_campaign',
           e.campaign_id,
           case when e.kind = 'VISIBILITY' then 'AREA_VISIBILITY' else 'AREA_ALERT' end,
           coalesce(e.report_title, 'AREA_ALERT'),
           'AREA_ALERT:' || e.campaign_id::text || ':' || e.recipient_user_id::text,
           1
    from eligible e
    on conflict (notification_key) where notification_key is not null do nothing
    returning 1
  )
  select count(*)::integer from inserted;
$$;

revoke all on function public.geo_alert_backfill_user(uuid) from public, anon, authenticated;
grant execute on function public.geo_alert_backfill_user(uuid) to service_role;
