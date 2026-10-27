-- Baseline objects outside the public schema that `supabase db dump` does not include:
-- the report image bucket, its storage policies and the scheduled jobs.
-- Values copied from production on 2026-10-27. Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-images', 'report-images', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "authenticated can read report-images" on storage.objects;
create policy "authenticated can read report-images"
  on storage.objects for select to authenticated
  using (bucket_id = 'report-images'::text);

drop policy if exists "authenticated can update report-images" on storage.objects;
create policy "authenticated can update report-images"
  on storage.objects for update to authenticated
  using (bucket_id = 'report-images'::text)
  with check (bucket_id = 'report-images'::text);

drop policy if exists "authenticated can upload report-images" on storage.objects;
create policy "authenticated can upload report-images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'report-images'::text);

-- cron.schedule with a job name creates or updates the job.
select cron.schedule('lost-or-found-commerce-expiry', '7,22,37,52 * * * *',
                     'select public.process_commerce_expiry();');
select cron.schedule('lost-or-found-report-lifecycle', '*/15 * * * *',
                     'select public.process_report_lifecycle();');
