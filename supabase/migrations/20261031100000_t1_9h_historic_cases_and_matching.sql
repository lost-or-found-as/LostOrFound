-- T1.9H: historic cases (long-term watch) and matching fixes.
-- Repeatable: functions are replaced, catalog rows are only added when missing.
--
-- 1. A LOST case with an active long-term watch is a match candidate at any age. Before, new
--    finds were only compared with lost cases from the last 30 days, so an item lost years ago
--    could never be matched.
-- 2. Main and secondary colour are both compared ("Rød og gul" matches a yellow find).
--    "unknown" never counts as a match or a conflict.
-- 3. Matches keep their first-seen time. The refresh used to delete every NEW match and insert
--    it again, so created_at moved on every refresh. Now kept rows are updated in place and
--    only NEW matches that no longer qualify are removed. The new-match notification trigger
--    (AFTER INSERT) therefore only fires for matches that are really new.
-- 4. Catalog rows for historic cases: 1, 2 or 3 years, each with variants for 0, 1 or 2 paid
--    30-day extensions already bought for the case (the price of those is subtracted).
--    Prices are TEST prices until the store products exist.

-- Helper: does this report have a long-term watch that is running now?
create or replace function public.report_has_long_term_watch(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.long_term_watches w
    where w.report_id = p_report_id
      and w.status in ('ACTIVE', 'GRACE')
      and (w.current_period_end is null or w.current_period_end > now())
  );
$$;

revoke execute on function public.report_has_long_term_watch(uuid) from public, anon, authenticated;
grant execute on function public.report_has_long_term_watch(uuid) to service_role;

-- Helper: do two reports share a colour (main or secondary)? Colour keys, case-insensitive.
create or replace function public.report_colors_overlap(a1 text, a2 text, b1 text, b2 text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select exists (
    select 1
    from unnest(array[lower(a1), lower(a2)]) a(c)
    join unnest(array[lower(b1), lower(b2)]) b(c) on a.c = b.c
    where a.c is not null and a.c <> '' and a.c <> 'unknown'
  );
$$;

revoke execute on function public.report_colors_overlap(text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_colors_overlap(text, text, text, text) to service_role;

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
        (r.type='LOST' and jsonb_array_length(coalesce(r.search_areas,'[]'::jsonb))>0 and public.report_search_area_contains(r.id,o.lat,o.lng))
        or (r.type='FOUND' and jsonb_array_length(coalesce(o.search_areas,'[]'::jsonb))>0 and public.report_search_area_contains(o.id,r.lat,r.lng))
        or (jsonb_array_length(coalesce(case when r.type='LOST' then r.search_areas else o.search_areas end,'[]'::jsonb))=0 and st_dwithin(r.location,o.location,least(p_max_distance_m,coalesce(case when r.type='LOST' then coalesce(r.radius_m,r.search_radius_m,r.area_radius_m,r.location_radius_m) else coalesce(o.radius_m,o.search_radius_m,o.area_radius_m,o.location_radius_m) end,p_max_distance_m))+150))
      )
    order by distance_m nulls last limit p_candidate_limit
  ), scored as (
    select *,within_search_area within_radius,
      (10+case object_level when 3 then 40 when 2 then 28 when 1 then 14 else 0 end
       +case when distance_m<=100 then 25 when distance_m<=250 then 22 when distance_m<=500 then 18 when distance_m<=1000 then 12 when within_search_area then 6 else 0 end
       +case when days_apart<=1 then 15 when days_apart<=3 then 10 when days_apart<=7 then 6 when lost_long_term then 6 else 0 end
       +case when text_sim>=0.5 then 10 when text_sim>=0.3 then 5 else 0 end+color_match*6-color_conflict*6+brand_match*7)::int score,
      jsonb_build_array(
        jsonb_build_object('k','category','v',r.category),jsonb_build_object('k','subcategory_current','v',r.subcategory_key),jsonb_build_object('k','subcategory_other','v',other_subcategory_key),jsonb_build_object('k','object_match_level','v',object_level),jsonb_build_object('k','subcategory_match','v',case when object_level=3 then 1 else 0 end),jsonb_build_object('k','distance_m','v',round(distance_m)::int),jsonb_build_object('k','lost_radius_m','v',coalesce(round(lost_radius_m)::int,null)),jsonb_build_object('k','within_radius','v',within_search_area),jsonb_build_object('k','multi_area','v',jsonb_array_length(coalesce(case when r.type='LOST' then r.search_areas else (select search_areas from public.reports where id=other_id) end,'[]'::jsonb))>0),jsonb_build_object('k','outside_radius_m','v',case when within_search_area then 0 else coalesce(round(distance_m)::int,0) end),jsonb_build_object('k','days_apart','v',round(days_apart,1)),jsonb_build_object('k','text_sim','v',round(text_sim::numeric,2)),jsonb_build_object('k','color_match','v',color_match),jsonb_build_object('k','color_conflict','v',color_conflict),jsonb_build_object('k','brand_match','v',brand_match),jsonb_build_object('k','time_buffer_hours','v',p_time_buffer_hours),jsonb_build_object('k','long_term','v',lost_long_term)
      ) reasons
    from candidates
  )
  , kept as (
    insert into public.matches(lost_id,found_id,score,reasons,status)
    select case when r.type='LOST' then r.id else other_id end,case when r.type='FOUND' then r.id else other_id end,score,reasons,'NEW'::public.match_status
    from scored where score>=p_min_score and within_radius=true
    on conflict(lost_id,found_id) do update set score=excluded.score,reasons=excluded.reasons
    returning id
  )
  -- NEW matches that no longer qualify are removed; kept rows keep their created_at.
  delete from public.matches m
  where (m.lost_id=r.id or m.found_id=r.id) and m.status='NEW' and m.id not in (select id from kept);
end;$$;

-- Editing the secondary colour also refreshes matches (the trigger column list predates it).
drop trigger if exists trg_refresh_matches_on_report on public.reports;
create trigger trg_refresh_matches_on_report
  after insert or update of type, category, subcategory_key, title, description, color, secondary_color, brand, occurred_at, location
  on public.reports
  for each row execute function public.refresh_matches_on_report_change();

-- Historic case products. Test price per year 399 kr; the credit per extension is the current
-- REPORT_REACTIVATION price (99 kr when that row is missing).
with settings as (
  select 39900 as year_price_ore,
         coalesce((select base_price_ore from public.product_catalog where code = 'REPORT_REACTIVATION'), 9900) as extension_price_ore
),
variants as (
  select y as years, c as credits from generate_series(1, 3) y cross join generate_series(0, 2) c
)
insert into public.product_catalog (code, name_no, name_en, product_type, billing_period, duration_count, base_price_ore, currency, active, metadata)
select
  'LONG_TERM_WATCH_' || v.years || 'Y' || case when v.credits > 0 then '_C' || v.credits else '' end,
  'Historisk sak, ' || v.years || ' år' || case when v.credits > 0 then ' (fradrag for ' || v.credits || ' forlengelse' || case when v.credits > 1 then 'r' else '' end || ')' else '' end,
  'Historic case, ' || v.years || ' year' || case when v.years > 1 then 's' else '' end || case when v.credits > 0 then ' (credit for ' || v.credits || ' extension' || case when v.credits > 1 then 's' else '' end || ')' else '' end,
  'ONE_TIME',
  'YEAR',
  v.years,
  greatest(0, v.years * s.year_price_ore - v.credits * s.extension_price_ore),
  'NOK',
  true,
  jsonb_build_object('kind', 'LONG_TERM_WATCH', 'years', v.years, 'credits', v.credits, 'test_price', true)
from variants v cross join settings s
on conflict (code) do nothing;
