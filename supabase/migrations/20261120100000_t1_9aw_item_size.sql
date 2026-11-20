-- T1.9AW: an optional size on a report (clothes, shoes, rings, bike frames, bags and so on),
-- in the owner's or finder's own words, for example "M", "38", "128 cm" or "20 l".
-- Animals never have it. It is shown on the case and in the match comparison, not on the
-- public share page, and it does not change the match score.
-- Repeatable: every step checks what already exists.
alter table public.reports add column if not exists item_size text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_item_size_check') then
    alter table public.reports add constraint reports_item_size_check check (item_size is null or char_length(item_size) between 1 and 30);
  end if;
end $$;
