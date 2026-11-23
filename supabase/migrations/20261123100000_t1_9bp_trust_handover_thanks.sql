-- T1.9BP: trust between owner and helper.
--   control_questions   the helper asks a question only the owner can answer; the owner gets
--                       up to three tries per question, and the helper may ask up to three
--                       questions per chat. While a question is open or did not match, the
--                       hand-in place stays hidden from the owner.
--   handover_codes      a four-digit code the owner shows when they meet; the helper types it in
--                       and the case is marked returned. Wrong tries are counted and locked for a
--                       while after five.
--   thank_you_cards     one card from the owner to the helper after a solved case.
-- Context: MATCH (matches.id) or OBSERVATION (area_alert_observations.id). Server only (RLS on,
-- no policies). Repeatable: every step checks what already exists.

create table if not exists public.control_questions (
  id uuid primary key default gen_random_uuid(),
  context_type text not null,
  context_id uuid not null,
  asked_by uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text,
  status text not null default 'ASKED',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_questions_context_check check (context_type in ('MATCH', 'OBSERVATION')),
  constraint control_questions_status_check check (status in ('ASKED', 'ANSWERED', 'CONFIRMED', 'NO_MATCH')),
  constraint control_questions_question_check check (char_length(question) between 3 and 140),
  constraint control_questions_answer_check check (answer is null or char_length(answer) between 1 and 140),
  constraint control_questions_attempts_check check (attempts between 0 and 3)
);
create index if not exists control_questions_context on public.control_questions (context_type, context_id, created_at desc);
alter table public.control_questions enable row level security;
revoke all on table public.control_questions from anon, authenticated;

create table if not exists public.handover_codes (
  context_type text not null,
  context_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (context_type, context_id),
  constraint handover_codes_context_check check (context_type in ('MATCH', 'OBSERVATION')),
  constraint handover_codes_code_check check (code ~ '^[0-9]{4}$')
);
alter table public.handover_codes enable row level security;
revoke all on table public.handover_codes from anon, authenticated;

create table if not exists public.thank_you_cards (
  id uuid primary key default gen_random_uuid(),
  context_type text not null,
  context_id uuid not null,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  design text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint thank_you_cards_context_check check (context_type in ('MATCH', 'OBSERVATION')),
  constraint thank_you_cards_design_check check (design in ('HEART', 'SUN', 'STAR')),
  constraint thank_you_cards_message_check check (char_length(message) between 1 and 140)
);
create unique index if not exists thank_you_cards_one_per_context on public.thank_you_cards (context_type, context_id, from_user);
create index if not exists thank_you_cards_to_user on public.thank_you_cards (to_user, created_at desc);
alter table public.thank_you_cards enable row level security;
revoke all on table public.thank_you_cards from anon, authenticated;
