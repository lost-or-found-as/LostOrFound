// C:\RN\RepairLostOrFound\server\routes\storage.js
"use strict";

const { Router } = require("express");
const { randomUUID } = require("crypto");
const { supaAdmin } = require("../supabaseClient");
const { requireUser, requireUserOrGuest } = require("../mw/auth");

const router = Router();
const BUCKET = process.env.BUCKET_REPORT_IMAGES || "report-images";
const IMAGE_PATH = /^reports\/([0-9a-f-]{36})\/[A-Za-z0-9._-]+$/i;

// T1.9A: a user may see the images of a report they own, or of a report that is matched
// against one of their own reports. Returns the subset of reportIds the user may view.
async function viewableReportIds(userId, reportIds) {
  const wanted = Array.from(new Set(reportIds));
  if (!wanted.length) return new Set();
  const { data: own, error: ownErr } = await supaAdmin
    .from("reports").select("id").eq("user_id", userId).in("id", wanted);
  if (ownErr) throw ownErr;
  const allowed = new Set((own || []).map((r) => r.id));
  const rest = wanted.filter((id) => !allowed.has(id));
  if (!rest.length) return allowed;

  const list = rest.join(",");
  const { data: links, error: linkErr } = await supaAdmin
    .from("matches").select("lost_id,found_id")
    .or(`lost_id.in.(${list}),found_id.in.(${list})`);
  if (linkErr) throw linkErr;
  const partnerIds = Array.from(new Set((links || []).flatMap((m) => [m.lost_id, m.found_id])));
  if (!partnerIds.length) return allowed;
  const { data: mine, error: mineErr } = await supaAdmin
    .from("reports").select("id").eq("user_id", userId).in("id", partnerIds);
  if (mineErr) throw mineErr;
  const myIds = new Set((mine || []).map((r) => r.id));
  for (const m of links || []) {
    if (myIds.has(m.found_id) && rest.includes(m.lost_id)) allowed.add(m.lost_id);
    if (myIds.has(m.lost_id) && rest.includes(m.found_id)) allowed.add(m.found_id);
  }
  return allowed;
}

// "report-images/reports/<reportId>/<file>" -> { objectPath, reportId } or null.
function parseImagePath(p) {
  const value = String(p || "").trim();
  if (!value.startsWith(`${BUCKET}/`)) return null;
  const objectPath = value.slice(BUCKET.length + 1);
  const m = IMAGE_PATH.exec(objectPath);
  return m ? { objectPath, reportId: m[1].toLowerCase() } : null;
}

// POST /storage/signed-upload
// body: { reportId: string(uuid), ext?: "jpg" | "png" ... }
router.post("/signed-upload", requireUserOrGuest, async (req, res) => {
  try {
    const { reportId, ext = "jpg" } = req.body || {};
    if (!reportId || typeof reportId !== "string") {
      return res.status(400).json({ error: "reportId (uuid) required" });
    }

    // The report must exist and belong to the caller (guest or registered).
    const { data: exists, error: qErr } = await supaAdmin
      .from("reports")
      .select("id")
      .eq("id", reportId)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (qErr) return res.status(400).json({ error: qErr.message });
    if (!exists) return res.status(404).json({ error: "Report not found" });

    const safeExt = String(ext).replace(".", "").toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(safeExt)) return res.status(400).json({ error: "Unsupported image type" });
    const fileName = `${randomUUID()}.${safeExt}`;
    const objectPath = `reports/${reportId}/${fileName}`;
    const dbPath = `${BUCKET}/${objectPath}`;

    const { data, error } = await supaAdmin.storage.from(BUCKET).createSignedUploadUrl(objectPath);
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ path: dbPath, signedUrl: data.signedUrl });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// GET /storage/signed-download?path=bucket/object/path.jpg
router.get("/signed-download", requireUser, async (req, res) => {
  try {
    const parsed = parseImagePath(req.query.path);
    if (!parsed) return res.status(400).json({ error: "INVALID_IMAGE_PATH" });
    const allowed = await viewableReportIds(req.user.id, [parsed.reportId]);
    if (!allowed.has(parsed.reportId)) return res.status(403).json({ error: "IMAGE_NOT_ALLOWED" });

    const { data, error } = await supaAdmin.storage.from(BUCKET).createSignedUrl(parsed.objectPath, 60 * 15);
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ url: data.signedUrl });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});



// POST /storage/signed-download-batch
// body: { paths: string[], expiresInSec?: number }
// paths must be in format: "bucket/object/path.jpg" (same as /signed-download?path=...)
router.post("/signed-download-batch", requireUser, async (req, res) => {
  try {
    const { paths, expiresInSec } = req.body || {};

    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: "paths[] required" });
    }

    const exp = Number(expiresInSec ?? 60 * 15);
    const ttl = Number.isFinite(exp) ? Math.max(60, Math.min(60 * 60, exp)) : 60 * 15; // 1 min - 1 hour

    // Dedupe + limit
    const uniq = Array.from(
      new Set(paths.map((p) => String(p || "").trim()).filter(Boolean))
    );

    const MAX = Number(process.env.SIGNED_URL_BATCH_MAX || 60);
    if (uniq.length > MAX) {
      return res.status(400).json({ error: `Too many paths (max ${MAX})` });
    }

    const urls = {};
    const errors = {};

    const parsedByPath = new Map(uniq.map((p) => [p, parseImagePath(p)]));
    const allowed = await viewableReportIds(
      req.user.id,
      Array.from(parsedByPath.values()).filter(Boolean).map((x) => x.reportId),
    );

    await Promise.all(
      uniq.map(async (p) => {
        try {
          const parsed = parsedByPath.get(p);
          if (!parsed) {
            errors[p] = "INVALID_IMAGE_PATH";
            return;
          }
          if (!allowed.has(parsed.reportId)) {
            errors[p] = "IMAGE_NOT_ALLOWED";
            return;
          }

          const { data, error } = await supaAdmin.storage
            .from(BUCKET)
            .createSignedUrl(parsed.objectPath, ttl);

          if (error) {
            errors[p] = error.message;
            return;
          }
          if (data?.signedUrl) urls[p] = data.signedUrl;
        } catch (e) {
          errors[p] = e?.message ?? "Sign error";
        }
      })
    );

    return res.json({ urls, errors, ttl });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});
module.exports = router;
