-- T1.9Y: prepare for moving PostGIS from public to the extensions schema.
-- Supabase support will move the extension in place (no drop, data and indexes stay). After the
-- move, PostGIS functions and types (st_*, geography, geometry) live in "extensions". Functions that
-- pin their own search_path to public would no longer find them, so every function in public whose
-- pinned search_path names public but not extensions gets extensions added at the end.
--
-- Safe before and after the move: before the move the extra schema only adds a place to look.
-- Repeatable: functions that already have extensions in their path are skipped.
-- Functions pinned to '' (fully qualified names) and functions without a pinned path are left as
-- they are; the database default search_path already includes extensions.
do $$
declare
  f record;
  current_path text;
  changed integer := 0;
begin
  for f in
    select p.oid,
           p.oid::regprocedure as signature,
           (select substr(c, length('search_path=') + 1)
              from unnest(p.proconfig) as c
             where c like 'search_path=%') as path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    current_path := f.path;
    continue when current_path is null;
    continue when current_path !~* '(^|[\s,"])public($|[\s,"])';
    continue when current_path ~* '(^|[\s,"])extensions($|[\s,"])';
    execute format('alter routine %s set search_path = %s, extensions', f.signature, current_path);
    changed := changed + 1;
  end loop;
  raise notice 'SEARCH_PATH_EXTENSIONS_ADDED: % function(s)', changed;
end
$$;
