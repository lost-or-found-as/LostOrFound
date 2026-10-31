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

if (!supaAdmin || typeof supaAdmin.from !== "function") {
  throw new Error(
    "Supabase admin client is not initialized correctly: supaAdmin.from is not a function.",
  );
}

async function userOwnsMatch(matchId, userId) {
  const { data, error } = await supaAdmin
    .from("matches")
    .select("id, lost:lost_id ( user_id ), found:found_id ( user_id )")
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const owns =
    data?.lost?.user_id === userId || data?.found?.user_id === userId;
  return owns ? { ok: true, kind: "match", id: matchId } : null;
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

    return type === "NEW_MESSAGE"
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

    const { data, error } = await supaAdmin
      .from("notifications")
      .select(
        "id, user_id, type, entity_type, entity_id, title, body, created_at, read_at, agg_count, notification_key",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return res.status(400).json({ error: error.message });

    const notifications = await Promise.all(
      (data || []).map(async (n) => {
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
    return res.json({ count: count || 0 });
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
