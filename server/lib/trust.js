"use strict";
// T1.9BP: rules for control questions, the handover code and thank-you cards (pure functions;
// the database work is in routes/trust.js).
const crypto = require("crypto");

const MAX_QUESTIONS = 3; // per chat
const MAX_ANSWER_TRIES = 3; // per question: you can remember wrong
const MAX_CODE_FAILS = 5;
const CODE_LOCK_MS = 15 * 60 * 1000;
const TEXT_MAX = 140;
const THANKS_DESIGNS = ["HEART", "SUN", "STAR"];

function cleanText(value, max = TEXT_MAX) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A question the helper may ask now: none open, fewer than three asked. */
function canAsk(questions) {
  const list = questions || [];
  if (list.length >= MAX_QUESTIONS) return "QUESTION_LIMIT";
  if (list.some((q) => q.status === "ASKED" || q.status === "ANSWERED")) return "QUESTION_OPEN";
  return "ok";
}

/**
 * The helper judges an answer. Matches: CONFIRMED. Does not match: the owner may try again
 * (status back to ASKED) until three tries are used; then NO_MATCH.
 */
function judge(question, matches) {
  if (!question || question.status !== "ANSWERED") return { error: "QUESTION_NOT_ANSWERED" };
  if (matches) return { status: "CONFIRMED", attempts: question.attempts };
  return question.attempts >= MAX_ANSWER_TRIES ? { status: "NO_MATCH", attempts: question.attempts } : { status: "ASKED", attempts: question.attempts };
}

/** While the latest question is not confirmed, the owner does not see the hand-in place. */
function custodyLocked(questions) {
  const latest = (questions || [])[0];
  return !!latest && latest.status !== "CONFIRMED";
}

function newCode(randomInt = crypto.randomInt) {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

/** "ok", "CODE_LOCKED", "CODE_USED" or "CODE_WRONG"; with the new fail count and lock. */
function checkCode(row, typed, now = Date.now()) {
  if (!row) return { result: "CODE_WRONG", failed: 0, lockedUntil: null };
  if (row.used_at) return { result: "CODE_USED", failed: row.failed_attempts, lockedUntil: row.locked_until };
  if (row.locked_until && new Date(row.locked_until).getTime() > now) return { result: "CODE_LOCKED", failed: row.failed_attempts, lockedUntil: row.locked_until };
  const given = String(typed ?? "").replace(/\D/g, "");
  const right = given.length === 4 && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(row.code)));
  if (right) return { result: "ok", failed: row.failed_attempts, lockedUntil: null };
  const failed = (row.locked_until && new Date(row.locked_until).getTime() <= now ? 0 : row.failed_attempts) + 1;
  const lockedUntil = failed >= MAX_CODE_FAILS ? new Date(now + CODE_LOCK_MS).toISOString() : null;
  return { result: "CODE_WRONG", failed: failed >= MAX_CODE_FAILS ? 0 : failed, lockedUntil };
}

module.exports = {
  MAX_QUESTIONS,
  MAX_ANSWER_TRIES,
  MAX_CODE_FAILS,
  CODE_LOCK_MS,
  TEXT_MAX,
  THANKS_DESIGNS,
  cleanText,
  canAsk,
  judge,
  custodyLocked,
  newCode,
  checkCode,
};
