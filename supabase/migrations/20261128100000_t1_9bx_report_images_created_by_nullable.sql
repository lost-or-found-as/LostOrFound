-- T1.9BX fix: deleting a sign-in failed with
--   null value in column "created_by" of relation "report_images" violates not-null constraint
-- The foreign key report_images.created_by -> auth.users is ON DELETE SET NULL, but the column
-- was NOT NULL, so any user who still had image rows (for example on an archived case) could not
-- be deleted, neither from the dashboard nor through the in-app account deletion.
-- The image rows belong to the case (report_id cascades); the uploader link may become empty.
-- Repeatable: dropping NOT NULL twice is harmless.

alter table public.report_images alter column created_by drop not null;
