"use strict";
// T1.9V: feedback from the app.
//   POST /feedback                       { kind, message, appVersion?, platform?, osVersion?, deviceModel?, language? }
// Admin (user ids in ADMIN_USER_IDS):
//   GET  /feedback/admin?status=new|done
//   POST /feedback/admin/:id/done
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser, requireUserOrGuest } = require("../mw/auth");
const { isAdmin, adminUserIds } = require("../lib/chatSafety");
const { notifyUser } = require("../lib/userNotify");
const { localizedPair } = require("../lib/messages");
const { normalizeFeedback, feedbackEmailRequest, DAILY_LIMIT } = require("../lib/feedback");

const DAY_MS = 24 * 60 * 60 * 1000;

async function notifyAdminsOfFeedback(item) {
  for (const adminId of adminUserIds()) {
    try {
      await notifyUser({
        userId: adminId,
        type: "FEEDBACK",
        entityType: "feedback",
        entityId: item.id,
        titles: localizedPair("push.feedback.title"),
        bodies: localizedPair(`feedback.kind.${item.kind}`),
      });
    } catch (e) {
      console.warn("[feedback] admin push failed", e?.message || e);
    }
  }
  const email = feedbackEmailRequest(item);
  if (!email) return;
  try {
    const r = await fetch(email.url, email.init);
    if (!r.ok) console.warn("[feedback] admin e-mail failed", r.status);
  } catch (e) {
    console.warn("[feedback] admin e-mail failed", e?.message || e);
  }
}

router.post("/", requireUserOrGuest, async (req, res) => {
  try {
    const input = normalizeFeedback(req.body);
    if (!input.ok) return res.status(400).json({ error: input.error });
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { count, error: countError } = await supaAdmin
      .from("app_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count || 0) >= (req.isGuest ? DAILY_LIMIT.guest : DAILY_LIMIT.user))
      return res.status(429).json({ error: "FEEDBACK_DAILY_LIMIT" });
    const { data, error } = await supaAdmin
      .from("app_feedback")
      .insert({ ...input.value, user_id: req.user.id, is_guest: !!req.isGuest })
      .select("id, kind, message, platform, os_version, device_model, app_version, language")
      .single();
    if (error) throw error;
    await notifyAdminsOfFeedback({ ...data, guest: !!req.isGuest, replyTo: req.isGuest ? null : req.user.email || null });
    return res.json({ ok: true, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: "FEEDBACK_FAILED" });
  }
});

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user?.id)) return res.status(403).json({ error: "NOT_ADMIN" });
  return next();
}

router.get("/admin", requireUser, requireAdmin, async (req, res) => {
  try {
    const done = String(req.query.status || "new").toLowerCase() === "done";
    const { data, error } = await supaAdmin
      .from("app_feedback")
      .select("id, kind, message, status, is_guest, platform, os_version, device_model, app_version, language, created_at, handled_at")
      .eq("status", done ? "DONE" : "NEW")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: "FEEDBACK_LIST_FAILED" });
  }
});

router.post("/admin/:id/done", requireUser, requireAdmin, async (req, res) => {
  try {
    const { error } = await supaAdmin
      .from("app_feedback")
      .update({ status: "DONE", handled_at: new Date().toISOString(), handled_by: req.user.id })
      .eq("id", req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "FEEDBACK_UPDATE_FAILED" });
  }
});

module.exports = router;
