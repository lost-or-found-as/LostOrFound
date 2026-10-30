// server/lib/reportActivity.js
// T1.9G: summary and newest-first timeline for one case, built from rows the route has loaded.
// Pure (no database access) so it can be tested directly.
"use strict";

const { isLiveWatch, isLongTermProduct, yearsOfProduct, paidExtensionCount, EXTENSION_PRODUCT_CODE } = require("./longTermWatch");

// T1.9G: score from which a match counts as strong (the "good" and "excellent" levels in the app).
const STRONG_MATCH_SCORE = 70;
const OPEN_MATCH_STATUSES = new Set(["NEW", "SEEN"]);
const CONFIRMED_MATCH_STATUSES = new Set(["CONFIRMED", "PAID"]);
const ACTIVITY_EVENT_LIMIT = 20;

function latestIso(values) {
  let best = null;
  for (const v of values) {
    const ms = Date.parse(v || "");
    if (Number.isFinite(ms) && (best == null || ms > best)) best = ms;
  }
  return best == null ? null : new Date(best).toISOString();
}

// Pure: builds the summary and the newest-first event list from loaded rows. Exported for tests.
function buildReportActivity({ report, matches, confirmations, lastMessages, unreadByMatch, observations, campaigns, orders, longTermWatch, now = Date.now() }) {
  const open = (matches || []).filter((m) => OPEN_MATCH_STATUSES.has(String(m?.status || "").toUpperCase()));
  const confirmed = (matches || []).filter((m) => CONFIRMED_MATCH_STATUSES.has(String(m?.status || "").toUpperCase()));
  const lastByMatch = new Map((lastMessages || []).map((x) => [String(x.conversation_id), x]));
  const confirmedAt = new Map((confirmations || []).map((x) => [String(x.entity_id), x.created_at]));
  const unread = unreadByMatch || {};

  // The chat to open from the case: the confirmed match with the newest message.
  let chatMatchId = null;
  let chatAt = -1;
  for (const m of confirmed) {
    const at = Date.parse(lastByMatch.get(String(m.id))?.created_at || confirmedAt.get(String(m.id)) || "") || 0;
    if (at > chatAt) {
      chatAt = at;
      chatMatchId = String(m.id);
    }
  }

  const events = [];
  if (report.created_at) events.push({ type: "CREATED", at: report.created_at });
  if (open.length) {
    events.push({
      type: "MATCHES_FOUND",
      at: latestIso(open.map((m) => m.created_at)) || report.created_at,
      count: open.length,
      strong: open.filter((m) => Number(m.score || 0) >= STRONG_MATCH_SCORE).length,
    });
  }
  for (const m of confirmed) {
    const id = String(m.id);
    const at = confirmedAt.get(id);
    if (at) events.push({ type: "MATCH_CONFIRMED", at, matchId: id });
    const last = lastByMatch.get(id);
    if (last?.created_at)
      events.push({
        type: "MESSAGE",
        at: last.created_at,
        matchId: id,
        fromMe: String(last.sender_id) === String(report.user_id),
        unread: Number(unread[id] || 0),
      });
  }
  for (const o of observations || [])
    events.push({ type: "OBSERVATION", at: o.created_at, observationId: o.id, kind: String(o.observation_type || "SEEN").toUpperCase(), isNew: String(o.status || "").toUpperCase() === "NEW" });
  for (const c of campaigns || [])
    if (c.activated_at) events.push({ type: "AREA_ALERT_SENT", at: c.activated_at, radiusM: Number(c.radius_m || 0) || null });
  for (const o of orders || [])
    if (String(o.product_code) === EXTENSION_PRODUCT_CODE && o.paid_at) events.push({ type: "REACTIVATED", at: o.paid_at });
    else if (isLongTermProduct(o.product_code) && o.paid_at) events.push({ type: "LONG_TERM", at: o.paid_at, years: yearsOfProduct(o.product_code) });
  if (report.last_extended_at && String(report.type).toUpperCase() === "FOUND")
    events.push({ type: "EXTENDED", at: report.last_extended_at });
  if (report.closed_at) events.push({ type: "CLOSED", at: report.closed_at });

  const sorted = events
    .filter((e) => Number.isFinite(Date.parse(e.at || "")))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, ACTIVITY_EVENT_LIMIT);

  return {
    summary: {
      possibleMatches: open.length,
      strongMatches: open.filter((m) => Number(m.score || 0) >= STRONG_MATCH_SCORE).length,
      bestScore: open.length ? Math.max(...open.map((m) => Number(m.score || 0))) : null,
      confirmedMatches: confirmed.length,
      unreadMessages: Object.values(unread).reduce((sum, n) => sum + Number(n || 0), 0),
      chatMatchId,
      newObservations: (observations || []).filter((o) => String(o.status || "").toUpperCase() === "NEW").length,
      // T1.9H: lifecycle facts for the historic-case offer.
      paidExtensions: paidExtensionCount(orders),
      longTermUntil: isLiveWatch(longTermWatch, now) ? longTermWatch.current_period_end || null : null,
    },
    events: sorted,
  };
}

module.exports = { buildReportActivity, OPEN_MATCH_STATUSES, CONFIRMED_MATCH_STATUSES, STRONG_MATCH_SCORE };
