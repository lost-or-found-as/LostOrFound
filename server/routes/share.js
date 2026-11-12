"use strict";
// T1.9AK: public page and poster for a shared lost report (no sign-in).
//   GET /s/:token          the page (?lang=no|en; otherwise the browser's language)
//   GET /s/:token/poster   an A4 poster with a QR code to the page
// A token that does not exist, a report that is closed, deleted or no longer shared: the
// "case is closed" page (status 404 or 410), which says nothing about the report.
const express = require("express");
const { supaAdmin } = require("../supabaseClient");
const { pickLanguage } = require("../lib/pageLanguage");
const { renderSharePage, renderClosedPage, renderPoster } = require("../lib/sharePage");
const { splitImagePath, firstImagePathByReport } = require("../lib/reportThumbnails");

const router = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{16,40}$/;
const PHOTO_TTL_SECONDS = 60 * 60;
const SHARE_COLUMNS = "id, type, status, category, subcategory_key, subcategory_custom, color, brand, occurred_at, location_label, description, pet_name, pet_breed, pet_temperament, deleted_at, closed_at";

function publicBase(req) {
  const configured = String(process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  return configured || `https://${req.get("host")}`;
}

async function sharedReport(token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const { data, error } = await supaAdmin.from("reports").select(SHARE_COLUMNS).eq("share_token", token).maybeSingle();
  if (error) throw error;
  return data || null;
}

const isOpen = (r) => r && r.type === "LOST" && r.status === "ACTIVE" && !r.deleted_at && !r.closed_at;

async function photoUrl(reportId) {
  try {
    const { data, error } = await supaAdmin.from("report_images").select("id, report_id, path, sort_order").eq("report_id", reportId);
    if (error) throw error;
    const path = firstImagePathByReport(data).get(reportId);
    const split = splitImagePath(path);
    if (!split) return null;
    const { data: signed, error: signError } = await supaAdmin.storage.from(split.bucket).createSignedUrl(split.objectPath, PHOTO_TTL_SECONDS);
    if (signError) throw signError;
    return signed?.signedUrl || null;
  } catch (e) {
    console.warn("[share] photo failed", e?.message || e);
    return null;
  }
}

async function qrSvg(url) {
  try {
    // Loaded on use: the page works without it, only the poster's QR code needs it.
    const QRCode = require("qrcode");
    return await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  } catch (e) {
    console.warn("[share] QR code failed", e?.message || e);
    return null;
  }
}

function send(res, status, html) {
  res.status(status);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex");
  res.set("Referrer-Policy", "no-referrer");
  return res.send(html);
}

router.get("/:token", async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    const report = await sharedReport(req.params.token);
    if (!isOpen(report)) return send(res, report ? 410 : 404, renderClosedPage({ lang }));
    const base = publicBase(req);
    const html = renderSharePage({
      report,
      lang,
      photoUrl: await photoUrl(report.id),
      posterUrl: `${base}/s/${encodeURIComponent(req.params.token)}/poster?lang=${lang}`,
    });
    return send(res, 200, html);
  } catch (e) {
    console.error("[share] page failed", e?.message || e);
    return send(res, 500, renderClosedPage({ lang }));
  }
});

router.get("/:token/poster", async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    const report = await sharedReport(req.params.token);
    if (!isOpen(report)) return send(res, report ? 410 : 404, renderClosedPage({ lang }));
    const pageUrl = `${publicBase(req)}/s/${encodeURIComponent(req.params.token)}`;
    const html = renderPoster({ report, lang, photoUrl: await photoUrl(report.id), pageUrl, qrSvg: await qrSvg(pageUrl) });
    return send(res, 200, html);
  } catch (e) {
    console.error("[share] poster failed", e?.message || e);
    return send(res, 500, renderClosedPage({ lang }));
  }
});

module.exports = router;
