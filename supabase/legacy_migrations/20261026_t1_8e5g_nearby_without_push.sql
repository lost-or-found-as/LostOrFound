begin;

create or replace function public.geo_alert_eligible_users(p_campaign_id uuid)
returns table(
  campaign_id uuid,
  recipient_user_id uuid,
  watch_area_id uuid,
  report_id uuid,
  report_title text,
  category_key text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with campaign as (
    select c.id, c.report_id, c.geometry, c.radius_m,
           r.user_id as report_owner_id, r.title as report_title,
           upper(coalesce(r.category::text, '')) as category_key
    from public.geo_alert_campaigns c
    join public.reports r on r.id = c.report_id
    where c.id = p_campaign_id
      and upper(c.status::text) = 'ACTIVE'
      and coalesce(c.ends_at, now() + interval '1 minute') > now()
      and r.deleted_at is null
      and upper(r.status::text) = 'ACTIVE'
      and upper(r.type::text) = 'LOST'
  )
  select distinct on (wa.user_id)
    c.id, wa.user_id, wa.id, c.report_id, c.report_title, c.category_key
  from campaign c
  join public.notification_watch_areas wa
    on wa.active = true
   and wa.user_id <> c.report_owner_id
   and (wa.all_categories = true or c.category_key = any(coalesce(wa.category_keys, '{}'::text[])))
   and case
     when c.geometry is null then false
     when wa.area_type = 'POLYGON' then st_dwithin(wa.boundary, c.geometry, coalesce(c.radius_m, 0))
     else st_dwithin(wa.center, c.geometry, wa.radius_m + coalesce(c.radius_m, 0))
   end
  order by wa.user_id, wa.updated_at desc, wa.id;
$function$;

revoke all on function public.geo_alert_eligible_users(uuid) from public;
grant execute on function public.geo_alert_eligible_users(uuid) to service_role;

commit;
