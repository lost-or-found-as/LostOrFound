"use strict";
// T1.9AY: people can report a case (from the app or from the public share page). When reports
// from HIDE_AFTER different people are open, the case is hidden: no share page, poster or
// area-alert view, and pending bonus from it is withdrawn. Admin is told (push, in-app, e-mail)
// and can restore or hide a case by hand. The owner gets an in-app notice.
const crypto = require("crypto");

const HIDE_AFTER = 3;
const REASONS = Object.freeze(["PERSON", "HARASSMENT", "PERSONAL_INFO", "SPAM", "OTHER"]);
const SOURCES = Object.freeze(["APP", "SHARE_PAGE"]);

function normalizeContentReport(body) {
  const reason = String(body?.reason || "").toUpperCase();
  if (!REASONS.includes(reason)) return { ok: false, error: "INVALID_REASON" };
  const comment = String(body?.comment ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  return { ok: true, reason, comment };
}

/** One anonymous visitor of a share page per day: a salted hash of the address, never the address. */
function visitorKey(ip, { env = process.env, now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const salt = String(env.CONTENT_REPORT_SALT || env.SUPABASE_URL || "lof");
  return "ip:" + crypto.createHash("sha256").update(`${salt}|${day}|${String(ip || "")}`).digest("hex").slice(0, 32);
}

/** Hides a case (REPORTED or ADMIN). Returns true when it was hidden now. */
async function hideReport(supa, reportId, reason, now = Date.now()) {
  const { data, error } = await supa.from("reports")
    .update({ hidden_at: new Date(now).toISOString(), hidden_reason: reason })
    .eq("id", reportId).is("hidden_at", null).select("id,user_id").maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Withdraws bonus that is still waiting and came from this case. */
async function revokePendingBonus(supa, reportId, now = Date.now()) {
  const { error } = await supa.from("helper_bonus_ledger")
    .update({ status: "REVOKED", remaining: 0, reason: "REPORT_HIDDEN", updated_at: new Date(now).toISOString() })
    .eq("report_id", reportId).eq("status", "PENDING");
  if (error) throw error;
}

/**
 * Records one report. Returns { recorded, already, hidden, openReporters }.
 * deps.notify: { owner(report), admins(info) } (both best effort).
 */
async function recordContentReport({ supa, reportId, reporterKey, reporterUserId = null, source, reason, comment = null, now = Date.now(), notify = {}, log = console }) {
  if (!SOURCES.includes(source)) throw Object.assign(new Error("INVALID_SOURCE"), { code: "INVALID_SOURCE" });
  const { data: report, error: rErr } = await supa.from("reports").select("id,user_id,hidden_at,deleted_at").eq("id", reportId).maybeSingle();
  if (rErr) throw rErr;
  if (!report || report.deleted_at) return { recorded: false, notFound: true };
  if (reporterUserId && reporterUserId === report.user_id) return { recorded: false, own: true };

  const ins = await supa.from("content_reports").insert({
    report_id: reportId, reporter_key: reporterKey, reporter_user_id: reporterUserId, source, reason, comment,
  });
  if (ins.error && ins.error.code !== "23505") throw ins.error;
  const already = ins.error?.code === "23505";

  const { data: open, error: oErr } = await supa.from("content_reports").select("reporter_key,reason").eq("report_id", reportId).is("handled_at", null);
  if (oErr) throw oErr;
  const openReporters = new Set((open || []).map((r) => r.reporter_key)).size;

  let hidden = !!report.hidden_at;
  if (!hidden && openReporters >= HIDE_AFTER) {
    const row = await hideReport(supa, reportId, "REPORTED", now);
    if (row) {
      hidden = true;
      await revokePendingBonus(supa, reportId, now).catch((e) => log.warn?.("[content] bonus revoke failed", e?.message || e));
      try { await notify.owner?.(row); } catch (e) { log.warn?.("[content] owner notice failed", e?.message || e); }
      try { await notify.admins?.({ reportId, hidden: true, reasons: (open || []).map((r) => r.reason) }); } catch (e) { log.warn?.("[content] admin notice failed", e?.message || e); }
    }
  } else if (!already && openReporters === 1) {
    // The first report: admin hears about it at once (the case stays visible).
    try { await notify.admins?.({ reportId, hidden: false, reasons: [reason] }); } catch (e) { log.warn?.("[content] admin notice failed", e?.message || e); }
  }
  return { recorded: !already, already, hidden, openReporters };
}

/** Admin: restore a hidden case and close its open reports. */
async function restoreReport(supa, reportId, now = Date.now()) {
  const u = await supa.from("reports").update({ hidden_at: null, hidden_reason: null }).eq("id", reportId);
  if (u.error) throw u.error;
  const h = await supa.from("content_reports").update({ handled_at: new Date(now).toISOString() }).eq("report_id", reportId).is("handled_at", null);
  if (h.error) throw h.error;
}

/** T1.9BB: admin closes the open reports and leaves the case as it is (kept hidden, or no action). */
async function closeReports(supa, reportId, now = Date.now()) {
  const h = await supa.from("content_reports").update({ handled_at: new Date(now).toISOString() }).eq("report_id", reportId).is("handled_at", null);
  if (h.error) throw h.error;
}

/** Admin: cases with open reports or hidden, newest first. */
async function listReported(supa) {
  const { data, error } = await supa.from("content_reports")
    .select("report_id,reason,source,comment,created_at,reports(id,type,title,category,subcategory_key,subcategory_custom,color,description,location_label,hidden_at,hidden_reason)")
    .is("handled_at", null).order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  const byReport = new Map();
  for (const r of data || []) {
    const item = byReport.get(r.report_id) || { reportId: r.report_id, report: r.reports || null, reports: [] };
    item.reports.push({ reason: r.reason, source: r.source, comment: r.comment, at: r.created_at });
    byReport.set(r.report_id, item);
  }
  return [...byReport.values()];
}

module.exports = { HIDE_AFTER, REASONS, normalizeContentReport, visitorKey, hideReport, revokePendingBonus, recordContentReport, restoreReport, closeReports, listReported };
