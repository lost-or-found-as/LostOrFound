-- T1.9A: lock down direct client access (anon key / user JWT through PostgREST, Realtime, Storage).
--
-- The app reads and writes almost everything through the backend, which uses the service role
-- and is not affected by these rules. Direct client access is only needed for:
--   * messages (read, insert, realtime) and the last_message_per_conversation view (chat)
--   * profiles (own row: read, insert, update)
--   * notifications (own rows; kept as is)
-- Everything else is closed for anon and authenticated roles.
--
-- Guests (anonymous sign-in) may only submit a found report, which goes through the backend.
-- They get no direct read access to anything.


-- ---------------------------------------------------------------------------
-- 1. Helpers used inside policies.
-- ---------------------------------------------------------------------------

-- True for a signed-in user that is not an anonymous guest.
create or replace function public.is_registered_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- True when the caller owns the lost or the found report of a confirmed match.
-- SECURITY DEFINER so it can look at matches/reports, which clients can no longer read.
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_registered_user()
     and exists (
       select 1
       from public.matches m
       join public.reports r1 on r1.id = m.lost_id
       join public.reports r2 on r2.id = m.found_id
       where m.id = p_conversation_id
         and m.status = 'CONFIRMED'::public.match_status
         and (r1.user_id = auth.uid() or r2.user_id = auth.uid())
     );
$$;

-- ---------------------------------------------------------------------------
-- 2. Function execution: only the backend (service_role) may call app functions.
--    Applies to every function in public that is not owned by an extension (PostGIS etc.).
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Policies are evaluated with the caller's privileges, so the helpers must stay callable.
grant execute on function public.is_registered_user() to anon, authenticated;
grant execute on function public.is_conversation_participant(uuid) to anon, authenticated;

-- New functions created by postgres in public are no longer executable by clients by default.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Table policies.
-- ---------------------------------------------------------------------------

-- items: legacy table, not used by app or backend. RLS stays on with no policy = closed.
drop policy if exists "Insert items - public" on public.items;
drop policy if exists "Read items - public" on public.items;
drop policy if exists "Update items - public (temporary)" on public.items;

-- reports: owners (registered) read their own; all writes go through the backend.
drop policy if exists "reports_select_all" on public.reports;
drop policy if exists "reports_insert_self" on public.reports;
drop policy if exists "reports_update_owner" on public.reports;
drop policy if exists "reports_select_own_registered" on public.reports;
create policy "reports_select_own_registered" on public.reports
  for select to authenticated
  using (public.is_registered_user() and user_id = auth.uid());

-- profiles: own row only (the app reads, creates and updates its own profile).
drop policy if exists "profiles_read_all" on public.profiles;

-- matches: no direct client access; the backend serves matches.
drop policy if exists "matches_select_all" on public.matches;
drop policy if exists "matches_update_owner" on public.matches;

-- conversations / messages: participants of a confirmed match, registered users only.
drop policy if exists "conversation access via match" on public.conversations;
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select to authenticated
  using (public.is_conversation_participant(id));

drop policy if exists "read messages in own conversation" on public.messages;
drop policy if exists "send message in own conversation" on public.messages;
drop policy if exists "messages_select_participant" on public.messages;
drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (public.is_conversation_participant(conversation_id));
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_participant(conversation_id));

-- report_images: rows are written by the backend; owners (registered) may read their own.
drop policy if exists "report_images_insert" on public.report_images;
drop policy if exists "report_images_delete_own" on public.report_images;
drop policy if exists "report_images_select" on public.report_images;
drop policy if exists "report_images_select_own_registered" on public.report_images;
create policy "report_images_select_own_registered" on public.report_images
  for select to authenticated
  using (public.is_registered_user() and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Storage: images are uploaded and downloaded only through signed URLs issued by the backend.
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated can read report-images" on storage.objects;
drop policy if exists "authenticated can update report-images" on storage.objects;
drop policy if exists "authenticated can upload report-images" on storage.objects;

