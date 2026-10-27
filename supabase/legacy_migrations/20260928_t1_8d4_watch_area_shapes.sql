begin;

alter table public.notification_watch_areas
  add column if not exists area_type text not null default 'CIRCLE',
  add column if not exists boundary geography(Polygon,4326);

alter table public.notification_watch_areas drop constraint if exists notification_watch_areas_area_type_check;
alter table public.notification_watch_areas add constraint notification_watch_areas_area_type_check check (area_type in ('CIRCLE','POLYGON'));
alter table public.notification_watch_areas drop constraint if exists notification_watch_areas_geometry_check;
alter table public.notification_watch_areas add constraint notification_watch_areas_geometry_check check (
  (area_type='CIRCLE' and center is not null and radius_m is not null and radius_m>0 and boundary is null)
  or (area_type='POLYGON' and boundary is not null)
);
create index if not exists notification_watch_areas_boundary_gix on public.notification_watch_areas using gist(boundary);

create or replace function public.create_user_watch_area_v2(p_user_id uuid,p_name text,p_area_type text,p_lat double precision,p_lng double precision,p_radius_m integer,p_boundary_points jsonb,p_category_keys text[],p_all_categories boolean,p_push_enabled boolean)
returns setof public.notification_watch_areas language plpgsql security definer set search_path to 'public' as $function$
declare v_type text:=upper(coalesce(p_area_type,'CIRCLE'));v_boundary geography(Polygon,4326);v_center geography(Point,4326);v_radius integer;
begin
 if v_type not in ('CIRCLE','POLYGON') then raise exception 'INVALID_AREA_TYPE'; end if;
 if v_type='CIRCLE' then
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
  if p_radius_m is null or p_radius_m<=0 or p_radius_m>50000 then raise exception 'INVALID_RADIUS'; end if;
  v_center:=st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography;v_radius:=p_radius_m;
 else
  if jsonb_typeof(p_boundary_points)<>'array' or jsonb_array_length(p_boundary_points)<3 or jsonb_array_length(p_boundary_points)>100 then raise exception 'INVALID_BOUNDARY'; end if;
  select st_makepolygon(st_makeline(array_agg(pt order by ord)))::geography into v_boundary from (
   select ord,st_setsrid(st_makepoint((value->>'longitude')::double precision,(value->>'latitude')::double precision),4326) pt from jsonb_array_elements(p_boundary_points) with ordinality e(value,ord)
   union all select 1000000,st_setsrid(st_makepoint((p_boundary_points->0->>'longitude')::double precision,(p_boundary_points->0->>'latitude')::double precision),4326)
  ) q;
  if v_boundary is null or not st_isvalid(v_boundary::geometry) then raise exception 'INVALID_BOUNDARY'; end if;
  v_center:=st_centroid(v_boundary::geometry)::geography;v_radius:=1;
 end if;
 return query insert into public.notification_watch_areas(user_id,name,area_type,center,radius_m,boundary,category_keys,all_categories,push_enabled)
 values(p_user_id,left(trim(p_name),80),v_type,v_center,v_radius,v_boundary,coalesce(p_category_keys,'{}'::text[]),p_all_categories,p_push_enabled) returning *;
end;$function$;

drop function if exists public.get_user_watch_areas(uuid);

create function public.get_user_watch_areas(p_user_id uuid)
returns table(id uuid,name text,area_type text,latitude double precision,longitude double precision,radius_m integer,boundary_points jsonb,category_keys text[],all_categories boolean,push_enabled boolean,active boolean,created_at timestamptz,updated_at timestamptz)
language sql security definer set search_path to 'public' as $function$
 select a.id,a.name,a.area_type,st_y(a.center::geometry),st_x(a.center::geometry),case when a.area_type='CIRCLE' then a.radius_m else null end,
 case when a.boundary is null then '[]'::jsonb else (select jsonb_agg(jsonb_build_object('latitude',st_y((d).geom),'longitude',st_x((d).geom)) order by (d).path) from st_dumppoints(st_exteriorring(a.boundary::geometry)) d where (d).path[array_length((d).path,1)] < st_npoints(st_exteriorring(a.boundary::geometry))) end,
 a.category_keys,a.all_categories,a.push_enabled,a.active,a.created_at,a.updated_at from public.notification_watch_areas a where a.user_id=p_user_id order by a.created_at;
$function$;

create or replace function public.geo_alert_eligible_installations(p_campaign_id uuid)
returns table(campaign_id uuid,recipient_user_id uuid,installation_id text,expo_push_token text,language text,watch_area_id uuid,report_id uuid,report_title text,category_key text)
language sql stable security definer set search_path to 'public' as $function$
 with campaign as (select c.id,c.user_id,c.report_id,c.status,c.geometry,c.radius_m,c.ends_at,r.user_id report_owner_id,r.title report_title,upper(coalesce(r.category::text,'')) category_key from public.geo_alert_campaigns c join public.reports r on r.id=c.report_id where c.id=p_campaign_id and upper(c.status::text)='ACTIVE' and coalesce(c.ends_at,now()+interval '1 minute')>now() and r.deleted_at is null and upper(r.status::text)='ACTIVE' and upper(r.type::text)='LOST'),
 candidates as (select distinct on(pi.installation_id) c.id,wa.user_id,pi.installation_id,pi.expo_push_token,pi.language,wa.id,c.report_id,c.report_title,c.category_key from campaign c join public.notification_watch_areas wa on wa.active=true and wa.push_enabled=true and wa.user_id<>c.report_owner_id and (wa.all_categories=true or c.category_key=any(coalesce(wa.category_keys,'{}'::text[]))) and case when c.geometry is null then false when wa.area_type='POLYGON' then st_dwithin(wa.boundary,c.geometry,coalesce(c.radius_m,0)) else st_dwithin(wa.center,c.geometry,wa.radius_m+coalesce(c.radius_m,0)) end join public.push_installations pi on pi.user_id=wa.user_id and pi.active=true and pi.permission_status='granted' order by pi.installation_id,wa.updated_at desc,wa.id)
 select * from candidates;
$function$;

revoke all on function public.create_user_watch_area_v2(uuid,text,text,double precision,double precision,integer,jsonb,text[],boolean,boolean) from public;
grant execute on function public.create_user_watch_area_v2(uuid,text,text,double precision,double precision,integer,jsonb,text[],boolean,boolean) to service_role;

revoke all on function public.get_user_watch_areas(uuid) from public;
grant execute on function public.get_user_watch_areas(uuid) to service_role;

revoke all on function public.geo_alert_eligible_installations(uuid) from public;
grant execute on function public.geo_alert_eligible_installations(uuid) to service_role;

commit;
