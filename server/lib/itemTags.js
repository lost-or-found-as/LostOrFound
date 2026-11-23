"use strict";
// T1.9BS: QR tags. Pure helpers (codes, tokens, input checks, limits) so they can be tested
// without a database.
//   code    eight characters without look-alikes (no 0/O, 1/I/L); shown as XXXX-XXXX.
//   token   the finder's secret link to their conversation; only its SHA-256 is stored.
const crypto = require("crypto");

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const KINDS = Object.freeze(["KEYS", "BAG", "WALLET", "PHONE", "BIKE", "PET", "OTHER"]);

const LIMITS = Object.freeze({
  tagsPerOwner: 20,
  // A finder (by visitor key, one per IP and day) can start this many conversations per day.
  threadsPerVisitorPerDay: 3,
  // One tag takes this many new conversations per day, so a leaked code cannot flood the owner.
  threadsPerTagPerDay: 5,
  // Messages from the finder in one conversation per day.
  finderMessagesPerThreadPerDay: 20,
  // Owner replies per minute in one conversation.
  ownerRepliesPerMinute: 10,
  labelMax: 40,
  messageMax: 1000,
  messageMin: 2,
});

function newCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** "abcd-2345" or "ABCD 2345" -> "ABCD2345"; null when it is not a valid code. */
function normalizeCode(input) {
  const raw = String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return CODE_RE.test(raw) ? raw : null;
}

function formatCode(code) {
  const c = String(code || "");
  return c.length === CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

function newFinderToken(randomBytes = crypto.randomBytes) {
  return randomBytes(24).toString("base64url");
}

function validToken(token) {
  return TOKEN_RE.test(String(token || ""));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeKind(input) {
  const k = String(input || "").toUpperCase();
  return KINDS.includes(k) ? k : "OTHER";
}

/** Trimmed label, or null for empty. Too long: cut. */
function normalizeLabel(input) {
  const t = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.labelMax);
  return t || null;
}

/** { ok, body } or { ok: false, code }. Keeps line breaks, removes control characters. */
function normalizeMessage(input) {
  const body = String(input ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (body.length < LIMITS.messageMin) return { ok: false, code: "TAG_MESSAGE_TOO_SHORT" };
  if (body.length > LIMITS.messageMax) return { ok: false, code: "TAG_MESSAGE_TOO_LONG" };
  return { ok: true, body };
}

/** What the public page shows for a tag: UNKNOWN, UNCLAIMED, PAUSED or ACTIVE. */
function tagState(tag) {
  if (!tag) return "UNKNOWN";
  if (!tag.owner_id) return "UNCLAIMED";
  if (!tag.active) return "PAUSED";
  return "ACTIVE";
}

/** Unread for the owner: the last message is from the finder and came after the owner last read. */
function ownerUnread(thread, lastSender) {
  if (lastSender !== "FINDER") return false;
  if (!thread.owner_read_at) return true;
  return new Date(thread.last_message_at).getTime() > new Date(thread.owner_read_at).getTime();
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  KINDS,
  LIMITS,
  newCode,
  normalizeCode,
  formatCode,
  newFinderToken,
  validToken,
  hashToken,
  normalizeKind,
  normalizeLabel,
  normalizeMessage,
  tagState,
  ownerUnread,
};
