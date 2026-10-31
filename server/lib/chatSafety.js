"use strict";
// T1.9M: report and block in chat. Pure rules here; database access in server/lib/chatSafetyStore.js.

const REPORT_REASONS = ["SCAM", "PERSONAL_DATA", "HARASSMENT", "SPAM", "OTHER"];
// Reports from this many different people within the window suspend the account automatically.
const AUTO_SUSPEND_REPORTERS = 3;
const AUTO_SUSPEND_WINDOW_DAYS = 30;
// Messages copied into a report, newest last.
const SNAPSHOT_MESSAGES = 50;
const DETAILS_MAX = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const CONTEXT_TYPES = { match: "MATCH", observation: "OBSERVATION" };

function contextType(kind) {
  return CONTEXT_TYPES[String(kind || "").toLowerCase()] || null;
}

/** Validates a report from the app. Returns { ok, value } or { ok: false, error }. */
function normalizeReport(input) {
  const reason = String(input?.reason || "").toUpperCase();
  if (!REPORT_REASONS.includes(reason)) return { ok: false, error: "INVALID_REPORT_REASON" };
  const details = String(input?.details ?? "").replace(/\s+/g, " ").trim();
  if (details.length > DETAILS_MAX) return { ok: false, error: "INVALID_REPORT_DETAILS" };
  return { ok: true, value: { reason, details: details || null, block: input?.block !== false } };
}

/** The messages kept as evidence: the last ones, with the sender as reporter or reported user. */
function snapshotMessages(messages, reporterId, max = SNAPSHOT_MESSAGES) {
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(-max).map((m) => ({
    from: m.sender_id === reporterId ? "REPORTER" : "REPORTED",
    body: String(m.body ?? ""),
    at: m.created_at ?? null,
  }));
}

/** Open reports against one user: suspend when enough different people reported within the window. */
function shouldAutoSuspend(openReports, now = Date.now()) {
  const since = now - AUTO_SUSPEND_WINDOW_DAYS * DAY_MS;
  const reporters = new Set();
  for (const r of openReports || []) {
    if (String(r.status || "OPEN") !== "OPEN") continue;
    const at = Date.parse(r.created_at || "");
    if (Number.isFinite(at) && at < since) continue;
    reporters.add(r.reporter_id);
  }
  return reporters.size >= AUTO_SUSPEND_REPORTERS;
}

/**
 * What the app shows for a chat between `me` and `other`.
 * The other side never learns that it is blocked: it only sees that the chat is closed.
 */
function chatState({ me, other, blocks = [], suspendedUserIds = [] }) {
  const blockedByMe = blocks.some((b) => b.blocker_id === me && b.blocked_id === other);
  const blockedByOther = blocks.some((b) => b.blocker_id === other && b.blocked_id === me);
  const selfSuspended = suspendedUserIds.includes(me);
  const otherSuspended = suspendedUserIds.includes(other);
  return {
    blockedByMe,
    selfSuspended,
    closed: blockedByMe || blockedByOther || selfSuspended || otherSuspended,
  };
}

/** Admins are listed by user id in ADMIN_USER_IDS (comma separated) on the server. */
function adminUserIds(env = process.env) {
  return String(env.ADMIN_USER_IDS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[0-9a-f-]{36}$/.test(x));
}

function isAdmin(userId, env = process.env) {
  return !!userId && adminUserIds(env).includes(String(userId).toLowerCase());
}

module.exports = {
  REPORT_REASONS,
  AUTO_SUSPEND_REPORTERS,
  AUTO_SUSPEND_WINDOW_DAYS,
  SNAPSHOT_MESSAGES,
  contextType,
  normalizeReport,
  snapshotMessages,
  shouldAutoSuspend,
  chatState,
  adminUserIds,
  isAdmin,
};
