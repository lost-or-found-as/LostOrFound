-- T1.9AS: bonus for people who help others get their things back.
-- One row per event. Earned rows carry `remaining`; spending takes from the rows that expire first.
-- Awarding is off on the server until HELPER_BONUS_ENABLED=true (terms and privacy text first).

create table if not exists public.helper_bonus_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'FOUND_REGISTERED', 'SIGHTING_USEFUL', 'MATCH_CONFIRMED', 'SIGHTING_RESOLVED', 'RETURN_CONFIRMED',
    'REDEEMED', 'ADJUSTMENT')),
  points integer not null,
  remaining integer not null default 0 check (remaining >= 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'REVOKED')),
  source_type text,
  source_id uuid,
  report_id uuid,
  counterpart_user_id uuid,
  valid_from timestamptz not null default now(),
  expires_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same event for the same source gives bonus once.
create unique index if not exists helper_bonus_ledger_source_uniq
  on public.helper_bonus_ledger (user_id, event_type, source_id)
  where source_id is not null and event_type <> 'REDEEMED';
create index if not exists helper_bonus_ledger_user_idx
  on public.helper_bonus_ledger (user_id, status, expires_at);
create index if not exists helper_bonus_ledger_pending_idx
  on public.helper_bonus_ledger (valid_from) where status = 'PENDING';
create index if not exists helper_bonus_ledger_pair_idx
  on public.helper_bonus_ledger (user_id, counterpart_user_id, event_type, created_at);

alter table public.helper_bonus_ledger enable row level security;
drop policy if exists helper_bonus_ledger_select_own on public.helper_bonus_ledger;
create policy helper_bonus_ledger_select_own on public.helper_bonus_ledger
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.helper_bonus_ledger from anon, authenticated;

-- Spends bonus in one transaction: takes from the earned rows that expire first and records the
-- spending. Not enough bonus raises BONUS_INSUFFICIENT and changes nothing.
create or replace function public.helper_bonus_spend(p_user uuid, p_points integer, p_report uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_left integer := p_points;
  v_take integer;
  v_row record;
  v_id uuid;
begin
  if p_user is null or p_points is null or p_points <= 0 then
    raise exception 'BONUS_INVALID_AMOUNT';
  end if;
  for v_row in
    select id, remaining
    from public.helper_bonus_ledger
    where user_id = p_user and status = 'ACTIVE' and points > 0 and remaining > 0
      and valid_from <= now() and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at
    for update
  loop
    exit when v_left = 0;
    v_take := least(v_left, v_row.remaining);
    update public.helper_bonus_ledger
      set remaining = remaining - v_take, updated_at = now()
      where id = v_row.id;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'BONUS_INSUFFICIENT';
  end if;
  insert into public.helper_bonus_ledger (user_id, event_type, points, remaining, status, report_id, reason)
  values (p_user, 'REDEEMED', -p_points, 0, 'ACTIVE', p_report, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.helper_bonus_spend(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.helper_bonus_spend(uuid, integer, uuid, text) to service_role;
