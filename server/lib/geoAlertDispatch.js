"use strict";
const { supaAdmin } = require("../supabaseClient");

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

  const { data: eligibleUsers, error: eligibleUsersError } = await supaAdmin.rpc(
    "geo_alert_eligible_users",
    { p_campaign_id: id },
  );
  if (eligibleUsersError) throw eligibleUsersError;

  for (const candidate of eligibleUsers || []) {
    const notificationKey = `AREA_ALERT:${id}:${candidate.recipient_user_id}`;
    const { error: notificationError } = await supaAdmin
      .from("notifications")
      .insert({
        user_id: candidate.recipient_user_id,
        type: "AREA_ALERT",
        entity_type: "area_alert_campaign",
        entity_id: id,
        title: "AREA_ALERT",
        body: candidate.report_title || "AREA_ALERT",
        notification_key: notificationKey,
        agg_count: 1,
      });
    if (notificationError && notificationError.code !== "23505") throw notificationError;
  }

  const { data: candidates, error: candidateError } = await supaAdmin.rpc(
    "geo_alert_eligible_installations",
    { p_campaign_id: id },
  );
  if (candidateError) throw candidateError;

  const accepted = [];
  for (const candidate of candidates || []) {
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
    if (recipient)
      accepted.push({ ...candidate, recipientRowId: recipient.id });
  }

  if (!accepted.length) {
    return {
      ok: true,
      eligible: (eligibleUsers || []).length,
      pushEligible: (candidates || []).length,
      sent: 0,
      skippedAsDuplicate: (candidates || []).length,
      tickets: [],
    };
  }

  const notificationKey = `AREA_ALERT:${id}`;
  const messages = accepted.map((candidate) => ({
    to: candidate.expo_push_token,
    sound: "default",
    title:
      candidate.language === "en"
        ? "Lost item near you"
        : "Mistet gjenstand i området ditt",
    body:
      candidate.language === "en"
        ? `${candidate.report_title || "An item"} was reported lost near an area you follow.`
        : `${candidate.report_title || "En gjenstand"} er meldt mistet nær et område du følger.`,
    data: {
      type: "AREA_ALERT",
      targetKind: "areaAlert",
      targetId: id,
      campaignId: id,
      notificationKey,
    },
  }));

  const tickets = await expoSend(messages);
  for (let i = 0; i < accepted.length; i++) {
    const candidate = accepted[i];
    const ticket = tickets[i] || {};
    const status = ticket.status === "ok" ? "TICKET_OK" : "TICKET_ERROR";
    await supaAdmin
      .from("geo_alert_recipients")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", candidate.recipientRowId);
    await supaAdmin.from("push_delivery_log").insert({
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
  }

  console.info("[geo-alert][recipient-summary]", {
    campaignId,
    candidates: (candidates || []).length,
    sent: accepted.length,
    skippedAsDuplicate: (candidates || []).length - accepted.length,
    failed: tickets.filter((ticket) => ticket?.status !== "ok").length,
  });

  console.info("[geo-alert][delivery-summary]", {
    campaignId,
    result: {
      sent: accepted.length,
      skippedAsDuplicate: (candidates || []).length - accepted.length,
      failed: tickets.filter((ticket) => ticket?.status !== "ok").length,
    },
  });

  return {
    ok: true,
    eligible: (eligibleUsers || []).length,
      pushEligible: (candidates || []).length,
    sent: accepted.length,
    skippedAsDuplicate: (candidates || []).length - accepted.length,
    tickets,
  };
}

module.exports = { dispatchAreaAlertCampaign };
