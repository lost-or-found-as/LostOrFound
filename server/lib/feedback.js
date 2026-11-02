"use strict";
// T1.9V: feedback from users (ideas, bugs, praise). Stored in public.app_feedback and sent to the
// admins by push and e-mail. Pure helpers here; the route is server/routes/feedback.js.
const { message } = require("./messages");

const FEEDBACK_KINDS = Object.freeze(["IDEA", "BUG", "PRAISE", "OTHER"]);
const MAX_MESSAGE = 2000;
const DAILY_LIMIT = { user: 5, guest: 2 };

const clip = (v, n) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
};

/** { ok: true, value } or { ok: false, error }. */
function normalizeFeedback(body) {
  const kind = String(body?.kind ?? "").trim().toUpperCase();
  if (!FEEDBACK_KINDS.includes(kind)) return { ok: false, error: "INVALID_FEEDBACK_KIND" };
  const text = String(body?.message ?? "").trim();
  if (text.length < 3) return { ok: false, error: "FEEDBACK_TOO_SHORT" };
  if (text.length > MAX_MESSAGE) return { ok: false, error: "FEEDBACK_TOO_LONG" };
  return {
    ok: true,
    value: {
      kind,
      message: text,
      app_version: clip(body?.appVersion, 40),
      platform: clip(body?.platform, 20),
      os_version: clip(body?.osVersion, 40),
      device_model: clip(body?.deviceModel, 80),
      language: clip(body?.language, 10),
    },
  };
}

/** The Resend request for the admin e-mail, or null when e-mail is not configured. */
function feedbackEmailRequest(item, env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.ADMIN_ALERT_EMAIL || "").split(",").map((x) => x.trim()).filter(Boolean);
  const from = String(env.ADMIN_ALERT_FROM || "").trim();
  if (!apiKey || !to.length || !from) return null;
  const meta = [item.platform, item.os_version, item.device_model, item.app_version, item.language].filter(Boolean).join(" · ");
  const text = message("no", "email.feedback.body", {
    kind: message("no", `feedback.kind.${item.kind}`),
    message: item.message,
    meta: meta || "-",
    guest: item.guest ? message("no", "email.feedback.guest") : "",
  });
  return {
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        reply_to: item.replyTo || undefined,
        subject: message("no", "email.feedback.subject", { kind: message("no", `feedback.kind.${item.kind}`) }),
        text,
      }),
    },
  };
}

module.exports = { FEEDBACK_KINDS, MAX_MESSAGE, DAILY_LIMIT, normalizeFeedback, feedbackEmailRequest };
