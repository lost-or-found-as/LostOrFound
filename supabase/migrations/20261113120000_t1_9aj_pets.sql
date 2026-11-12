-- T1.9AJ: pets get their own fields on a report (only when the report is an animal):
--   pet_name         the name the animal answers to (shown to others; helps a finder call it)
--   pet_breed        breed or kind in the owner's words
--   pet_temperament  SHY (do not chase, report where it was seen) or CALM (can be called by name)
-- The chip number stays a private identifier in report_identifiers (T1.9V) and is never shown.
-- Repeatable: every step checks what already exists.
alter table public.reports add column if not exists pet_name text;
alter table public.reports add column if not exists pet_breed text;
alter table public.reports add column if not exists pet_temperament text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_pet_name_check') then
    alter table public.reports add constraint reports_pet_name_check check (pet_name is null or char_length(pet_name) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_pet_breed_check') then
    alter table public.reports add constraint reports_pet_breed_check check (pet_breed is null or char_length(pet_breed) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_pet_temperament_check') then
    alter table public.reports add constraint reports_pet_temperament_check check (pet_temperament is null or pet_temperament in ('SHY', 'CALM'));
  end if;
end $$;
