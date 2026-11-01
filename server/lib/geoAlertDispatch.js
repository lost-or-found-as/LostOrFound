"use strict";
const { supaAdmin } = require("../supabaseClient");
const { message } = require("./messages");
const { SAME_CASE_DAYS, SENT_STATUSES, applyRecipientCaps } = require("./areaAlertCaps");

async function expoSend(messages) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("EXPO_PUSH_SEND_FAILED");
    error.details = body;
    throw error;
  }
  return Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
}

/** Loads what each candidate already got and applies the per-person limits. */
async function capRecipients(campaignId, candidates) {
  const users = [...new Set(candidates.map((c) => c.recipient_user_id).filter(Boolean))];
  if (!users.length) return { send: candidates, skipped: [] };
  const now = Date.now();
  const recent = await supaAdmin
    .from("geo_alert_recipients")
    .select("user_id,campaign_id")
    .in("user_id", users)
    .in("status", SENT_STATUSES)
    .neq("campaign_id", campaignId)
    .gte("created_at", new Date(now - 24 * 3600 * 1000).toISOString());
  if (recent.error) throw recent.error;
  const byUser = new Map();
  for (const r of recent.data || []) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Set());
    byUser.get(r.user_id).add(r.campaign_id);
  }
  const campaign = await supaAdmin.from("geo_alert_campaigns").select("report_id").eq("id", campaignId).maybeSingle();
  if (campaign.error) throw campaign.error;
  const sameCase = new Set();
  if (campaign.data?.report_id) {
    const earlier = await supaAdmin
      .from("geo_alert_campaigns")
      .select("id")
      .eq("report_id", campaign.data.report_id)
      .neq("id", campaignId)
      .gte("created_at", new Date(now - SAME_CASE_DAYS * 24 * 3600 * 1000).toISOString());
    if (earlier.error) throw earlier.error;
    const ids = (earlier.data || []).map((c) => c.id);
    if (ids.length) {
      const got = await supaAdmin
        .from("geo_alert_recipients")
        .select("user_id")
        .in("campaign_id", ids)
        .in("user_id", users)
        .in("status", SENT_STATUSES);
      if (got.error) throw got.error;
      for (const r of got.data || []) sameCase.add(r.user_id);
    }
  }
  return applyRecipientCaps(candidates, byUser, sameCase);
}

/**
 * Dispatches an area-alert campaign in two independent layers.
 *
 * Layer 1 (user level): one internal AREA_ALERT notification per qualified user,
 *   created in the database by geo_alert_create_in_app_notifications. This does not
 *   depend on push and is idempotent through the notification_key unique index.
 *
 * Layer 2 (installation level): push is sent only to active, granted installations
 *   returned by geo_alert_eligible_installations, which is derived from layer 1.
 *   A push transport failure never removes or hides the layer 1 notifications.
 */
async function dispatchAreaAlertCampaign(campaignId) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("CAMPAIGN_ID_REQUIRED");

  const { data: dispatchable, error: dispatchableError } = await supaAdmin.rpc(
    "geo_alert_campaign_is_dispatchable",
    { p_campaign_id: id },
  );
  if (dispatchableError) throw dispatchableError;
  if (!dispatchable)
    return {
      ok: false,
      error: "CAMPAIGN_NOT_DISPATCHABLE",
      eligible: 0,
      sent: 0,
      skippedAsDuplicate: 0,
    };

  // Layer 1: internal Nearby notifications, independent of push.
  const { data: inAppRows, error: inAppError } = await supaAdmin.rpc(
    "geo_alert_create_in_app_notifications",
    { p_campaign_id: id },
  );
  if (inAppError) throw inAppError;
  const inApp = Array.isArray(inAppRows) ? inAppRows[0] : inAppRows;
  const eligibleUsers = Number(inApp?.eligible_users || 0);
  const notificationsCreated = Number(inApp?.created_notifications || 0);

  // Layer 2: push installations for qualified users that requested push.
  const { data: candidateRows, error: candidateError } = await supaAdmin.rpc(
    "geo_alert_eligible_installations",
    { p_campaign_id: id },
  );
  if (candidateError) throw candidateError;
  const allCandidates = candidateRows || [];

  // T1.9T: per-person limits. Skipped people still have the in-app notice from layer 1.
  // A failed lookup never stops the alert itself: then everyone is sent to, as before.
  let capResult = { send: allCandidates, skipped: [] };
  try {
    capResult = await capRecipients(id, allCandidates);
  } catch (capError) {
    console.error("[geo-alert][recipient-caps-failed]", { campaignId: id, error: capError?.message || String(capError) });
  }
  const { send: candidates, skipped: capped } = capResult;
  for (const c of capped) {
    const { error: skipError } = await supaAdmin.from("geo_alert_recipients").upsert(
      {
        campaign_id: id,
        user_id: c.recipient_user_id,
        installation_id: c.installation_id,
        expo_push_token: c.expo_push_token,
        watch_area_id: c.watch_area_id,
        category_key: c.category_key,
        status: "SKIPPED",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "campaign_id,installation_id", ignoreDuplicates: true },
    );
    if (skipError) console.error("[geo-alert][recipient-skip-record-failed]", { campaignId: id, error: skipError.message });
  }

  const accepted = [];
  for (const candidate of candidates) {
    const { data: recipient, error: recipientError } = await supaAdmin
      .from("geo_alert_recipients")
      .upsert(
        {
          campaign_id: id,
          user_id: candidate.recipient_user_id,
          installation_id: candidate.installation_id,
          expo_push_token: candidate.expo_push_token,
          watch_area_id: candidate.watch_area_id,
          category_key: candidate.category_key,
          status: "QUEUED",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "campaign_id,installation_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (recipientError) throw recipientError;
    if (recipient) accepted.push({ ...candidate, recipientRowId: recipient.id });
  }

  const skippedAsDuplicate = candidates.length - accepted.length;
  let tickets = [];
  let pushError = null;

  if (accepted.length) {
    const notificationKey = `AREA_ALERT:${id}`;
    const messages = accepted.map((candidate) => ({
      to: candidate.expo_push_token,
      sound: "default",
      title: message(candidate.language, "push.areaAlert.title"),
      body: message(candidate.language, "push.areaAlert.body", {
        item: candidate.report_title || message(candidate.language, "push.areaAlert.itemFallback"),
      }),
      data: {
        type: "AREA_ALERT",
        targetKind: "areaAlert",
        targetId: id,
        campaignId: id,
        notificationKey,
      },
    }));

    try {
      tickets = await expoSend(messages);
    } catch (sendError) {
      pushError = sendError?.message || "EXPO_PUSH_SEND_FAILED";
      console.error("[geo-alert][push-send-failed]", {
        campaignId: id,
        attempted: accepted.length,
        error: pushError,
        details: sendError?.details || null,
      });
      tickets = accepted.map(() => ({
        status: "error",
        message: pushError,
        details: { error: "EXPO_PUSH_SEND_FAILED" },
      }));
    }

    for (let i = 0; i < accepted.length; i++) {
      const candidate = accepted[i];
      const ticket = tickets[i] || {};
      const status = ticket.status === "ok" ? "TICKET_OK" : "TICKET_ERROR";
      const { error: recipientUpdateError } = await supaAdmin
        .from("geo_alert_recipients")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", candidate.recipientRowId);
      if (recipientUpdateError)
        console.error("[geo-alert][recipient-status-update-failed]", {
          campaignId: id,
          recipientRowId: candidate.recipientRowId,
          error: recipientUpdateError.message || String(recipientUpdateError),
        });
      const { error: logError } = await supaAdmin.from("push_delivery_log").insert({
        user_id: candidate.recipient_user_id,
        installation_id: candidate.installation_id,
        expo_push_token: candidate.expo_push_token,
        notification_type: "GEO_ALERT",
        notification_key: notificationKey,
        campaign_id: id,
        expo_ticket_id: ticket.id || null,
        status,
        error_code: ticket?.details?.error || null,
        error_message: ticket?.message || null,
        payload: messages[i],
        updated_at: new Date().toISOString(),
      });
      if (logError)
        console.error("[geo-alert][push-delivery-log-failed]", {
          campaignId: id,
          installationId: candidate.installation_id,
          error: logError.message || String(logError),
        });
    }
  }

  const failed = tickets.filter((ticket) => ticket?.status !== "ok").length;
  const result = {
    ok: true,
    eligible: eligibleUsers,
    notificationsCreated,
    pushEligible: allCandidates.length,
    sent: accepted.length,
    skippedByCap: capped.length,
    skippedAsDuplicate,
    failed,
    pushError,
    tickets,
  };

  console.info("[geo-alert][delivery-summary]", {
    campaignId: id,
    eligibleUsers,
    notificationsCreated,
    pushEligible: allCandidates.length,
    sent: accepted.length,
    skippedByCap: capped.length,
    skippedAsDuplicate,
    failed,
    pushError,
  });

  return result;
}

module.exports = { dispatchAreaAlertCampaign };
