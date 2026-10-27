begin;

-- Ensure new watch areas always receive an identifier.
alter table public.notification_watch_areas
  alter column id set default gen_random_uuid();

-- Keep the limit of three for saved watch areas.
-- The separate current-location area does not count toward this limit.
create or replace function public.enforce_watch_area_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  saved_area_count integer;
begin
  if coalesce(new.source_type, 'SAVED') = 'CURRENT_LOCATION' then
    return new;
  end if;

  select count(*)
  into saved_area_count
  from public.notification_watch_areas
  where user_id = new.user_id
    and coalesce(source_type, 'SAVED') = 'SAVED';

  if saved_area_count >= 3 then
    raise exception 'WATCH_AREA_LIMIT_REACHED'
      using
        errcode = 'P0001',
        detail = 'A user can have a maximum of three saved watch areas.',
        hint = 'Delete or deactivate a saved watch area before creating another one.';
  end if;

  return new;
end;
$function$;

-- Recreate the trigger to ensure that it uses the updated function.
drop trigger if exists trg_watch_area_limit
on public.notification_watch_areas;

create trigger trg_watch_area_limit
before insert on public.notification_watch_areas
for each row
execute function public.enforce_watch_area_limit();

-- Keep exactly one current-location watch area per user.
create unique index if not exists
  notification_watch_areas_one_current_location_per_user
on public.notification_watch_areas (user_id)
where source_type = 'CURRENT_LOCATION';

commit;