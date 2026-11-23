// server/routes/notifications.js
"use strict";

const express = require("express");
const router = express.Router();

const supaModule = require("../supabaseClient");
const supaAdmin =
  supaModule?.supaAdmin ||
  supaModule?.supabaseAdmin ||
  supaModule?.admin ||
  supaModule?.client ||
  supaModule;

const authModule = require("../mw/auth");
const requireUser = authModule?.requireUser || authModule;
const { getAreaAlertAccess } = require("../lib/areaAlertAccess");
const { isAdmin } = require("../lib/chatSafety");
const { loadClosedNearbyIds } = require("../lib/nearbyClosed");
const { normalizeLanguage } = require("../lib/languages");
const { localizedStored } = require("../lib/messages");

if (!supaAdmin || typeof supaAdmin.from !== "function") {
  throw new Error(
    "Supabase admin client is not initialized correctly: supaAdmin.from is not a function.",
  );
}

async function userOwnsMatch(matchId, userId) {
  const { data, error } = await supaAdmin
    .from("matches")
    .select("id, status, lost:lost_id ( user_id ), found:found_id ( user_id )")
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const owns =
    data?.lost?.user_id === userId || data?.found?.user_id === userId;
  return owns ? { ok: true, kind: "match", id: matchId, status: String(data.status || "").toUpperCase() } : null;
}

async function userOwnsReport(reportId, userId) {
  const { data, error } = await supaAdmin
    .from("reports")
    .select("id")
    .eq("id", reportId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { ok: true, kind: "report", id: reportId };
}

async function userCanAccessAreaAlert(campaignId, userId) {
  const access = await getAreaAlertAccess(campaignId, userId);
  if (!access.allowed) return null;

  const { data: campaign, error: campaignError } = await supaAdmin
    .from("geo_alert_campaigns")
    .select("id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError) throw campaignError;
  return campaign ? { ok: true, kind: "areaAlert", id: campaignId } : null;
}

async function userCanAccessObservation(observationId, userId) {
  const { data, error } = await supaAdmin
    .from("area_alert_observations")
    .select("id,observer_user_id,report_owner_user_id")
    .eq("id", observationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const allowed =
    data.observer_user_id === userId || data.report_owner_user_id === userId;
  return allowed ? { ok: true, kind: "observation", id: observationId } : null;
}

async function resolveNotificationTarget(notification, userId) {
  const entityType = String(notification?.entity_type || "").toLowerCase();
  const entityId = String(notification?.entity_id || "");
  const type = String(notification?.type || "").toUpperCase();

  if (!entityId) {
    return {
      ok: false,
      reason: "TARGET_NOT_FOUND",
      kind: entityType || "unknown",
      id: null,
    };
  }

  // T1.9BJ: bonus notices open «Din bonus»; admin notices open the admin screens.
  if (type === "BONUS_AWARDED" || entityType === "bonus") return { ok: true, kind: "bonus", id: entityId };
  // T1.9BP: a thank-you card opens «Takkekort».
  if (type === "THANKS_RECEIVED" || entityType === "thanks") return { ok: true, kind: "thanks", id: entityId };
  // T1.9BP: an answer to the user's own feedback opens «Dine tilbakemeldinger».
  if (type === "FEEDBACK_REPLY" || entityType === "feedback_reply") return { ok: true, kind: "feedbackReply", id: entityId };
  // T1.9BS: a finder wrote via a QR tag; only the tag's owner can open the conversation.
  if (type === "TAG_MESSAGE" || entityType === "tag_thread") {
    const { data, error } = await supaAdmin.from("tag_threads").select("id,owner_id").eq("id", entityId).maybeSingle();
    if (error) throw error;
    return data && data.owner_id === userId
      ? { ok: true, kind: "tagThread", id: entityId }
      : { ok: false, reason: "TARGET_NOT_FOUND", kind: "tagThread", id: entityId };
  }
  if (type === "FEEDBACK" || entityType === "feedback") {
    return isAdmin(userId)
      ? { ok: true, kind: "feedback", id: entityId }
      : { ok: false, reason: "TARGET_NOT_FOUND", kind: "feedback", id: entityId };
  }
  if (type === "CONTENT_REPORT" && isAdmin(userId)) return { ok: true, kind: "safetyReports", id: entityId };

  // T1.9M: chat reports open the admin report list (admins only).
  if (type === "SAFETY_REPORT" || entityType === "safety_report") {
    return isAdmin(userId)
      ? { ok: true, kind: "safetyReports", id: entityId }
      : { ok: false, reason: "TARGET_NOT_FOUND", kind: "safetyReports", id: entityId };
  }

  if (type === "AREA_ALERT_OBSERVATION" || entityType === "observation") {
    const observationTarget = await userCanAccessObservation(entityId, userId);
    if (!observationTarget)
      return {
        ok: false,
        reason: "TARGET_NOT_FOUND",
        kind: "observation",
        id: entityId,
      };
    return observationTarget;
  }
  if (
    type === "AREA_ALERT" ||
    type === "GEO_ALERT" ||
    entityType === "area_alert_campaign"
  ) {
    const areaAlertTarget = await userCanAccessAreaAlert(entityId, userId);
    if (!areaAlertTarget) {
      return {
        ok: false,
        reason: "TARGET_NOT_FOUND",
        kind: "areaAlert",
        id: entityId,
      };
    }
    return areaAlertTarget;
  }
  if (
    type === "NEW_MESSAGE" ||
    entityType === "chat" ||
    entityType === "match"
  ) {
    const matchTarget = await userOwnsMatch(entityId, userId);
    if (!matchTarget) {
      return {
        ok: false,
        reason: "TARGET_NOT_FOUND",
        kind: type === "NEW_MESSAGE" ? "chat" : "match",
        id: entityId,
      };
    }

    // T1.9BP: control-question notices open the chat too.
    // T1.9BT fix: a confirmed match has a chat, and the chat stays readable after the case is
    // solved, while the match page does not open for a closed case. So proposals to close the
    // case, confirmations and anything else about a confirmed match open the chat.
    const confirmed = matchTarget.status === "CONFIRMED" || matchTarget.status === "PAID";
    return type === "NEW_MESSAGE" || type.startsWith("TRUST_") || type.startsWith("RESOLUTION_") || entityType === "chat" || confirmed
      ? { ok: true, kind: "chat", id: entityId }
      : { ok: true, kind: "match", id: entityId };
  }

  if (entityType === "report") {
    const reportTarget = await userOwnsReport(entityId, userId);
    if (!reportTarget) {
      return {
        ok: false,
        reason: "TARGET_NOT_FOUND",
        kind: "report",
        id: entityId,
      };
    }
    return { ok: true, kind: "report", id: entityId };
  }

  return {
    ok: false,
    reason: "UNSUPPORTED_TARGET",
    kind: entityType || "unknown",
    id: entityId,
  };
}

async function getUserNotification(id, userId) {
  const { data, error } = await supaAdmin
    .from("notifications")
    .select(
      "id, user_id, type, entity_type, entity_id, title, body, created_at, read_at, notification_key",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getReportContext(notification, userId) {
  const type = String(notification?.type || "").toUpperCase();
  const entityType = String(notification?.entity_type || "").toLowerCase();
  const entityId = String(notification?.entity_id || "");
  let reportId = entityType === "report" ? entityId : null;
  if (
    entityType === "match" ||
    ["NEW_MATCH", "MATCH_CONFIRMED", "NEW_MESSAGE"].includes(type)
  ) {
    const matchResult = await supaAdmin
      .from("matches")
      .select("lost_id,found_id")
      .eq("id", entityId)
      .maybeSingle();
    if (!matchResult.error && matchResult.data) {
      const candidateIds = [
        matchResult.data.lost_id,
        matchResult.data.found_id,
      ].filter(Boolean);
      if (candidateIds.length) {
        const ownedReport = await supaAdmin
          .from("reports")
          .select("id")
          .in("id", candidateIds)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (!ownedReport.error) reportId = ownedReport.data?.id || null;
      }
    }
  }
  if (
    entityType === "observation" ||
    [
      "AREA_ALERT_OBSERVATION",
      "OBSERVATION_MESSAGE",
      "OBSERVATION_STATUS",
    ].includes(type)
  ) {
    const result = await supaAdmin
      .from("area_alert_observations")
      .select("report_id")
      .eq("id", entityId)
      .maybeSingle();
    if (!result.error) reportId = result.data?.report_id || null;
  }
  if (
    entityType === "area_alert_campaign" ||
    ["AREA_ALERT", "GEO_ALERT"].includes(type)
  ) {
    const result = await supaAdmin
      .from("geo_alert_campaigns")
      .select("report_id")
      .eq("id", entityId)
      .maybeSingle();
    if (!result.error) reportId = result.data?.report_id || null;
  }
  if (!reportId) return null;
  const result = await supaAdmin
    .from("reports")
    .select(
      "id,type,category,subcategory_key,subcategory_custom,color,brand,location_label",
    )
    .eq("id", reportId)
    .is("deleted_at", null)
    .maybeSingle();
  return result.error ? null : result.data || null;
}
// GET /notifications?limit=50
router.get("/", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const listColumns = "id, user_id, type, entity_type, entity_id, title, body, created_at, read_at, agg_count, notification_key";
    let { data, error } = await supaAdmin
      .from("notifications")
      .select(`${listColumns}, title_key, body_key, text_params`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    // Before the T1.9BT migration the key columns are missing: list the stored text.
    if (error && /title_key|body_key|text_params/.test(String(error.message || ""))) {
      ({ data, error } = await supaAdmin.from("notifications").select(listColumns).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit));
    }

    if (error) return res.status(400).json({ error: error.message });

    // T1.9BT fix: written in the app's language (?lang=), whatever the phone's push language was.
    // Older app builds send no language: they get the stored text, as before.
    const lang = req.query.lang ? normalizeLanguage(req.query.lang) : null;
    data = (data || []).map(({ title_key, body_key, text_params, ...n }) => ({
      ...n,
      title: lang ? localizedStored(lang, title_key, text_params?.title, n.title) : n.title,
      body: lang ? localizedStored(lang, body_key, text_params?.body, n.body) : n.body,
    }));

    // T1.9BN: nearby notices about solved or deleted cases are not listed.
    let hidden = new Set();
    try {
      hidden = await loadClosedNearbyIds(supaAdmin, data || []);
    } catch (e) {
      console.warn("[notifications] closed nearby check failed", e?.message ?? e);
    }

    const notifications = await Promise.all(
      (data || []).filter((n) => !hidden.has(n.id)).map(async (n) => {
        try {
          const target = await resolveNotificationTarget(n, userId);
          const reportContext = await getReportContext(n, userId);
          return {
            ...n,
            target_status: target.ok ? "ok" : "missing",
            target_kind: target.kind,
            report_context: reportContext,
          };
        } catch {
          return {
            ...n,
            target_status: "missing",
            target_kind: String(n?.entity_type || "unknown"),
          };
        }
      }),
    );

    return res.json({ notifications });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// GET /notifications/unread-count
router.get("/unread-count", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { count, error } = await supaAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) return res.status(400).json({ error: error.message });

    // T1.9BN: unread nearby notices about solved or deleted cases do not count.
    let hiddenCount = 0;
    try {
      const unreadNearby = await supaAdmin
        .from("notifications")
        .select("id,type,entity_type,entity_id")
        .eq("user_id", userId)
        .is("read_at", null)
        .or("type.in.(AREA_ALERT,GEO_ALERT),entity_type.eq.area_alert_campaign")
        .limit(200);
      if (!unreadNearby.error) hiddenCount = (await loadClosedNearbyIds(supaAdmin, unreadNearby.data || [])).size;
    } catch (e) {
      console.warn("[notifications] closed nearby count failed", e?.message ?? e);
    }
    return res.json({ count: Math.max(0, (count || 0) - hiddenCount) });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// GET /notifications/:id/resolve
router.get("/:id/resolve", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id || "");

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "id required" });

    const notification = await getUserNotification(id, userId);
    if (!notification) return res.status(404).json({ error: "Not found" });

    const target = await resolveNotificationTarget(notification, userId);
    if (!target.ok) {
      return res.json({
        ok: false,
        reason: target.reason,
        target_kind: target.kind,
        target_id: target.id,
      });
    }

    return res.json({
      ok: true,
      target_kind: target.kind,
      target_id: target.id,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// POST /notifications/:id/read
router.post("/:id/read", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id || "");

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "id required" });

    const { data, error } = await supaAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, read_at")
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true, id: data.id, read_at: data.read_at });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// POST /notifications/read-all
router.post("/read-all", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { error } = await supaAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// DELETE /notifications/missing
// Deletes notifications for the current user where the linked report/match/chat is gone.
router.delete("/missing", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data, error } = await supaAdmin
      .from("notifications")
      .select(
        "id, user_id, type, entity_type, entity_id, title, body, created_at, read_at, notification_key",
      )
      .eq("user_id", userId)
      .limit(300);

    if (error) return res.status(400).json({ error: error.message });

    const toDelete = [];
    for (const n of data || []) {
      try {
        const target = await resolveNotificationTarget(n, userId);
        if (!target.ok) toDelete.push(n.id);
      } catch {
        toDelete.push(n.id);
      }
    }

    if (toDelete.length === 0) return res.json({ ok: true, deleted: 0 });

    const { error: dErr } = await supaAdmin
      .from("notifications")
      .delete()
      .eq("user_id", userId)
      .in("id", toDelete);

    if (dErr) return res.status(400).json({ error: dErr.message });

    return res.json({ ok: true, deleted: toDelete.length });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// DELETE /notifications/:id
router.delete("/:id", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id || "");

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "id required" });

    const { data, error } = await supaAdmin
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

module.exports = router;
