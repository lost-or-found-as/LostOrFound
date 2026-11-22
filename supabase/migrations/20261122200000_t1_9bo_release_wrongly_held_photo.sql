-- T1.9BO: the first T1.9BO server (deployed 22.11.2026 around 22:55 Oslo time) held a photo
-- whose download failed with «Bucket not found», even when the file was still there. Such a
-- photo goes back to «not checked yet», so the photo check looks at it again.
-- Only photos held in that window whose file still exists are touched. Running this again
-- changes nothing.
update public.report_images ri
set moderation_status = null,
    moderation_reason = null,
    moderation_checked_at = null
where ri.moderation_status = 'HELD'
  and ri.moderation_reason = 'OTHER'
  and ri.moderation_checked_at >= timestamptz '2026-11-22 21:30:00+00'
  and ri.moderation_checked_at <  timestamptz '2026-11-22 22:30:00+00'
  and exists (
    select 1
    from storage.objects o
    where o.bucket_id = split_part(ri.path, '/', 1)
      and o.name = substr(ri.path, length(split_part(ri.path, '/', 1)) + 2)
  );
