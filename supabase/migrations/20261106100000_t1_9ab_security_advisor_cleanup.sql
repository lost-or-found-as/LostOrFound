-- T1.9AB: Security Advisor clean-up after the PostGIS move.
-- Repeatable: every step can run again without changing the result.
--
-- 1. Pin search_path on the functions the advisor lists as "role mutable". public holds our
--    tables, extensions holds PostGIS and (after step 2) pg_trgm.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_matches_for_report', 'set_updated_at', 'refresh_matches_for_report',
                         'pgrst_watch', 'set_report_location')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter routine %s set search_path = public, extensions', f.signature);
  end loop;
end
$$;

-- 2. pg_trgm out of public (text similarity in matching and the two trigram indexes). The indexes
--    keep working; functions find similarity() through the search_path set above or the database
--    default, which includes extensions. Skipped with a warning if the extension is not ours to move.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm' and extnamespace = 'public'::regnamespace) then
    begin
      alter extension pg_trgm set schema extensions;
      raise notice 'PG_TRGM_MOVED: extensions';
    exception when insufficient_privilege then
      raise warning 'PG_TRGM_NOT_MOVED: %', sqlerrm;
    end;
  end if;
end
$$;

-- 3. Trigger function: fired by the database only, never called by clients.
revoke execute on function public.refresh_matches_on_identifier_change() from public, anon, authenticated;
grant execute on function public.refresh_matches_on_identifier_change() to service_role;

-- 4. Used by the chat row-level policies for signed-in users; guests without a session never need it.
revoke execute on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated, service_role;
