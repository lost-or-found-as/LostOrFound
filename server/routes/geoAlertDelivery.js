"use strict";
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { dispatchAreaAlertCampaign } = require("../lib/geoAlertDispatch");

const testUsers = () => new Set(String(process.env.GEO_ALERT_TEST_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
const testEnabled = () => String(process.env.GEO_ALERT_TEST_MODE || "").toLowerCase() === "true";

async function ownedCampaign(campaignId, userId) {
  const { data, error } = await supaAdmin.from("geo_alert_campaigns")
    .select("id,user_id,report_id,status,starts_at,ends_at")
    .eq("id", campaignId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

router.get("/:campaignId/estimate", requireUser, async (req, res) => {
  try {
    const campaign = await ownedCampaign(String(req.params.campaignId), req.user.id);
    if (!campaign) return res.status(404).json({ error: "CAMPAIGN_NOT_FOUND" });
    const { data, error } = await supaAdmin.rpc("refresh_geo_alert_estimate", { p_campaign_id: campaign.id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return res.json({ ok: true, campaignId: campaign.id, eligibleUsers: row?.eligible_users || 0, eligibleInstallations: row?.eligible_installations || 0 });
  } catch (e) { return res.status(500).json({ error: e?.message || "ESTIMATE_FAILED" }); }
});

router.post("/:campaignId/test-dispatch", requireUser, async (req, res) => {
  try {
    if (!testEnabled() || !testUsers().has(req.user.id)) return res.status(403).json({ error: "GEO_ALERT_TEST_NOT_ALLOWED" });
    const campaign = await ownedCampaign(String(req.params.campaignId || "").trim(), req.user.id);
    if (!campaign) return res.status(404).json({ error: "CAMPAIGN_NOT_FOUND" });
    const result = await dispatchAreaAlertCampaign(campaign.id);
    if (!result.ok) return res.status(409).json(result);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "AREA_ALERT_TEST_DISPATCH_FAILED" });
  }
});

router.get("/:campaignId/view", requireUser, async (req, res) => {
  try {
    const campaignId = String(req.params.campaignId || "").trim();
    const { data: recipient, error: recipientError } = await supaAdmin
      .from("geo_alert_recipients")
      .select("campaign_id,status")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (recipientError) throw recipientError;
    let notificationAccess = false;
    if (!recipient) {
      const { data: notification, error: notificationError } = await supaAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", req.user.id)
        .eq("type", "AREA_ALERT")
        .eq("entity_type", "area_alert_campaign")
        .eq("entity_id", campaignId)
        .maybeSingle();
      if (notificationError) throw notificationError;
      notificationAccess = Boolean(notification);
      console.info("[geo-alert][AREA_ALERT_NOTIFICATION_ACCESS]", { campaignId, userId: req.user.id, notificationAccess });
      if (!notificationAccess) return res.status(404).json({ error: "AREA_ALERT_NOT_AVAILABLE" });
    }

    const { data: campaign, error } = await supaAdmin
      .from("geo_alert_campaigns")
      .select("id,status,radius_m,starts_at,ends_at,report_id,reports(id,title,category,subcategory_key,color,brand,description,location_label,status)")
      .eq("id", campaignId)
      .maybeSingle();
    if (error) throw error;
    if (!campaign) return res.status(404).json({ error: "AREA_ALERT_NOT_AVAILABLE" });
    return res.json({ ok: true, campaign, recipientStatus: recipient?.status || "IN_APP_ONLY" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "AREA_ALERT_VIEW_FAILED" });
  }
});

router.post("/receipts/check", requireUser, async (req, res) => {
  try {
    if (!testEnabled() || !testUsers().has(req.user.id)) return res.status(403).json({ error: "GEO_ALERT_TEST_NOT_ALLOWED" });
    const { data: logs, error } = await supaAdmin.from("push_delivery_log")
      .select("id,expo_ticket_id,expo_push_token,campaign_id")
      .eq("status", "TICKET_OK").is("receipt_checked_at", null).not("expo_ticket_id", "is", null).limit(300);
    if (error) throw error;
    if (!logs?.length) return res.json({ ok: true, checked: 0 });
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids: logs.map(x => x.expo_ticket_id) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "EXPO_RECEIPT_FAILED", details: body });
    let disabled = 0;
    for (const log of logs) {
      const receipt = body?.data?.[log.expo_ticket_id];
      if (!receipt) continue;
      const errorCode = receipt?.details?.error || null;
      const delivered = receipt.status === "ok";
      await supaAdmin.from("push_delivery_log").update({
        receipt_status: delivered ? "DELIVERED" : "ERROR",
        receipt_checked_at: new Date().toISOString(),
        status: delivered ? "DELIVERED" : "RECEIPT_ERROR",
        error_code: errorCode,
        error_message: receipt?.message || null,
        updated_at: new Date().toISOString(),
      }).eq("id", log.id);
      if (errorCode === "DeviceNotRegistered") {
        disabled++;
        await supaAdmin.from("push_installations").update({ active:false, disabled_at:new Date().toISOString(), disabled_reason:"DEVICE_NOT_REGISTERED", updated_at:new Date().toISOString() }).eq("expo_push_token", log.expo_push_token);
      }
      if (log.campaign_id) await supaAdmin.from("geo_alert_recipients").update({ status: delivered ? "DELIVERED" : "RECEIPT_ERROR", updated_at:new Date().toISOString() }).eq("campaign_id", log.campaign_id).eq("expo_push_token", log.expo_push_token);
    }
    return res.json({ ok:true, checked:logs.length, disabledTokens:disabled });
  } catch (e) { return res.status(500).json({ error:e?.message || "RECEIPT_CHECK_FAILED" }); }
});

module.exports = router;
