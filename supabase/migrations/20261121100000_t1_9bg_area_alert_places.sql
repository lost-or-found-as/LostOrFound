-- T1.9BG: an area alert can cover up to three places drawn on the same map as when the case was
-- registered: a place (circle), a route (line with a width on each side) or an area (shape).
--   geo_alert_campaigns.places            the places as drawn (for the owner's own view)
--   geo_alert_places_geography(places)    one shape for all places; overlaps count once
--   geo_alert_places_ewkt(places)         the same shape as EWKT, for storing on the campaign
--   preview_geo_alert_places(...)         area and audience before purchase
-- The campaign stores the joined shape in geometry with radius_m null. The existing recipient
-- functions already use st_dwithin(shape, radius_m or 0), so they work unchanged.
-- Repeatable: every step checks what already exists or replaces itself.
set local search_path = public, extensions;

alter table public.geo_alert_campaigns add column if not exists places jsonb;

create or replace function public.geo_alert_places_geography(p_places jsonb)
returns geography
language sql
immutable
set search_path = public, extensions
as $$
  with place as (
    select upper(coalesce(p->>'kind', '')) as kind,
           coalesce((p->>'radiusMeters')::double precision, 0) as r,
           p->'points' as pts
    from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) as p
  ),
  line as (
    select pl.kind, pl.r, pl.pts,
           case when pl.kind in ('ROUTE', 'POLYGON') then
             (select st_setsrid(st_makeline(array_agg(
                       st_makepoint((pt->>'longitude')::double precision, (pt->>'latitude')::double precision)
                       order by ord)), 4326)
                from jsonb_array_elements(pl.pts) with ordinality as x(pt, ord))
           end as l
    from place pl
  ),
  shaped as (
    select case
             when kind = 'CIRCLE' then
               st_buffer(st_setsrid(st_makepoint((pts->0->>'longitude')::double precision,
                                                 (pts->0->>'latitude')::double precision), 4326)::geography, r)::geometry
             when kind = 'ROUTE' and st_npoints(l) >= 2 then
               st_buffer(l::geography, r)::geometry
             when kind = 'POLYGON' and st_npoints(l) >= 3 then
               st_collectionextract(st_makevalid(st_makepolygon(st_addpoint(l, st_startpoint(l)))), 3)
           end as g
    from line
  )
  select st_multi(st_collectionextract(st_union(g), 3))::geography
  from shaped
  where g is not null and not st_isempty(g)
  having count(*) > 0;
$$;

create or replace function public.geo_alert_places_ewkt(p_places jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select st_asewkt(public.geo_alert_places_geography(p_places)::geometry);
$$;

create or replace function public.preview_geo_alert_places(p_report_id uuid, p_user_id uuid, p_places jsonb)
returns table(report_id uuid, area_sq_km numeric, category_key text, eligible_users integer, eligible_installations integer)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with report_source as (
    select r.id, r.user_id, upper(coalesce(r.category::text, '')) as category_key
    from public.reports r
    where r.id = p_report_id
      and r.user_id = p_user_id
      and r.deleted_at is null
      and upper(r.type::text) = 'LOST'
  ),
  shape as (
    select public.geo_alert_places_geography(p_places) as g
  ),
  users as (
    select q.recipient_user_id, bool_or(q.push_enabled) as push_requested
    from report_source rs
    cross join shape s
    cross join lateral public.geo_alert_qualifying_users(rs.user_id, s.g, 0, rs.category_key) q
    where s.g is not null
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
         round((st_area(s.g) / 1000000.0)::numeric, 4),
         rs.category_key,
         (select count(*) from users)::integer,
         (select count(*) from installs)::integer
  from report_source rs
  cross join shape s
  where s.g is not null;
$$;

revoke all on function public.geo_alert_places_geography(jsonb) from public, anon, authenticated;
revoke all on function public.geo_alert_places_ewkt(jsonb) from public, anon, authenticated;
revoke all on function public.preview_geo_alert_places(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.geo_alert_places_geography(jsonb) to service_role;
grant execute on function public.geo_alert_places_ewkt(jsonb) to service_role;
grant execute on function public.preview_geo_alert_places(uuid, uuid, jsonb) to service_role;
