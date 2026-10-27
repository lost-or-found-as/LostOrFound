begin;
alter table public.notification_watch_areas add column if not exists source_type text not null default 'SAVED', add column if not exists expires_at timestamptz, add column if not exists location_updated_at timestamptz;
alter table public.notification_watch_areas drop constraint if exists notification_watch_areas_source_type_check;
alter table public.notification_watch_areas add constraint notification_watch_areas_source_type_check check (source_type in ('SAVED','CURRENT_LOCATION'));
create unique index if not exists notification_watch_areas_one_current_location_per_user on public.notification_watch_areas(user_id) where source_type='CURRENT_LOCATION';
create or replace function public.upsert_current_location_watch_area(p_user_id uuid,p_lat double precision,p_lng double precision,p_radius_m integer,p_category_keys text[],p_all_categories boolean,p_push_enabled boolean,p_expiry_hours integer)
returns setof public.notification_watch_areas language plpgsql security definer set search_path='public' as $function$
declare v_expires timestamptz;
begin
 if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
 if p_radius_m not in (1000,3000,5000,10000) then raise exception 'INVALID_RADIUS'; end if;
 if p_expiry_hours not in (0,24,72,168) then raise exception 'INVALID_EXPIRY'; end if;
 v_expires:=case when p_expiry_hours=0 then null else now()+make_interval(hours=>p_expiry_hours) end;
 return query insert into public.notification_watch_areas(user_id,name,area_type,center,radius_m,boundary,category_keys,all_categories,push_enabled,active,source_type,expires_at,location_updated_at)
 values(p_user_id,'Current location','CIRCLE',st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography,p_radius_m,null,coalesce(p_category_keys,'{}'::text[]),coalesce(p_all_categories,true),coalesce(p_push_enabled,true),true,'CURRENT_LOCATION',v_expires,now())
 on conflict (user_id) where source_type='CURRENT_LOCATION' do update set center=excluded.center,radius_m=excluded.radius_m,category_keys=excluded.category_keys,all_categories=excluded.all_categories,push_enabled=excluded.push_enabled,active=true,expires_at=excluded.expires_at,location_updated_at=now(),updated_at=now() returning *;
end;$function$;
drop function if exists public.get_user_watch_areas(uuid);
create or replace function public.get_user_watch_areas(p_user_id uuid)
returns table(id uuid,name text,area_type text,latitude double precision,longitude double precision,radius_m integer,boundary_points jsonb,category_keys text[],all_categories boolean,push_enabled boolean,active boolean,source_type text,expires_at timestamptz,location_updated_at timestamptz,created_at timestamptz,updated_at timestamptz)
language sql security definer set search_path='public' as $function$
 select a.id,a.name,a.area_type,st_y(a.center::geometry),st_x(a.center::geometry),case when a.area_type='CIRCLE' then a.radius_m else null end,
 case when a.boundary is null then '[]'::jsonb else (select jsonb_agg(jsonb_build_object('latitude',st_y((d).geom),'longitude',st_x((d).geom)) order by (d).path) from st_dumppoints(st_exteriorring(a.boundary::geometry)) d where (d).path[array_length((d).path,1)] < st_npoints(st_exteriorring(a.boundary::geometry))) end,
 a.category_keys,a.all_categories,a.push_enabled,a.active,a.source_type,a.expires_at,a.location_updated_at,a.created_at,a.updated_at
 from public.notification_watch_areas a where a.user_id=p_user_id and (a.expires_at is null or a.expires_at>now()) order by case when a.source_type='CURRENT_LOCATION' then 0 else 1 end,a.created_at;
$function$;
revoke all on function public.upsert_current_location_watch_area(uuid,double precision,double precision,integer,text[],boolean,boolean,integer) from public;
grant execute on function public.upsert_current_location_watch_area(uuid,double precision,double precision,integer,text[],boolean,boolean,integer) to service_role;
revoke all on function public.get_user_watch_areas(uuid) from public;
grant execute on function public.get_user_watch_areas(uuid) to service_role;
commit;
