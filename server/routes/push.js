"use strict";
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { message } = require("../lib/messages");
const { requireUser } = require("../mw/auth");

const isExpoToken = (value) => /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/.test(String(value || ""));
const testUserIds = () => new Set(String(process.env.PUSH_TEST_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean));

// T1.9F: the app reports its language whenever it changes, so push texts follow the app
// language and not the language that was active when push was first turned on.
router.post("/language", requireUser, async (req, res) => {
  try {
    const installationId = String(req.body?.installationId || "").trim();
    const language = req.body?.language === "en" ? "en" : req.body?.language === "no" ? "no" : null;
    if (!installationId || installationId.length > 200) return res.status(400).json({ error: "INVALID_INSTALLATION_ID" });
    if (!language) return res.status(400).json({ error: "INVALID_LANGUAGE" });
    const { data, error } = await supaAdmin
      .from("push_installations")
      .update({ language, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", req.user.id)
      .eq("installation_id", installationId)
      .select("installation_id");
    if (error) throw error;
    return res.json({ ok: true, updated: (data || []).length });
  } catch (e) {
    console.error("[push/language] failed", e?.message ?? e);
    return res.status(500).json({ error: "PUSH_LANGUAGE_UPDATE_FAILED" });
  }
});

router.post("/register", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const installationId = String(body.installationId || "").trim();
    const expoPushToken = String(body.expoPushToken || "").trim();
    const platform = String(body.platform || "").toLowerCase();
    const language = body.language === "en" ? "en" : "no";
    const permissionStatus = String(body.permissionStatus || "granted");
    const appVersion = body.appVersion ? String(body.appVersion).slice(0, 50) : null;
    if (!installationId || installationId.length > 200) return res.status(400).json({ error: "INVALID_INSTALLATION_ID" });
    if (!isExpoToken(expoPushToken)) return res.status(400).json({ error: "INVALID_EXPO_PUSH_TOKEN" });
    if (!['ios','android'].includes(platform)) return res.status(400).json({ error: "INVALID_PLATFORM" });

    // Et token kan flyttes mellom innlogginger på samme installasjon. Deaktiver gammel binding først.
    const { error: removeOldTokenError } = await supaAdmin
  .from("push_installations")
  .delete()
  .eq("expo_push_token", expoPushToken)
  .neq("user_id", userId);

if (removeOldTokenError) throw removeOldTokenError;

    const row = {
      user_id: userId,
      installation_id: installationId,
      expo_push_token: expoPushToken,
      platform,
      language,
      permission_status: permissionStatus,
      app_version: appVersion,
      active: true,
      last_registered_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
      disabled_reason: null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supaAdmin.from("push_installations")
      .upsert(row, { onConflict: "user_id,installation_id" })
      .select("id,user_id,installation_id,platform,language,permission_status,app_version,active,last_registered_at")
      .single();
    if (error) throw error;
    return res.json({ ok: true, installation: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "PUSH_REGISTER_FAILED" });
  }
});

router.post("/unregister", requireUser, async (req, res) => {
  try {
    const installationId = String(req.body?.installationId || "").trim();
    if (!installationId) return res.status(400).json({ error: "INVALID_INSTALLATION_ID" });
    const { error } = await supaAdmin.from("push_installations")
      .update({ active: false, disabled_at: new Date().toISOString(), disabled_reason: "USER_DISABLED", updated_at: new Date().toISOString() })
      .eq("user_id", req.user.id)
      .eq("installation_id", installationId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "PUSH_UNREGISTER_FAILED" });
  }
});

router.get("/status", requireUser, async (req, res) => {
  try {
    const { data, error } = await supaAdmin.from("push_installations")
      .select("id,installation_id,platform,language,permission_status,app_version,active,last_registered_at,last_seen_at")
      .eq("user_id", req.user.id)
      .order("last_registered_at", { ascending: false });
    if (error) throw error;
    return res.json({ installations: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "PUSH_STATUS_FAILED" });
  }
});

router.post("/test", requireUser, async (req, res) => {
  try {
    if (String(process.env.PUSH_TEST_MODE || "").toLowerCase() !== "true" || !testUserIds().has(req.user.id)) {
      return res.status(403).json({ error: "PUSH_TEST_NOT_ALLOWED" });
    }
    const { data: installations, error } = await supaAdmin.from("push_installations")
      .select("installation_id,expo_push_token,language")
      .eq("user_id", req.user.id)
      .eq("active", true);
    if (error) throw error;
    if (!installations?.length) return res.status(404).json({ error: "NO_ACTIVE_PUSH_INSTALLATION" });

    const notificationKey = `PUSH_TEST:${req.user.id}:${Date.now()}`;
    const messages = installations.map(x => ({
      to: x.expo_push_token,
      sound: "default",
      title: message(x.language, "push.test.title"),
      body: message(x.language, "push.test.body"),
      data: { targetKind: "notifications", notificationKey, type: "PUSH_TEST" },
    }));
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
      body: JSON.stringify(messages),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "EXPO_PUSH_SEND_FAILED", details: result });

    const tickets = Array.isArray(result?.data) ? result.data : [result?.data].filter(Boolean);
    const logRows = installations.map((x, i) => ({
      user_id: req.user.id,
      installation_id: x.installation_id,
      expo_push_token: x.expo_push_token,
      notification_type: "PUSH_TEST",
      notification_key: notificationKey,
      expo_ticket_id: tickets[i]?.id || null,
      status: tickets[i]?.status === "ok" ? "TICKET_OK" : "TICKET_ERROR",
      error_code: tickets[i]?.details?.error || null,
      error_message: tickets[i]?.message || null,
      payload: messages[i],
      updated_at: new Date().toISOString(),
    }));
    await supaAdmin.from("push_delivery_log").insert(logRows);
    return res.json({ ok: true, sent: messages.length, tickets });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "PUSH_TEST_FAILED" });
  }
});

module.exports = router;
