-- T1.9BP: the admin can answer feedback in the app. The answer is stored with the feedback,
-- the sender gets a notification, and sees it under «Dine tilbakemeldinger». Guests cannot get
-- an answer (no account to send it to). Repeatable.
alter table public.app_feedback add column if not exists reply_text text;
alter table public.app_feedback add column if not exists replied_at timestamptz;
alter table public.app_feedback add column if not exists replied_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_feedback_reply_length') then
    alter table public.app_feedback
      add constraint app_feedback_reply_length check (reply_text is null or char_length(reply_text) between 1 and 1000);
  end if;
end $$;
