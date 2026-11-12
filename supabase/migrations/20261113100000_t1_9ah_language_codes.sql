-- T1.9AH: push_installations.language accepts any language code the app ships
-- (src/i18n/languages.ts: "no", "en", "de", later for example "pt" or "zh-Hans"), so adding a
-- language needs no migration. The server only stores codes it supports (server/lib/languages.js).
-- Repeatable: the constraint is dropped and created again with the same rule.
alter table public.push_installations drop constraint if exists push_installations_language_check;
alter table public.push_installations
  add constraint push_installations_language_check
  check (language ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$');
