-- T1.9AY / T1.9AZ: protection against misuse of public content.
--   reports.hidden_at / hidden_reason   a case hidden after reports from several people (or by
--                                       admin); hidden cases have no share page, poster or
--                                       area-alert view until admin restores them.
--   content_reports                     one row per person (or per anonymous visitor of a share
--                                       page) who reported a case; server only.
--   report_images.moderation_*          T1.9AZ: the photo check. Only photos with status OK are
--                                       shown on the public share page and poster; HELD photos
--                                       are shown to the owner only.
-- Repeatable: every step checks what already exists.
alter table public.reports add column if not exists hidden_at timestamptz;
alter table public.reports add column if not exists hidden_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and conname = 'reports_hidden_reason_check') then
    alter table public.reports add constraint reports_hidden_reason_check
      check (hidden_reason is null or hidden_reason in ('REPORTED', 'ADMIN'));
  end if;
end $$;

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  reporter_key text not null,
  reporter_user_id uuid references auth.users(id) on delete set null,
  source text not null,
  reason text not null,
  comment text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  constraint content_reports_source_check check (source in ('APP', 'SHARE_PAGE')),
  constraint content_reports_reason_check check (reason in ('PERSON', 'HARASSMENT', 'PERSONAL_INFO', 'SPAM', 'OTHER')),
  constraint content_reports_comment_check check (comment is null or char_length(comment) <= 300),
  constraint content_reports_reporter_key_check check (char_length(reporter_key) between 3 and 120)
);
create unique index if not exists content_reports_one_per_reporter on public.content_reports (report_id, reporter_key);
create index if not exists content_reports_open on public.content_reports (report_id) where handled_at is null;

alter table public.content_reports enable row level security;
revoke all on table public.content_reports from anon, authenticated;

alter table public.report_images add column if not exists moderation_status text;
alter table public.report_images add column if not exists moderation_reason text;
alter table public.report_images add column if not exists moderation_checked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.report_images'::regclass and conname = 'report_images_moderation_status_check') then
    alter table public.report_images add constraint report_images_moderation_status_check
      check (moderation_status is null or moderation_status in ('OK', 'HELD'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.report_images'::regclass and conname = 'report_images_moderation_reason_check') then
    alter table public.report_images add constraint report_images_moderation_reason_check
      check (moderation_reason is null or moderation_reason in ('PERSON', 'NUDITY', 'DOCUMENT', 'VIOLENCE', 'OTHER'));
  end if;
end $$;
create index if not exists report_images_unchecked on public.report_images (created_at) where moderation_status is null;
