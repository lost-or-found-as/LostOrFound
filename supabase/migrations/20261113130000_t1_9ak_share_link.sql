-- T1.9AK: an owner can share a lost report as a public page and a printable poster.
-- share_token is a random code in the link (/s/<token>); null means the report is not shared.
-- The page never shows the owner, the exact place, the chip number or any other identifier.
-- Repeatable: every step checks what already exists.
alter table public.reports add column if not exists share_token text;
alter table public.reports add column if not exists shared_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_share_token_check') then
    alter table public.reports add constraint reports_share_token_check check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{16,40}$');
  end if;
end $$;

create unique index if not exists reports_share_token_key on public.reports (share_token) where share_token is not null;
