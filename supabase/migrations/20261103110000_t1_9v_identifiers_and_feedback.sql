-- T1.9V: private identifiers on reports (frame number, serial number, IMEI, chip number) and
-- feedback from the app. Repeatable: tables and policies are created only when missing, functions
-- are replaced.

-- 1. Identifiers. Only the server (service role) reads and writes them; the other party never sees
--    the value. One identifier per report.
create table if not exists public.report_identifiers (
  report_id uuid primary key references public.reports(id) on delete cascade,
  kind text not null check (kind in ('FRAME_NUMBER','SERIAL_NUMBER','IMEI','CHIP_NUMBER','OTHER')),
  value_normalized text not null check (value_normalized ~ '^[0-9A-ZÆØÅÄÖÜ]{4,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists report_identifiers_value_idx on public.report_identifiers (value_normalized);
alter table public.report_identifiers enable row level security;
revoke all on table public.report_identifiers from anon, authenticated;

-- 1 = same value, -1 = both gave the same kind with different values, 0 = unknown.
create or replace function public.report_identifier_relation(a uuid, b uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select case
      when x.value_normalized = y.value_normalized then 1
      when x.kind = y.kind and x.kind <> 'OTHER' then -1
      else 0
    end
    from public.report_identifiers x
    join public.report_identifiers y on y.report_id = b
    where x.report_id = a
  ), 0);
$$;
revoke execute on function public.report_identifier_relation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.report_identifier_relation(uuid, uuid) to service_role;

-- 2. Matching: a same identifier gives a strong match even outside the search area; a different
--    identifier of the same kind rules the pair out. Otherwise unchanged from T1.9H.
create or replace function public.refresh_matches_for_report(p_report_id uuid, p_candidate_limit integer default 50, p_max_distance_m integer default 3000, p_max_age_days integer default 30, p_min_score integer default 65, p_time_buffer_hours integer default 48)
returns void
language plpgsql
    AS $$
declare r public.reports%rowtype; opposite public.report_type;
begin
  select * into r from public.reports where id=p_report_id;
  if not found then raise exception 'report % not found',p_report_id; end if;
  if coalesce(r.status,'ACTIVE')<>'ACTIVE' or r.closed_at is not null or r.archived_at is not null or r.deleted_at is not null or (r.visible_until is not null and r.visible_until<=now()) then return; end if;
  opposite:=case when r.type='LOST' then 'FOUND' else 'LOST' end;
  with candidates as (
    select o.id other_id,o.subcategory_key other_subcategory_key,
      public.object_compatibility_level(r.subcategory_key,o.subcategory_key) object_level,
      public.report_identifier_relation(r.id,o.id) identifier_relation,
      case
        when r.type='LOST' and jsonb_array_length(coalesce(r.search_areas,'[]'::jsonb))>0 then public.report_search_area_distance_m(r.id,o.lat,o.lng)
        when r.type='FOUND' and jsonb_array_length(coalesce(o.search_areas,'[]'::jsonb))>0 then public.report_search_area_distance_m(o.id,r.lat,r.lng)
        else st_distance(r.location,o.location)
      end distance_m,
      case when r.type='LOST' then coalesce(r.radius_m,r.search_radius_m,r.area_radius_m,r.location_radius_m) else coalesce(o.radius_m,o.search_radius_m,o.area_radius_m,o.location_radius_m) end lost_radius_m,
      case
        when r.type='LOST' and jsonb_array_length(coalesce(r.search_areas,'[]'::jsonb))>0 then public.report_search_area_contains(r.id,o.lat,o.lng)
        when r.type='FOUND' and jsonb_array_length(coalesce(o.search_areas,'[]'::jsonb))>0 then public.report_search_area_contains(o.id,r.lat,r.lng)
        else st_dwithin(r.location,o.location,coalesce(case when r.type='LOST' then coalesce(r.radius_m,r.search_radius_m,r.area_radius_m,r.location_radius_m) else coalesce(o.radius_m,o.search_radius_m,o.area_radius_m,o.location_radius_m) end,p_max_distance_m))
      end within_search_area,
      abs(extract(epoch from (coalesce(case when r.type='LOST' then r.occurred_at else o.occurred_at end,case when r.type='LOST' then r.created_at else o.created_at end,now())-coalesce(case when r.type='LOST' then o.created_at else r.created_at end,now()))))/86400.0 days_apart,
      greatest(similarity(coalesce(r.title,''),coalesce(o.title,'')),similarity(coalesce(r.description,''),coalesce(o.description,''))) text_sim,
      case when public.report_colors_overlap(r.color,r.secondary_color,o.color,o.secondary_color) then 1 else 0 end color_match,
      case when r.color is not null and o.color is not null and lower(r.color)<>'unknown' and lower(o.color)<>'unknown'
             and not public.report_colors_overlap(r.color,r.secondary_color,o.color,o.secondary_color) then 1 else 0 end color_conflict,
      public.report_has_long_term_watch(case when r.type='LOST' then r.id else o.id end) lost_long_term,
      case when r.brand is not null and o.brand is not null and lower(r.brand)=lower(o.brand) then 1 else 0 end brand_match
    from public.reports o
    where o.type=opposite and o.user_id<>r.user_id and coalesce(o.status,'ACTIVE')='ACTIVE' and o.closed_at is null and o.archived_at is null and o.deleted_at is null
      and (o.visible_until is null or o.visible_until>now()) and r.location is not null and o.location is not null
      and public.object_compatibility_level(r.subcategory_key,o.subcategory_key)>0
      and (
        (case when opposite='FOUND' then coalesce(o.created_at,now()) else coalesce(o.occurred_at,o.created_at,now()) end)>=now()-make_interval(days=>p_max_age_days)
        or (opposite='LOST' and public.report_has_long_term_watch(o.id))
      )
      and coalesce(case when r.type='LOST' then r.occurred_at else o.occurred_at end,case when r.type='LOST' then r.created_at else o.created_at end,now())<=coalesce(case when r.type='LOST' then o.created_at else r.created_at end,now())+make_interval(hours=>p_time_buffer_hours)
      and (
        public.report_identifier_relation(r.id,o.id)=1
        or (r.type='LOST' and jsonb_array_length(coalesce(r.search_areas,'[]'::jsonb))>0 and public.report_search_area_contains(r.id,o.lat,o.lng))
        or (r.type='FOUND' and jsonb_array_length(coalesce(o.search_areas,'[]'::jsonb))>0 and public.report_search_area_contains(o.id,r.lat,r.lng))
        or (jsonb_array_length(coalesce(case when r.type='LOST' then r.search_areas else o.search_areas end,'[]'::jsonb))=0 and st_dwithin(r.location,o.location,least(p_max_distance_m,coalesce(case when r.type='LOST' then coalesce(r.radius_m,r.search_radius_m,r.area_radius_m,r.location_radius_m) else coalesce(o.radius_m,o.search_radius_m,o.area_radius_m,o.location_radius_m) end,p_max_distance_m))+150))
      )
    order by (public.report_identifier_relation(r.id,o.id)=1) desc, distance_m nulls last limit p_candidate_limit
  ), scored as (
    select *,(within_search_area or identifier_relation=1) within_radius,
      (10+case object_level when 3 then 40 when 2 then 28 when 1 then 14 else 0 end
       +case when distance_m<=100 then 25 when distance_m<=250 then 22 when distance_m<=500 then 18 when distance_m<=1000 then 12 when within_search_area then 6 else 0 end
       +case when days_apart<=1 then 15 when days_apart<=3 then 10 when days_apart<=7 then 6 when lost_long_term then 6 else 0 end
       +case when text_sim>=0.5 then 10 when text_sim>=0.3 then 5 else 0 end+color_match*6-color_conflict*6+brand_match*7+case when identifier_relation=1 then 40 else 0 end)::int score,
      jsonb_build_array(
        jsonb_build_object('k','identifier_match','v',identifier_relation),jsonb_build_object('k','category','v',r.category),jsonb_build_object('k','subcategory_current','v',r.subcategory_key),jsonb_build_object('k','subcategory_other','v',other_subcategory_key),jsonb_build_object('k','object_match_level','v',object_level),jsonb_build_object('k','subcategory_match','v',case when object_level=3 then 1 else 0 end),jsonb_build_object('k','distance_m','v',round(distance_m)::int),jsonb_build_object('k','lost_radius_m','v',coalesce(round(lost_radius_m)::int,null)),jsonb_build_object('k','within_radius','v',within_search_area),jsonb_build_object('k','multi_area','v',jsonb_array_length(coalesce(case when r.type='LOST' then r.search_areas else (select search_areas from public.reports where id=other_id) end,'[]'::jsonb))>0),jsonb_build_object('k','outside_radius_m','v',case when within_search_area then 0 else coalesce(round(distance_m)::int,0) end),jsonb_build_object('k','days_apart','v',round(days_apart,1)),jsonb_build_object('k','text_sim','v',round(text_sim::numeric,2)),jsonb_build_object('k','color_match','v',color_match),jsonb_build_object('k','color_conflict','v',color_conflict),jsonb_build_object('k','brand_match','v',brand_match),jsonb_build_object('k','time_buffer_hours','v',p_time_buffer_hours),jsonb_build_object('k','long_term','v',lost_long_term)
      ) reasons
    from candidates
  )
  , kept as (
    insert into public.matches(lost_id,found_id,score,reasons,status)
    select case when r.type='LOST' then r.id else other_id end,case when r.type='FOUND' then r.id else other_id end,score,reasons,'NEW'::public.match_status
    from scored where score>=p_min_score and within_radius=true and identifier_relation>=0
    on conflict(lost_id,found_id) do update set score=excluded.score,reasons=excluded.reasons
    returning id
  )
  -- NEW matches that no longer qualify are removed; kept rows keep their created_at.
  delete from public.matches m
  where (m.lost_id=r.id or m.found_id=r.id) and m.status='NEW' and m.id not in (select id from kept);
end;$$;

-- Saving an identifier refreshes the matches of that report.
create or replace function public.refresh_matches_on_identifier_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.refresh_matches_for_report(coalesce(new.report_id, old.report_id));
  return null;
exception when others then
  -- The report may be closed or deleted; the identifier is still saved.
  return null;
end;
$$;

drop trigger if exists trg_refresh_matches_on_identifier on public.report_identifiers;
create trigger trg_refresh_matches_on_identifier
  after insert or update of kind, value_normalized on public.report_identifiers
  for each row execute function public.refresh_matches_on_identifier_change();

-- 3. Feedback from the app. Server only; admins read it through /feedback/admin.
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  is_guest boolean not null default false,
  kind text not null check (kind in ('IDEA','BUG','PRAISE','OTHER')),
  message text not null check (char_length(message) between 3 and 2000),
  app_version text,
  platform text,
  os_version text,
  device_model text,
  language text,
  status text not null default 'NEW' check (status in ('NEW','DONE')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid
);
create index if not exists app_feedback_user_created_idx on public.app_feedback (user_id, created_at desc);
create index if not exists app_feedback_status_created_idx on public.app_feedback (status, created_at desc);
alter table public.app_feedback enable row level security;
revoke all on table public.app_feedback from anon, authenticated;
