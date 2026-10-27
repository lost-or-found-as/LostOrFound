begin;

create or replace function public.create_user_watch_area_v2(
  p_user_id uuid,
  p_name text,
  p_area_type text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_boundary_points jsonb,
  p_category_keys text[],
  p_all_categories boolean,
  p_push_enabled boolean
)
returns setof public.notification_watch_areas
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area_type text := upper(coalesce(nullif(trim(p_area_type), ''), 'CIRCLE'));
  v_center geography(Point, 4326);
  v_boundary geography(Polygon, 4326);
  v_radius_m integer;
  v_point_count integer;
begin
  if v_area_type not in ('CIRCLE', 'POLYGON') then
    raise exception 'INVALID_AREA_TYPE';
  end if;

  if v_area_type = 'CIRCLE' then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
      raise exception 'INVALID_COORDINATES';
    end if;
    if p_radius_m is null or p_radius_m <= 0 or p_radius_m > 50000 then
      raise exception 'INVALID_RADIUS';
    end if;
    v_center := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
    v_radius_m := p_radius_m;
  else
    if p_boundary_points is null or jsonb_typeof(p_boundary_points) <> 'array' then
      raise exception 'INVALID_BOUNDARY';
    end if;
    v_point_count := jsonb_array_length(p_boundary_points);
    if v_point_count < 3 or v_point_count > 100 then
      raise exception 'INVALID_BOUNDARY';
    end if;

    -- Use an explicit JSONB value alias. The previous function treated the
    -- table alias as a record when applying JSONB operators at runtime.
    if exists (
      select 1
      from jsonb_array_elements(p_boundary_points) as point_data(value)
      where not (point_data.value ? 'latitude')
         or not (point_data.value ? 'longitude')
         or jsonb_typeof(point_data.value->'latitude') <> 'number'
         or jsonb_typeof(point_data.value->'longitude') <> 'number'
         or (point_data.value->>'latitude')::double precision not between -90 and 90
         or (point_data.value->>'longitude')::double precision not between -180 and 180
    ) then
      raise exception 'INVALID_BOUNDARY_COORDINATES';
    end if;

    select st_makepolygon(st_makeline(array_agg(ordered.geom order by ordered.position)))::geography
      into v_boundary
    from (
      select point_data.position,
             st_setsrid(st_makepoint(
               (point_data.value->>'longitude')::double precision,
               (point_data.value->>'latitude')::double precision
             ), 4326) as geom
      from jsonb_array_elements(p_boundary_points)
        with ordinality as point_data(value, position)
      union all
      select v_point_count + 1,
             st_setsrid(st_makepoint(
               (p_boundary_points->0->>'longitude')::double precision,
               (p_boundary_points->0->>'latitude')::double precision
             ), 4326)
    ) as ordered;

    if v_boundary is null
       or not st_isvalid(v_boundary::geometry)
       or st_isempty(v_boundary::geometry)
       or st_area(v_boundary) <= 0 then
      raise exception 'INVALID_BOUNDARY';
    end if;

    v_center := st_centroid(v_boundary::geometry)::geography;
    v_radius_m := 1;
  end if;

  return query
  insert into public.notification_watch_areas(
    user_id, name, area_type, center, radius_m, boundary,
    category_keys, all_categories, push_enabled
  ) values (
    p_user_id, left(trim(p_name), 80), v_area_type, v_center,
    v_radius_m, v_boundary, coalesce(p_category_keys, '{}'::text[]),
    coalesce(p_all_categories, true), coalesce(p_push_enabled, true)
  ) returning *;
end;
$function$;

revoke all on function public.create_user_watch_area_v2(
  uuid, text, text, double precision, double precision, integer,
  jsonb, text[], boolean, boolean
) from public;

grant execute on function public.create_user_watch_area_v2(
  uuid, text, text, double precision, double precision, integer,
  jsonb, text[], boolean, boolean
) to service_role;



create or replace function public.update_user_watch_area_v2(
  p_user_id uuid,
  p_area_id uuid,
  p_name text,
  p_area_type text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_boundary_points jsonb,
  p_category_keys text[],
  p_all_categories boolean,
  p_push_enabled boolean
)
returns setof public.notification_watch_areas
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area_type text := upper(coalesce(nullif(trim(p_area_type), ''), 'CIRCLE'));
  v_center geography(Point, 4326);
  v_boundary geography(Polygon, 4326);
  v_radius_m integer;
  v_point_count integer;
begin
  if not exists (select 1 from public.notification_watch_areas where id = p_area_id and user_id = p_user_id) then
    return;
  end if;
  if v_area_type not in ('CIRCLE', 'POLYGON') then raise exception 'INVALID_AREA_TYPE'; end if;

  if v_area_type = 'CIRCLE' then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
    if p_radius_m is null or p_radius_m <= 0 or p_radius_m > 50000 then raise exception 'INVALID_RADIUS'; end if;
    v_center := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
    v_radius_m := p_radius_m;
    v_boundary := null;
  else
    if p_boundary_points is null or jsonb_typeof(p_boundary_points) <> 'array' then raise exception 'INVALID_BOUNDARY'; end if;
    v_point_count := jsonb_array_length(p_boundary_points);
    if v_point_count < 3 or v_point_count > 100 then raise exception 'INVALID_BOUNDARY'; end if;
    if exists (
      select 1 from jsonb_array_elements(p_boundary_points) as point_data(value)
      where not (point_data.value ? 'latitude') or not (point_data.value ? 'longitude')
         or jsonb_typeof(point_data.value->'latitude') <> 'number'
         or jsonb_typeof(point_data.value->'longitude') <> 'number'
         or (point_data.value->>'latitude')::double precision not between -90 and 90
         or (point_data.value->>'longitude')::double precision not between -180 and 180
    ) then raise exception 'INVALID_BOUNDARY_COORDINATES'; end if;
    select st_makepolygon(st_makeline(array_agg(ordered.geom order by ordered.position)))::geography into v_boundary
    from (
      select point_data.position, st_setsrid(st_makepoint((point_data.value->>'longitude')::double precision,(point_data.value->>'latitude')::double precision),4326) geom
      from jsonb_array_elements(p_boundary_points) with ordinality as point_data(value, position)
      union all
      select v_point_count + 1, st_setsrid(st_makepoint((p_boundary_points->0->>'longitude')::double precision,(p_boundary_points->0->>'latitude')::double precision),4326)
    ) ordered;
    if v_boundary is null or not st_isvalid(v_boundary::geometry) or st_isempty(v_boundary::geometry) or st_area(v_boundary) <= 0 then raise exception 'INVALID_BOUNDARY'; end if;
    v_center := st_centroid(v_boundary::geometry)::geography;
    v_radius_m := 1;
  end if;

  return query update public.notification_watch_areas set
    name = left(trim(p_name), 80), area_type = v_area_type, center = v_center,
    radius_m = v_radius_m, boundary = v_boundary,
    category_keys = coalesce(p_category_keys, '{}'::text[]),
    all_categories = coalesce(p_all_categories, true),
    push_enabled = coalesce(p_push_enabled, true), updated_at = now()
  where id = p_area_id and user_id = p_user_id returning *;
end;
$function$;

revoke all on function public.update_user_watch_area_v2(uuid,uuid,text,text,double precision,double precision,integer,jsonb,text[],boolean,boolean) from public;
grant execute on function public.update_user_watch_area_v2(uuid,uuid,text,text,double precision,double precision,integer,jsonb,text[],boolean,boolean) to service_role;

commit;
