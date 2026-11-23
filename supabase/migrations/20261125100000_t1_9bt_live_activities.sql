-- T1.9BT: Live Activities on the lock screen for a lost case.
--   live_activity_tokens  one row per running Live Activity: the APNs token iOS gave for it, the case
--                         it follows, and the language its texts are in. The server pushes updates
--                         when the case gets tips or possible matches, and ends it when the case
--                         closes. last_props_hash stops repeated pushes of the same content.
-- Server only (RLS on, no policies). Repeatable: every step checks what already exists.

create table if not exists public.live_activity_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  activity_id text not null,
  push_token text,
  language text not null default 'no',
  status text not null default 'ACTIVE',
  last_props_hash text,
  last_pushed_at timestamptz,
  failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_activity_tokens_status_check check (status in ('ACTIVE', 'ENDED')),
  constraint live_activity_tokens_activity_check check (char_length(activity_id) between 1 and 200),
  constraint live_activity_tokens_token_check check (push_token is null or push_token ~ '^[0-9a-fA-F]{16,400}$'),
  constraint live_activity_tokens_failures_check check (failures >= 0)
);
create unique index if not exists live_activity_tokens_activity_unique on public.live_activity_tokens (activity_id);
create index if not exists live_activity_tokens_user on public.live_activity_tokens (user_id, status);
create index if not exists live_activity_tokens_report on public.live_activity_tokens (report_id, status);
alter table public.live_activity_tokens enable row level security;
revoke all on table public.live_activity_tokens from anon, authenticated;
