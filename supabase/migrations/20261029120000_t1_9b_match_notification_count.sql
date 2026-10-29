-- T1.9B: correct the NEW_MATCH notification count.
--
-- refresh_matches_for_report() deletes the report's NEW matches and inserts them again,
-- and it runs more than once for a new report (database trigger + backend call). The old
-- trigger added 1 per inserted row, so one real match was counted as two ("2 possible
-- matches"), and every recalculation marked the notification unread again.
--
-- Now the notification holds the real number of shown matches (score >= 55, not dismissed)
-- for the lost report, and only becomes unread again when that number goes up.
-- Display text is localized in the app from agg_count; title/body are kept for history.

create or replace function public.notify_new_match_to_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner_user uuid;
  v_existing_id uuid;
  v_existing_read_at timestamptz;
  v_existing_count int;
  v_count int;
begin
  -- Only the top three levels (score >= 55) are shown and notified.
  if new.score is null or new.score < 55 then
    return new;
  end if;

  -- Only the owner of the lost report is notified (anti-abuse).
  select r.user_id into v_owner_user from public.reports r where r.id = new.lost_id;
  if v_owner_user is null then
    return new;
  end if;

  select count(distinct m.found_id)::int into v_count
  from public.matches m
  where m.lost_id = new.lost_id
    and m.score >= 55
    and m.status <> 'DISMISSED'::public.match_status;
  v_count := greatest(v_count, 1);

  select n.id, n.read_at, coalesce(n.agg_count, 1)
    into v_existing_id, v_existing_read_at, v_existing_count
  from public.notifications n
  where n.user_id = v_owner_user
    and n.type = 'NEW_MATCH'
    and n.entity_type = 'report'
    and n.entity_id = new.lost_id
  order by n.created_at desc
  limit 1;

  if v_existing_id is null then
    insert into public.notifications (user_id, type, entity_type, entity_id, title, body, agg_count)
    values (v_owner_user, 'NEW_MATCH', 'report', new.lost_id, 'New match',
            'A possible match was found for your report.', v_count);
  elsif v_count > v_existing_count then
    update public.notifications
    set agg_count = v_count, read_at = null, created_at = now()
    where id = v_existing_id;
  elsif v_count <> v_existing_count then
    -- Fewer matches than before (one dismissed or no longer qualifying): correct the number quietly.
    update public.notifications set agg_count = v_count where id = v_existing_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_new_match_to_notifications() from public, anon, authenticated;
grant execute on function public.notify_new_match_to_notifications() to service_role;

-- Correct counts already stored for unread notifications.
update public.notifications n
set agg_count = greatest(1, (
  select count(distinct m.found_id)::int
  from public.matches m
  where m.lost_id = n.entity_id and m.score >= 55 and m.status <> 'DISMISSED'::public.match_status
))
where n.type = 'NEW_MATCH' and n.entity_type = 'report' and n.read_at is null;
