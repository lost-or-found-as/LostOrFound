-- T1.9AI: one row per photo analysis, so the server can limit analyses per user per day and
-- follow cost and errors. The photo itself is never stored here; only the outcome.
-- Server only (service role): no client access. Repeatable.
create table if not exists public.image_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  is_guest boolean not null default false,
  status text not null check (status in ('OK', 'UNSURE', 'NO_ITEM', 'FAILED')),
  model text,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  suggestion jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists image_analyses_user_created_idx on public.image_analyses (user_id, created_at desc);

alter table public.image_analyses enable row level security;
revoke all on table public.image_analyses from anon, authenticated;
