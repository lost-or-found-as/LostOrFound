begin;
create or replace function public.upsert_current_location_watch_area_v2(p_user_id uuid,p_lat double precision,p_lng double precision,p_radius_m integer,p_category_keys text[],p_all_categories boolean,p_push_enabled boolean,p_expiry_hours integer)
returns setof public.notification_watch_areas language plpgsql security definer set search_path='public' as $function$
declare v_expires timestamptz; v_id uuid;
begin
 if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
 if p_radius_m not in (1000,3000,5000,10000) then raise exception 'INVALID_RADIUS'; end if;
 if p_expiry_hours not in (0,24,72,168) then raise exception 'INVALID_EXPIRY'; end if;
 v_expires:=case when p_expiry_hours=0 then null else now()+make_interval(hours=>p_expiry_hours) end;
 select id into v_id from public.notification_watch_areas where user_id=p_user_id and source_type='CURRENT_LOCATION' limit 1;
 if v_id is null then
  insert into public.notification_watch_areas(user_id,name,area_type,center,radius_m,boundary,category_keys,all_categories,push_enabled,active,source_type,expires_at,location_updated_at)
  values(p_user_id,'Current location','CIRCLE',st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography,p_radius_m,null,coalesce(p_category_keys,'{}'::text[]),coalesce(p_all_categories,true),coalesce(p_push_enabled,true),true,'CURRENT_LOCATION',v_expires,now()) returning id into v_id;
 else
  update public.notification_watch_areas set center=st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography,radius_m=p_radius_m,boundary=null,category_keys=coalesce(p_category_keys,'{}'::text[]),all_categories=coalesce(p_all_categories,true),push_enabled=coalesce(p_push_enabled,true),active=true,expires_at=v_expires,location_updated_at=now(),updated_at=now() where id=v_id;
 end if;
 return query select * from public.notification_watch_areas where id=v_id;
end;$function$;
revoke all on function public.upsert_current_location_watch_area_v2(uuid,double precision,double precision,integer,text[],boolean,boolean,integer) from public;
grant execute on function public.upsert_current_location_watch_area_v2(uuid,double precision,double precision,integer,text[],boolean,boolean,integer) to service_role;
commit;
