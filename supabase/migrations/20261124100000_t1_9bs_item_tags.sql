-- T1.9BS: QR tags for things people are afraid to lose (keys, bag, wallet ...).
--   item_tags     one code per tag. The QR code points to /t/<code>. owner_id is null for a code
--                 that is printed but not claimed yet. A paused tag (active = false) takes no
--                 messages.
--   tag_threads   one conversation per finder. The finder has no account: they keep a secret link,
--                 and only a hash of its token is stored.
--   tag_messages  the messages in a thread, from FINDER or OWNER.
-- Server only (RLS on, no policies). Repeatable: every step checks what already exists.

create table if not exists public.item_tags (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  label text,
  kind text not null default 'OTHER',
  active boolean not null default true,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_tags_code_check check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  constraint item_tags_kind_check check (kind in ('KEYS', 'BAG', 'WALLET', 'PHONE', 'BIKE', 'PET', 'OTHER')),
  constraint item_tags_label_check check (label is null or char_length(label) between 1 and 40)
);
create unique index if not exists item_tags_code_unique on public.item_tags (code);
create index if not exists item_tags_owner on public.item_tags (owner_id, created_at desc);
alter table public.item_tags enable row level security;
revoke all on table public.item_tags from anon, authenticated;

create table if not exists public.tag_threads (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.item_tags(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  finder_token_hash text not null,
  visitor_key text,
  status text not null default 'OPEN',
  owner_read_at timestamptz,
  finder_read_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint tag_threads_status_check check (status in ('OPEN', 'CLOSED', 'BLOCKED'))
);
create unique index if not exists tag_threads_token_unique on public.tag_threads (finder_token_hash);
create index if not exists tag_threads_tag on public.tag_threads (tag_id, last_message_at desc);
create index if not exists tag_threads_owner on public.tag_threads (owner_id, last_message_at desc);
create index if not exists tag_threads_visitor on public.tag_threads (visitor_key, created_at desc);
alter table public.tag_threads enable row level security;
revoke all on table public.tag_threads from anon, authenticated;

create table if not exists public.tag_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.tag_threads(id) on delete cascade,
  sender text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint tag_messages_sender_check check (sender in ('FINDER', 'OWNER')),
  constraint tag_messages_body_check check (char_length(body) between 1 and 1000)
);
create index if not exists tag_messages_thread on public.tag_messages (thread_id, created_at);
alter table public.tag_messages enable row level security;
revoke all on table public.tag_messages from anon, authenticated;
