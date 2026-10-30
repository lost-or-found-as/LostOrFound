// server/routes/reportsActivity.js
// GET /reports/mine/with-activity
// Returns reports, match-to-report maps, and the latest message per match in one request.
// GET /reports/:id/activity (T1.9G)
// Summary and timeline for one case: open and confirmed matches, unread chat messages,
// observations, area alerts and lifecycle events. The app turns event types into text.

"use strict";

const express = require("express");
const router = express.Router();

// Robust Supabase admin client import supporting default and common named exports.
const supaModule = require("../supabaseClient");
const supaAdmin =
  supaModule?.supaAdmin ||
  supaModule?.supabaseAdmin ||
  supaModule?.admin ||
  supaModule?.client ||
  supaModule;

const authModule = require("../mw/auth");
const requireUser = authModule?.requireUser || authModule;
const { loadReportMatches } = require("./matches");
const { buildReportActivity, OPEN_MATCH_STATUSES } = require("../lib/reportActivity");

if (!supaAdmin || typeof supaAdmin.from !== "function") {
  throw new Error(
    "Supabase admin client is not initialized correctly: supaAdmin.from is not a function. " +
      "Check ../supabaseClient exports (default versus { supaAdmin })."
  );
}

function isActiveReport(rep) {
  if (!rep) return false;
  if (rep.status && rep.status !== "ACTIVE") return false;
  if (rep.closed_at || rep.archived_at || rep.deleted_at) return false;
  if (rep.visible_until && Date.parse(rep.visible_until) <= Date.now()) return false;
  return true;
}

router.get("/mine/with-activity", requireUser, async (req, res) => {
  try {
    const user = req.user;

    // 1) Load reports.
    const { data: reports, error: rErr } = await supaAdmin
      .from("reports")
      .select(
        "id, type, category, subcategory_key, title, created_at, occurred_at, color, brand, lat, lng, location_label, status, visible_until, closed_at, archived_at, last_extended_at, extension_count, deleted_at"
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (rErr) return res.status(400).json({ error: rErr.message });

    const reps = reports || [];
    if (reps.length === 0) {
      return res.json({ reports: [], matchToReport: {}, lastMessages: [] });
    }

    const reportIds = reps.map((r) => r.id);
    const reportSet = new Set(reportIds);

    // 2) Load all matches for these reports and merge both query results.
    const { data: lostMatches, error: lmErr } = await supaAdmin
      .from("matches")
      .select("id, status, lost_id, found_id, lost:lost_id(id,user_id,status,visible_until,closed_at,archived_at,deleted_at), found:found_id(id,user_id,status,visible_until,closed_at,archived_at,deleted_at)")
      .in("lost_id", reportIds);
    if (lmErr) return res.status(400).json({ error: lmErr.message });

    const { data: foundMatches, error: fmErr } = await supaAdmin
      .from("matches")
      .select("id, status, lost_id, found_id, lost:lost_id(id,user_id,status,visible_until,closed_at,archived_at,deleted_at), found:found_id(id,user_id,status,visible_until,closed_at,archived_at,deleted_at)")
      .in("found_id", reportIds);
    if (fmErr) return res.status(400).json({ error: fmErr.message });

    const merged = new Map();
    for (const m of (lostMatches || [])) merged.set(m.id, m);
    for (const m of (foundMatches || [])) merged.set(m.id, m);
    const ownedMatches = Array.from(merged.values()).filter(
      (m) => m?.lost?.user_id !== m?.found?.user_id
    );

    const activeMatches = ownedMatches.filter(
      (m) => isActiveReport(m?.lost) && isActiveReport(m?.found)
    );

    const historicalMatches = ownedMatches.filter((m) =>
      ["CONFIRMED", "PAID"].includes(String(m?.status || "").toUpperCase())
    );

    function buildMap(matches) {
      const out = {};
      for (const m of matches) {
        const lostId = String(m.lost_id || "");
        const foundId = String(m.found_id || "");
        if (lostId && reportSet.has(lostId)) out[String(m.id)] = lostId;
        else if (foundId && reportSet.has(foundId)) out[String(m.id)] = foundId;
      }
      return out;
    }

    // Active matches drive active match counts. Confirmed historical matches retain chat access.
    const matchToReport = buildMap(activeMatches);
    const historyMatchToReport = buildMap(historicalMatches);
    const matchIds = Array.from(new Set([
      ...Object.keys(matchToReport),
      ...Object.keys(historyMatchToReport),
    ]));

    if (matchIds.length === 0) {
      return res.json({ reports: reps, matchToReport, historyMatchToReport, lastMessages: [] });
    }

    // 4) Load the latest message per match in one request. Requires last_message_per_conversation.
    const { data: lastRows, error: lastErr } = await supaAdmin
      .from("last_message_per_conversation")
      .select("conversation_id, sender_id, body, created_at")
      .in("conversation_id", matchIds);

    if (lastErr) {
      return res.status(400).json({
        error:
          lastErr.message +
          " (Missing view: last_message_per_conversation.)",
      });
    }

    return res.json({
      reports: reps,
      matchToReport,
      historyMatchToReport,
      lastMessages: lastRows || [],
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

router.get("/:id/activity", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = String(req.params.id || "").trim();

    const { data: report, error: rErr } = await supaAdmin
      .from("reports")
      .select("id, user_id, type, status, created_at, closed_at, last_extended_at, visible_until")
      .eq("id", reportId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });

    // Confirmed matches stay visible after the case ends, so they are loaded separately from
    // the open ones (which only count while both cases are active).
    const loaded = await loadReportMatches(reportId, userId);
    const openMatches = (loaded?.matches || []).filter((m) => OPEN_MATCH_STATUSES.has(String(m?.status || "").toUpperCase()));
    const side = String(report.type).toUpperCase() === "LOST" ? "lost_id" : "found_id";
    const { data: confirmedRows, error: cErr } = await supaAdmin
      .from("matches")
      .select("id, status, score, created_at")
      .eq(side, reportId)
      .in("status", ["CONFIRMED", "PAID"]);
    if (cErr) throw cErr;
    const confirmed = confirmedRows || [];
    const confirmedIds = confirmed.map((m) => String(m.id));

    const [confirmationsResult, lastResult, readsResult, observationsResult, campaignsResult, ordersResult, watchResult] = await Promise.all([
      confirmedIds.length
        ? supaAdmin.from("notifications").select("entity_id, created_at").eq("type", "MATCH_CONFIRMED").in("entity_id", confirmedIds)
        : Promise.resolve({ data: [] }),
      confirmedIds.length
        ? supaAdmin.from("last_message_per_conversation").select("conversation_id, sender_id, created_at").in("conversation_id", confirmedIds)
        : Promise.resolve({ data: [] }),
      confirmedIds.length
        ? supaAdmin.from("conversation_reads").select("conversation_id, last_read_at").eq("user_id", userId).in("conversation_id", confirmedIds)
        : Promise.resolve({ data: [] }),
      supaAdmin.from("area_alert_observations").select("id, observation_type, status, created_at").eq("report_id", reportId),
      supaAdmin.from("geo_alert_campaigns").select("id, radius_m, activated_at").eq("report_id", reportId),
      supaAdmin.from("report_orders").select("product_code, paid_at, refunded_at").eq("report_id", reportId).eq("user_id", userId).not("paid_at", "is", null),
      supaAdmin.from("long_term_watches").select("status, current_period_end").eq("report_id", reportId).maybeSingle(),
    ]);
    for (const r of [confirmationsResult, lastResult, readsResult, observationsResult, campaignsResult, ordersResult, watchResult])
      if (r.error) throw r.error;

    // Unread: messages from the other party after this user last opened the chat.
    const readAt = new Map((readsResult.data || []).map((x) => [String(x.conversation_id), x.last_read_at]));
    const unreadByMatch = {};
    await Promise.all(
      confirmedIds.map(async (id) => {
        let q = supaAdmin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", id)
          .neq("sender_id", userId);
        const since = readAt.get(id);
        if (since) q = q.gt("created_at", since);
        const { count, error } = await q;
        if (!error) unreadByMatch[id] = Number(count || 0);
      }),
    );

    // Earliest confirmation per match (a match has one, but stay safe with duplicates).
    const confirmations = [];
    const seen = new Map();
    for (const row of confirmationsResult.data || []) {
      const prev = seen.get(String(row.entity_id));
      if (!prev || Date.parse(row.created_at) < Date.parse(prev.created_at)) seen.set(String(row.entity_id), row);
    }
    for (const row of seen.values()) confirmations.push(row);

    return res.json({
      ok: true,
      reportId,
      ...buildReportActivity({
        report,
        matches: [...openMatches, ...confirmed],
        confirmations,
        lastMessages: lastResult.data || [],
        unreadByMatch,
        observations: observationsResult.data || [],
        campaigns: campaignsResult.data || [],
        orders: ordersResult.data || [],
        longTermWatch: watchResult.data || null,
      }),
    });
  } catch (e) {
    console.error("[reports][activity-failed]", {
      reportId: req.params?.id || null,
      errorCode: e?.code || null,
      errorMessage: e?.message || String(e),
    });
    return res.status(500).json({ error: "REPORT_ACTIVITY_FAILED" });
  }
});

module.exports = router;
