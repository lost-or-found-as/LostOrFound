"use strict";
const { supaAdmin } = require("../supabaseClient");

function localized(value, language) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value[language === "en" ? "en" : "no"] || value.no || value.en || "";
}
async function notifyUser({ userId, type, entityType, entityId, title, body, titles, bodies, data = {} }) {
  // T1.9F: in-app text uses the language of the phone the user used most recently.
  const installations = await supaAdmin
    .from("push_installations")
    .select("installation_id,expo_push_token,language,last_seen_at")
    .eq("user_id", userId)
    .eq("active", true)
    .order("last_seen_at", { ascending: false });
  const preferredLanguage = installations.data?.[0]?.language || "no";
  const inAppTitle = localized(titles || title, preferredLanguage);
  const inAppBody = localized(bodies || body, preferredLanguage);
  const inserted = await supaAdmin
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      entity_type: entityType,
      entity_id: entityId,
      title: inAppTitle,
      body: inAppBody,
    })
    .select("id")
    .single();

  if (inserted.error) console.warn("[notify] in-app failed", inserted.error.message);

  const q = await supaAdmin
    .from("push_installations")
    .select("installation_id,expo_push_token,language")
    .eq("user_id", userId)
    .eq("active", true);

  if (q.error || !q.data?.length) return { inApp: !inserted.error, push: 0 };

  const deliveries = q.data.map((x) => ({
    installation: x,
    message: {
      to: x.expo_push_token,
      sound: "default",
      title: localized(titles || title, x.language),
      body: localized(bodies || body, x.language),
      data: { type, targetKind: entityType, targetId: entityId, ...data },
    },
  }));

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(deliveries.map((x) => x.message)),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn("[notify] push failed", result);
    return { inApp: !inserted.error, push: 0 };
  }

  const tickets = Array.isArray(result?.data) ? result.data : [];
  const now = new Date().toISOString();
  const rows = deliveries.map((delivery, index) => {
    const ticket = tickets[index] || {};
    const ok = ticket.status === "ok";
    return {
      user_id: userId,
      installation_id: delivery.installation.installation_id,
      notification_type: type,
      notification_key: `${type}:${entityType}:${entityId}:${inserted.data?.id || now}:${delivery.installation.installation_id}`,
      status: ok ? "TICKET_OK" : "TICKET_ERROR",
      expo_ticket_id: ticket.id || null,
      error_code: ticket?.details?.error || null,
      error_message: ticket?.message || null,
      created_at: now,
    };
  });

  if (rows.length) {
    const logged = await supaAdmin.from("push_delivery_log").insert(rows);
    if (logged.error) console.warn("[notify] delivery log failed", logged.error.message);
  }

  return {
    inApp: !inserted.error,
    push: rows.filter((row) => row.status === "TICKET_OK").length,
    tickets,
  };
}

module.exports = { notifyUser };
