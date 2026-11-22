"use strict";
// T1.9BM: a chat about a solved case stays open for practical words (a thank-you, where to meet)
// for 7 days after the case was closed, then it can be read but not answered.
const CHAT_DAYS_AFTER_SOLVED = 7;
const DAY = 24 * 60 * 60 * 1000;

/** reports: the case(s) behind the chat. Returns null while no case is closed. */
function solvedChatState(reports, nowMs = Date.now()) {
  const closedTimes = (reports || [])
    .filter((r) => r && (String(r.status || "").toUpperCase() === "CLOSED" || r.closed_at))
    .map((r) => Date.parse(r.closed_at || "") || nowMs);
  if (!closedTimes.length) return null;
  const closesAt = Math.min(...closedTimes) + CHAT_DAYS_AFTER_SOLVED * DAY;
  return { closesAt: new Date(closesAt).toISOString(), closed: nowMs >= closesAt };
}

module.exports = { CHAT_DAYS_AFTER_SOLVED, solvedChatState };
