-- T1.9F: secondary colour as its own column, and read receipts for match chats.
-- Repeatable: every step checks what already exists.

-- 1. reports.secondary_color
-- Until now the secondary colour was a text line at the end of the description
-- ("Secondary color: Yellow" / "Tilleggsfarge: Gul") in the reporter's language, so matching
-- could not compare it with colour keys. It now has a column holding the colour key.
alter table public.reports add column if not exists secondary_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_secondary_color_key'
  ) then
    alter table public.reports add constraint reports_secondary_color_key check (
      secondary_color is null or secondary_color in (
        'black','white','gray','red','orange','yellow','green','blue','purple','brown','pink',
        'beige','navy','light-blue','turquoise','burgundy','lime','cyan','magenta','olive',
        'gold','silver','bronze','camo','multicolor','patterned','unknown','other'
      )
    );
  end if;
end $$;

-- Fill the column from existing description lines. Descriptions are left as they are; the app
-- hides the old line when it shows a description.
with names(name, color_key) as (
  values
    ('black', 'black'), ('svart', 'black'),
    ('white', 'white'), ('hvit', 'white'),
    ('gray', 'gray'), ('grey', 'gray'), ('grå', 'gray'),
    ('red', 'red'), ('rød', 'red'),
    ('orange', 'orange'), ('oransje', 'orange'),
    ('yellow', 'yellow'), ('gul', 'yellow'),
    ('green', 'green'), ('grønn', 'green'),
    ('blue', 'blue'), ('blå', 'blue'),
    ('purple', 'purple'), ('lilla', 'purple'),
    ('brown', 'brown'), ('brun', 'brown'),
    ('pink', 'pink'), ('rosa', 'pink'),
    ('beige', 'beige'),
    ('navy', 'navy'), ('mørkeblå', 'navy'), ('mørkeblå (navy)', 'navy'), ('dark blue (navy)', 'navy'),
    ('light-blue', 'light-blue'), ('light blue', 'light-blue'), ('lyseblå', 'light-blue'),
    ('turquoise', 'turquoise'), ('turkis', 'turquoise'),
    ('burgundy', 'burgundy'), ('burgunder', 'burgundy'),
    ('lime', 'lime'),
    ('cyan', 'cyan'),
    ('magenta', 'magenta'),
    ('olive', 'olive'), ('oliven', 'olive'),
    ('gold', 'gold'), ('gull', 'gold'),
    ('silver', 'silver'), ('sølv', 'silver'),
    ('bronze', 'bronze'), ('bronse', 'bronze'),
    ('camo', 'camo'), ('camouflage', 'camo'), ('kamuflasje', 'camo'),
    ('camo / kamuflasje', 'camo'), ('camo / camouflage', 'camo'),
    ('multicolor', 'multicolor'), ('flerfarget', 'multicolor'),
    ('patterned', 'patterned'), ('mønstret', 'patterned'),
    ('unknown', 'unknown'), ('usikker', 'unknown'), ('not sure', 'unknown'),
    ('other', 'other'), ('annet', 'other')
),
parsed as (
  select r.id,
         lower(btrim((regexp_match(r.description, '(?:secondary colou?r|tilleggsfarge)[ \t]*:[ \t]*([^\n\r]+)', 'i'))[1])) as name
  from public.reports r
  where r.secondary_color is null
    and r.description ~* '(secondary colou?r|tilleggsfarge)[ \t]*:'
)
update public.reports r
set secondary_color = n.color_key
from parsed p
join names n on n.name = p.name
where r.id = p.id
  and r.secondary_color is null;

-- 2. conversation_reads: when each participant last read a match chat ("Lest").
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_reads enable row level security;

revoke all on table public.conversation_reads from anon;
revoke all on table public.conversation_reads from authenticated;
grant select, insert, update on table public.conversation_reads to authenticated;
grant all on table public.conversation_reads to service_role;

drop policy if exists "conversation_reads_select_participant" on public.conversation_reads;
create policy "conversation_reads_select_participant" on public.conversation_reads
  for select to authenticated
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "conversation_reads_insert_own" on public.conversation_reads;
create policy "conversation_reads_insert_own" on public.conversation_reads
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_conversation_participant(conversation_id));

drop policy if exists "conversation_reads_update_own" on public.conversation_reads;
create policy "conversation_reads_update_own" on public.conversation_reads
  for update to authenticated
  using (user_id = auth.uid() and public.is_conversation_participant(conversation_id))
  with check (user_id = auth.uid() and public.is_conversation_participant(conversation_id));

-- 3. Live updates in the chat: new messages and read receipts reach the open chat screen.
-- Row level security still decides who receives each change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_reads'
    ) then
      alter publication supabase_realtime add table public.conversation_reads;
    end if;
  end if;
end $$;
