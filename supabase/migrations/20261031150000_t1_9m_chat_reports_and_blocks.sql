-- T1.9M: report and block in chat, automatic account suspension.
--
-- 1. user_blocks: a user blocks another user. Chats between them are closed both ways.
-- 2. chat_reports: a report about a chat, with a copy of the messages at the time of the report.
-- 3. account_suspensions: a suspended account cannot send messages (or create reports and
--    observations; the backend checks that). Three reporters within 30 days suspend an account
--    automatically; an admin can lift it again.
-- 4. Chat messages written directly by the app are checked in the database: no message when the
--    chat is closed, and the T1.9L message limits (30 per minute, 500 per day) also apply here.
--
-- All three tables are written and read by the backend only (RLS on, no client policies).
-- Repeatable: every statement can run again without error.

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

create table if not exists public.account_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'ACTIVE',
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid,
  constraint account_suspensions_status_check check (status in ('ACTIVE', 'LIFTED')),
  constraint account_suspensions_reason_check check (reason in ('AUTO_REPORTS', 'ADMIN'))
);

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  context_type text not null,
  context_id uuid not null,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  details text,
  message_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid,
  constraint chat_reports_context_check check (context_type in ('MATCH', 'OBSERVATION')),
  constraint chat_reports_reason_check check (reason in ('SCAM', 'PERSONAL_DATA', 'HARASSMENT', 'SPAM', 'OTHER')),
  constraint chat_reports_status_check check (status in ('OPEN', 'NO_ACTION', 'ACTION_TAKEN')),
  constraint chat_reports_details_length check (details is null or char_length(details) <= 1000),
  constraint chat_reports_not_self check (reporter_id <> reported_user_id)
);
-- One open report per reporter and reported user; a new report waits until the first is handled.
create unique index if not exists chat_reports_one_open_idx
  on public.chat_reports (reporter_id, reported_user_id) where status = 'OPEN';
create index if not exists chat_reports_reported_idx on public.chat_reports (reported_user_id, status, created_at);
create index if not exists chat_reports_status_idx on public.chat_reports (status, created_at desc);

alter table public.user_blocks enable row level security;
alter table public.account_suspensions enable row level security;
alter table public.chat_reports enable row level security;
revoke all on public.user_blocks, public.account_suspensions, public.chat_reports from anon, authenticated;

-- Message limits count by sender.
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at);

create or replace function public.is_account_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_suspensions s
    where s.user_id = p_user_id and s.status = 'ACTIVE'
  );
$$;

create or replace function public.users_blocked_either_way(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- True when the signed-in user may write a new message in this match chat.
create or replace function public.can_send_chat_message(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with parties as (
    select r1.user_id as lost_user_id, r2.user_id as found_user_id
    from public.matches m
    join public.reports r1 on r1.id = m.lost_id
    join public.reports r2 on r2.id = m.found_id
    where m.id = p_conversation_id
  )
  select exists (select 1 from parties)
     and not exists (
       select 1 from parties p
       where public.users_blocked_either_way(p.lost_user_id, p.found_user_id)
          or public.is_account_suspended(p.lost_user_id)
          or public.is_account_suspended(p.found_user_id)
     )
     and (select count(*) from public.messages x
          where x.sender_id = auth.uid() and x.created_at > now() - interval '1 minute') < 30
     and (select count(*) from public.messages x
          where x.sender_id = auth.uid() and x.created_at > now() - interval '24 hours') < 500;
$$;

revoke execute on function public.is_account_suspended(uuid) from public, anon, authenticated;
revoke execute on function public.users_blocked_either_way(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_send_chat_message(uuid) from public, anon;
grant execute on function public.can_send_chat_message(uuid) to authenticated;
grant execute on function public.is_account_suspended(uuid) to service_role;
grant execute on function public.users_blocked_either_way(uuid, uuid) to service_role;
grant execute on function public.can_send_chat_message(uuid) to service_role;
grant all on public.user_blocks, public.account_suspensions, public.chat_reports to service_role;

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
    and public.can_send_chat_message(conversation_id)
  );
