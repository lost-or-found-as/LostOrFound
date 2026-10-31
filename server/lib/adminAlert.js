"use strict";
// T1.9M: tells the admins about a new chat report: push and in-app notice (always), plus an e-mail
// when RESEND_API_KEY, ADMIN_ALERT_EMAIL and ADMIN_ALERT_FROM are set on the server.
const { notifyUser } = require("./userNotify");
const { message, localizedPair } = require("./messages");
const { adminUserIds } = require("./chatSafety");

function reasonPair(reason) {
  return localizedPair(`safety.reason.${reason}`);
}

/** The Resend request for the admin e-mail, or null when e-mail is not configured. */
function adminEmailRequest({ reason, details, autoSuspended }, env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.ADMIN_ALERT_EMAIL || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const from = String(env.ADMIN_ALERT_FROM || "").trim();
  if (!apiKey || !to.length || !from) return null;
  const text = message("no", "email.safetyReport.body", {
    reason: message("no", `safety.reason.${reason}`),
    details: details || message("no", "email.safetyReport.noDetails"),
    suspended: autoSuspended ? `${message("no", "email.safetyReport.suspended")}\n` : "",
  });
  return {
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: message("no", "email.safetyReport.subject"), text }),
    },
  };
}

async function notifyAdmins({ reportId, reason, details, autoSuspended }) {
  const reasons = reasonPair(reason);
  const bodyKey = autoSuspended ? "push.safetyReport.bodySuspended" : "push.safetyReport.body";
  const bodies = { no: message("no", bodyKey, { reason: reasons.no }), en: message("en", bodyKey, { reason: reasons.en }) };
  for (const adminId of adminUserIds()) {
    try {
      await notifyUser({
        userId: adminId,
        type: "SAFETY_REPORT",
        entityType: "safety_report",
        entityId: reportId,
        titles: localizedPair("push.safetyReport.title"),
        bodies,
      });
    } catch (e) {
      console.warn("[safety] admin push failed", e?.message || e);
    }
  }
  const email = adminEmailRequest({ reason, details, autoSuspended });
  if (!email) return;
  try {
    const r = await fetch(email.url, email.init);
    if (!r.ok) console.warn("[safety] admin e-mail failed", r.status);
  } catch (e) {
    console.warn("[safety] admin e-mail failed", e?.message || e);
  }
}

module.exports = { notifyAdmins, adminEmailRequest };
