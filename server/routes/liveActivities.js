"use strict";
// T1.9BT: Live Activities (iOS lock screen) and the home screen widget.
//   GET  /live-activities/config            { enabled } – the app shows nothing while this is false
//   GET  /live-activities/case/:id?lang=    the props to start the activity with (owner, lost case)
//   POST /live-activities/register          { reportId, activityId, pushToken?, language }
//   POST /live-activities/end               { activityId } – the user stopped it in the app
// Switched off unless LIVE_ACTIVITIES_ENABLED=true.
const express = require("express");
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { normalizeLanguage } = require("../lib/languages");
const live = require("../lib/liveActivities");

const router = express.Router();
const UUID_RE = /^[0-9a-f-]{36}$/i;
const ACTIVITY_RE = /^[A-Za-z0-9-]{1,200}$/;
const TOKEN_RE = /^[0-9a-fA-F]{16,400}$/;
const MAX_ACTIVE_PER_USER = 5;

function fail(res, status, code) {
  return res.status(status).json({ error: code });
}

router.get("/config", requireUser, (_req, res) => res.json({ enabled: live.liveActivitiesEnabled() }));

router.get("/case/:id", requireUser, async (req, res) => {
  try {
    if (!live.liveActivitiesEnabled()) return fail(res, 404, "LIVE_ACTIVITIES_OFF");
    const id = String(req.params.id || "");
    if (!UUID_RE.test(id)) return fail(res, 404, "REPORT_NOT_FOUND");
    const state = await live.loadCaseState(supaAdmin, id, req.user.id);
    if (!state) return fail(res, 404, "REPORT_NOT_FOUND");
    if (!live.isFollowable(state.report)) return fail(res, 409, "CASE_NOT_FOLLOWABLE");
    return res.json({ name: live.ACTIVITY_NAME, props: live.caseProps(state.report, state, req.query.lang) });
  } catch (e) {
    console.error("[live] case props failed", e?.message ?? e);
    return fail(res, 500, "LIVE_CASE_FAILED");
  }
});

router.post("/register", requireUser, async (req, res) => {
  try {
    if (!live.liveActivitiesEnabled()) return fail(res, 404, "LIVE_ACTIVITIES_OFF");
    const reportId = String(req.body?.reportId || "");
    const activityId = String(req.body?.activityId || "");
    const pushToken = req.body?.pushToken == null ? null : String(req.body.pushToken);
    if (!UUID_RE.test(reportId) || !ACTIVITY_RE.test(activityId)) return fail(res, 400, "LIVE_INPUT_INVALID");
    if (pushToken && !TOKEN_RE.test(pushToken)) return fail(res, 400, "LIVE_TOKEN_INVALID");
    const state = await live.loadCaseState(supaAdmin, reportId, req.user.id);
    if (!state || !live.isFollowable(state.report)) return fail(res, 409, "CASE_NOT_FOLLOWABLE");

    const existing = await supaAdmin.from("live_activity_tokens").select("id,user_id").eq("activity_id", activityId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.user_id !== req.user.id) return fail(res, 409, "LIVE_ACTIVITY_TAKEN");
    const row = {
      user_id: req.user.id,
      report_id: reportId,
      activity_id: activityId,
      language: normalizeLanguage(req.body?.language),
      status: "ACTIVE",
      updated_at: new Date().toISOString(),
      ...(pushToken ? { push_token: pushToken.toLowerCase(), failures: 0 } : {}),
    };
    if (existing.data) {
      const upd = await supaAdmin.from("live_activity_tokens").update(row).eq("id", existing.data.id);
      if (upd.error) throw upd.error;
    } else {
      const count = await supaAdmin.from("live_activity_tokens").select("id", { count: "exact", head: true }).eq("user_id", req.user.id).eq("status", "ACTIVE");
      if (count.error) throw count.error;
      if (Number(count.count || 0) >= MAX_ACTIVE_PER_USER) return fail(res, 429, "LIVE_ACTIVITY_LIMIT");
      const ins = await supaAdmin.from("live_activity_tokens").insert(row);
      if (ins.error) throw ins.error;
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[live] register failed", e?.message ?? e);
    return fail(res, 500, "LIVE_REGISTER_FAILED");
  }
});

router.post("/end", requireUser, async (req, res) => {
  try {
    const activityId = String(req.body?.activityId || "");
    if (!ACTIVITY_RE.test(activityId)) return fail(res, 400, "LIVE_INPUT_INVALID");
    const upd = await supaAdmin
      .from("live_activity_tokens")
      .update({ status: "ENDED", updated_at: new Date().toISOString() })
      .eq("activity_id", activityId)
      .eq("user_id", req.user.id);
    if (upd.error) throw upd.error;
    return res.json({ ok: true });
  } catch (e) {
    console.error("[live] end failed", e?.message ?? e);
    return fail(res, 500, "LIVE_END_FAILED");
  }
});

module.exports = router;
