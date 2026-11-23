-- T1.9BT fix: in-app notifications follow the app's current language.
-- The text keys and their values are stored with each notification, so the list can be written
-- in the language the app asks for. Older rows keep their stored text. Repeatable.
alter table public.notifications add column if not exists title_key text;
alter table public.notifications add column if not exists body_key text;
alter table public.notifications add column if not exists text_params jsonb;
