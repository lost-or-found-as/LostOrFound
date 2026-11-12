"use strict";
// T1.9AC: first photo of each report as a short-lived signed URL, for the cards in "Mine saker".
// One query for the image rows and one signing call per bucket, however many reports there are.
const THUMBNAIL_TTL_SECONDS = 60 * 60;

// "report-images/reports/<id>/<file>" -> { bucket: "report-images", objectPath: "reports/<id>/<file>" }
function splitImagePath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  const bucket = parts.shift();
  const objectPath = parts.join("/");
  return bucket && objectPath ? { bucket, objectPath } : null;
}

// rows: [{ report_id, path, sort_order, id }] -> Map(report_id -> path of its first image)
function firstImagePathByReport(rows) {
  const best = new Map();
  for (const row of rows || []) {
    const current = best.get(row.report_id);
    const order = Number(row.sort_order) || 0;
    const id = Number(row.id) || 0;
    if (!current || order < current.order || (order === current.order && id < current.id))
      best.set(row.report_id, { path: row.path, order, id });
  }
  return new Map([...best].map(([reportId, v]) => [reportId, v.path]));
}

/** Map(report_id -> signed URL). A failure only means no thumbnails; the list still loads. */
async function loadThumbnailUrls(supaAdmin, reportIds) {
  const urls = new Map();
  if (!reportIds.length) return urls;
  try {
    const { data, error } = await supaAdmin
      .from("report_images")
      .select("id, report_id, path, sort_order")
      .in("report_id", reportIds);
    if (error) throw error;
    const firstPaths = firstImagePathByReport(data);
    const byBucket = new Map();
    for (const [reportId, path] of firstPaths) {
      const split = splitImagePath(path);
      if (!split) continue;
      const list = byBucket.get(split.bucket) || [];
      list.push({ reportId, objectPath: split.objectPath });
      byBucket.set(split.bucket, list);
    }
    for (const [bucket, items] of byBucket) {
      const { data: signed, error: signError } = await supaAdmin.storage
        .from(bucket)
        .createSignedUrls(items.map((i) => i.objectPath), THUMBNAIL_TTL_SECONDS);
      if (signError) throw signError;
      const byPath = new Map((signed || []).filter((s) => s?.signedUrl && !s.error).map((s) => [s.path, s.signedUrl]));
      for (const item of items) {
        const url = byPath.get(item.objectPath);
        if (url) urls.set(item.reportId, url);
      }
    }
  } catch (e) {
    console.warn("[reports] thumbnails failed", e?.message || e);
  }
  return urls;
}

module.exports = { loadThumbnailUrls, firstImagePathByReport, splitImagePath, THUMBNAIL_TTL_SECONDS };
