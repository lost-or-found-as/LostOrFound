"use strict";
// T1.9AO: deletes old cases under the retention rule (Personvern i Lost or Found, ch. 6).
// Candidates come from public.report_retention_candidates (closed or expired, 12 months without
// activity, nothing paid running, no legal hold). RETENTION_PURGE_MODE on the server decides:
//   report (default) – count and log only; nothing is deleted
//   delete           – delete each case the same way the owner would (photos included); a case
//                      with paid orders keeps its row for the accounts, emptied of personal text
//   off              – do nothing
// Runs once a night at 03:40 UTC. Every deletion is written to report_retention_events.
// T1.9AP: the same run also removes photo-suggestion log rows (image_analyses) older than
// 12 months, as the privacy policy promises. Same mode: report counts, delete removes.
const MODES = new Set(["off", "report", "delete"]);
const RUN_HOUR_UTC = 3;
const RUN_MINUTE_UTC = 40;
const DEFAULT_MONTHS = 12;
const BATCH_LIMIT = 200;

function retentionMode(env = process.env) {
  const mode = String(env.RETENTION_PURGE_MODE || "report").trim().toLowerCase();
  return MODES.has(mode) ? mode : "report";
}

/** Milliseconds from `now` to the next 03:40 UTC. */
function msUntilNextRun(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(RUN_HOUR_UTC, RUN_MINUTE_UTC, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now;
}

// What a soft-deleted case keeps: the row and its paid orders. Personal text and links go.
const SCRUB_FIELDS = Object.freeze({
  description: null,
  brand: null,
  subcategory_custom: null,
  location_label: null,
  photos: [],
  pet_name: null,
  pet_breed: null,
  pet_temperament: null,
  share_token: null,
});

/** Cut-off for log rows: `months` before `now`. */
function cutoffIso(months, now = Date.now()) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

/**
 * Photo-suggestion log (image_analyses): rows older than `months`. Report mode counts them,
 * delete mode removes them. Returns the number found or removed.
 */
async function purgeImageAnalyses({ mode, months = DEFAULT_MONTHS, supa, log = console, now = Date.now() }) {
  if (mode === "off") return 0;
  const before = cutoffIso(months, now);
  if (mode === "report") {
    const { count, error } = await supa.from("image_analyses").select("id", { count: "exact", head: true }).lt("created_at", before);
    if (error) throw error;
    log.info("[retention][report]", { imageAnalyses: count || 0, before });
    return count || 0;
  }
  const { count, error } = await supa.from("image_analyses").delete({ count: "exact" }).lt("created_at", before);
  if (error) throw error;
  log.info("[retention][delete]", { imageAnalyses: count || 0, before });
  return count || 0;
}

/**
 * One run. deps = { supa, deleteOwnedReport, log } (passed in so the run can be tested).
 * Returns { mode, candidates, deleted, scrubbed, failed, imageAnalyses }.
 */
async function runRetention({ mode = retentionMode(), months = DEFAULT_MONTHS, deps }) {
  const { supa, deleteOwnedReport, log = console } = deps;
  const summary = { mode, candidates: 0, deleted: 0, scrubbed: 0, failed: 0, imageAnalyses: 0 };
  if (mode === "off") return summary;

  // The log purge runs first and on its own: a failure here must not stop the case purge.
  try {
    summary.imageAnalyses = await purgeImageAnalyses({ mode, months, supa, log });
  } catch (e) {
    summary.failed += 1;
    log.error("[retention][image-analyses-failed]", { errorMessage: e?.message || String(e) });
  }

  const { data, error } = await supa.rpc("report_retention_candidates", { p_months: months, p_limit: BATCH_LIMIT });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  summary.candidates = rows.length;
  if (mode === "report") {
    log.info("[retention][report]", { candidates: rows.length, oldest: rows[0]?.last_activity || null, withOrders: rows.filter((r) => r.has_orders).length });
    return summary;
  }

  for (const row of rows) {
    try {
      const result = await deleteOwnedReport(row.report_id, row.user_id);
      if (result.status !== 200) throw new Error(String(result.body?.error || `HTTP_${result.status}`));
      const soft = result.body?.deletionMode === "SOFT";
      if (soft) {
        const now = new Date().toISOString();
        const { error: scrubError } = await supa
          .from("reports")
          .update({ ...SCRUB_FIELDS, purged_at: now, deletion_reason: "RETENTION" })
          .eq("id", row.report_id);
        if (scrubError) throw scrubError;
        await supa.from("report_identifiers").delete().eq("report_id", row.report_id);
        summary.scrubbed += 1;
      } else {
        summary.deleted += 1;
      }
      await supa.from("report_retention_events").insert({
        report_id: row.report_id,
        user_id: row.user_id,
        event_type: soft ? "RETENTION_SCRUBBED" : "RETENTION_DELETED",
        reason: `No activity for ${months} months`,
        metadata: { last_activity: row.last_activity, status: row.status, report_type: row.report_type },
      });
    } catch (e) {
      summary.failed += 1;
      log.error("[retention][delete-failed]", { reportId: row.report_id, errorMessage: e?.message || String(e) });
    }
  }
  log.info("[retention][delete]", summary);
  return summary;
}

/** Starts the nightly run (unless the mode is off). Returns the timer, or null. */
function scheduleRetention({ deps, env = process.env, now = () => Date.now() }) {
  if (retentionMode(env) === "off") return null;
  let timer = null;
  const plan = () => {
    timer = setTimeout(async () => {
      try {
        await runRetention({ mode: retentionMode(env), deps });
      } catch (e) {
        deps.log?.error?.("[retention][run-failed]", { errorMessage: e?.message || String(e) });
      }
      plan();
    }, msUntilNextRun(now()));
    if (typeof timer.unref === "function") timer.unref();
  };
  plan();
  return timer;
}

module.exports = { retentionMode, msUntilNextRun, runRetention, purgeImageAnalyses, cutoffIso, scheduleRetention, SCRUB_FIELDS, DEFAULT_MONTHS };
