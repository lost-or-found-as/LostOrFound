-- T1.9BV: Sign in with Apple. Apple's refresh token per user, kept only so the server can revoke
-- Apple's access when the account is deleted (Apple requires that). Server only (RLS on, no
-- policies); deleted with the user. Repeatable.
create table if not exists public.apple_sign_in_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apple_sign_in_tokens_token_check check (char_length(refresh_token) between 10 and 2000)
);
alter table public.apple_sign_in_tokens enable row level security;
revoke all on table public.apple_sign_in_tokens from anon, authenticated;
