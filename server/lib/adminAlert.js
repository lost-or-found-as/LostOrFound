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

/** T1.9AY: a reported or hidden case. Push and in-app to admins, plus e-mail when configured. */
async function notifyAdminsContent({ reportId, hidden, reasons = [] }, env = process.env) {
  const reasonText = (lang) => [...new Set(reasons)].map((r) => message(lang, `content.reason.${r}`)).join(", ");
  const key = hidden ? "push.contentReport.bodyHidden" : "push.contentReport.body";
  for (const adminId of adminUserIds()) {
    try {
      await notifyUser({
        userId: adminId,
        type: "CONTENT_REPORT",
        entityType: "report",
        entityId: reportId,
        titles: localizedPair("push.contentReport.title"),
        bodies: { no: message("no", key, { reasons: reasonText("no") }), en: message("en", key, { reasons: reasonText("en") }) },
      });
    } catch (e) {
      console.warn("[content] admin push failed", e?.message || e);
    }
  }
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.ADMIN_ALERT_EMAIL || "").split(",").map((x) => x.trim()).filter(Boolean);
  const from = String(env.ADMIN_ALERT_FROM || "").trim();
  if (!apiKey || !to.length || !from) return;
  const text = message("no", hidden ? "email.contentReport.bodyHidden" : "email.contentReport.body", { reasons: reasonText("no"), reportId });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: message("no", "email.contentReport.subject"), text }),
    });
    if (!r.ok) console.warn("[content] admin e-mail failed", r.status);
  } catch (e) {
    console.warn("[content] admin e-mail failed", e?.message || e);
  }
}

/** T1.9AY: tells the owner (in the app only) that the case is hidden for now. */
async function notifyOwnerHidden(report) {
  await notifyUser({
    userId: report.user_id,
    type: "REPORT_HIDDEN",
    entityType: "report",
    entityId: report.id,
    titles: localizedPair("push.reportHidden.title"),
    bodies: localizedPair("push.reportHidden.body"),
    push: false,
  });
}

/** T1.9AZ: tells the owner (in the app only) that a photo is not shown to others. */
async function notifyImageHeld(row, reason) {
  if (!row?.created_by) return;
  const reasons = localizedPair(`image.held.${reason || "OTHER"}`);
  const bodies = Object.fromEntries(Object.entries(localizedPair("push.imageHeld.body")).map(([l, t]) => [l, `${t} ${reasons[l]}`]));
  await notifyUser({
    userId: row.created_by,
    type: "IMAGE_HELD",
    entityType: "report",
    entityId: row.report_id,
    titles: localizedPair("push.imageHeld.title"),
    bodies,
    push: false,
  });
}

module.exports = { notifyAdmins, adminEmailRequest, notifyAdminsContent, notifyOwnerHidden, notifyImageHeld };
