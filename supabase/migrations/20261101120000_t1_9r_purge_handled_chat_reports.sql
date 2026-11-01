-- T1.9R: chat reports are deleted 12 months after they were handled (as the privacy policy says).
-- Open reports are never deleted. Runs every night at 03:17 (database time, UTC).
-- Repeatable: the function is replaced and the named cron job is created or updated.

create or replace function public.purge_handled_chat_reports()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.chat_reports r
    where r.status <> 'OPEN'
      and r.handled_at is not null
      and r.handled_at < now() - interval '12 months'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function public.purge_handled_chat_reports() from public, anon, authenticated;
grant execute on function public.purge_handled_chat_reports() to service_role;

select cron.schedule('lost-or-found-purge-chat-reports', '17 3 * * *',
                     'select public.purge_handled_chat_reports();');
