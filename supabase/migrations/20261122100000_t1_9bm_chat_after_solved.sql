-- T1.9BM: a match chat about a solved case can be answered for 7 days after the case was closed;
-- after that it can be read but not answered. The app hides the composer; this trigger makes the
-- rule hold even if the app is old or bypassed. Observation chats are checked in the server route.
-- Repeatable: the function replaces itself and the trigger is created only if missing.
create or replace function public.messages_block_after_solved()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_closed timestamptz;
begin
  select least(
           case when upper(coalesce(l.status::text, '')) = 'CLOSED' or l.closed_at is not null then coalesce(l.closed_at, now()) end,
           case when upper(coalesce(f.status::text, '')) = 'CLOSED' or f.closed_at is not null then coalesce(f.closed_at, now()) end
         )
    into v_closed
    from public.matches m
    left join public.reports l on l.id = m.lost_id
    left join public.reports f on f.id = m.found_id
   where m.id = new.conversation_id;
  if v_closed is not null and v_closed < now() - interval '7 days' then
    raise exception 'CHAT_CLOSED_AFTER_SOLVED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.messages_block_after_solved() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_messages_block_after_solved' and tgrelid = 'public.messages'::regclass) then
    create trigger trg_messages_block_after_solved
      before insert on public.messages
      for each row execute function public.messages_block_after_solved();
  end if;
end;
$$;
