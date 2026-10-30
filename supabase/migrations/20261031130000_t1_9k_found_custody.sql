-- T1.9K: where a found item is now. Repeatable: every step checks what already exists.
--   WITH_FINDER    the finder has it (agree on hand-over in the chat)
--   LEFT_AT_PLACE  the finder left it where it was (a hat, a bike, a pet)
--   HANDED_IN      handed in to a shop, the police or a lost-property office; custody_place says where
-- Only FOUND reports use these. Matching still compares the find location with the lost area;
-- custody_place is not used for matching, and the server shows it to the owner only after the
-- match is confirmed.
alter table public.reports add column if not exists custody text;
alter table public.reports add column if not exists custody_place text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_custody_check'
  ) then
    alter table public.reports add constraint reports_custody_check check (
      custody is null or (type = 'FOUND' and custody in ('WITH_FINDER', 'LEFT_AT_PLACE', 'HANDED_IN'))
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_custody_place_check'
  ) then
    alter table public.reports add constraint reports_custody_place_check check (
      custody_place is null or (custody = 'HANDED_IN' and char_length(custody_place) between 2 and 200)
    );
  end if;
end $$;
