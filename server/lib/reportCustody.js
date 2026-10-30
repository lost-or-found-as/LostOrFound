// server/lib/reportCustody.js
// T1.9K: where a found item is now ("Hvor er gjenstanden nå?"), and how precisely a loss date
// is known. Pure helpers, no database access.
"use strict";

const CUSTODY_VALUES = Object.freeze(["WITH_FINDER", "LEFT_AT_PLACE", "HANDED_IN"]);
const CUSTODY_PLACE_MAX = 200;
const PRECISION_VALUES = Object.freeze(["EXACT", "MONTH", "YEAR"]);
const CONFIRMED_MATCH_STATUSES = new Set(["CONFIRMED", "PAID"]);

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * Custody for a report. Only FOUND reports have one; for LOST both fields are null.
 * HANDED_IN needs the place it was handed in to; the other values never keep a place.
 * Throws INVALID_CUSTODY or CUSTODY_PLACE_REQUIRED.
 */
function normalizeCustody(type, custody, place) {
  if (String(type || "").toUpperCase() !== "FOUND") return { custody: null, custody_place: null };
  if (custody == null || custody === "") return { custody: null, custody_place: null };
  const value = String(custody).trim().toUpperCase();
  if (!CUSTODY_VALUES.includes(value)) throw codedError("INVALID_CUSTODY");
  if (value !== "HANDED_IN") return { custody: value, custody_place: null };
  const text = String(place ?? "").trim().slice(0, CUSTODY_PLACE_MAX);
  if (text.length < 2) throw codedError("CUSTODY_PLACE_REQUIRED");
  return { custody: value, custody_place: text };
}

/**
 * How precisely the loss or find date is known. MONTH and YEAR keep the year (and month), so a
 * historic case can say "summer 2019" without a made-up day. Throws INVALID_OCCURRED_PRECISION.
 */
function normalizeOccurredPrecision(precision, occurredAt) {
  if (precision == null || precision === "") return {};
  const value = String(precision).trim().toUpperCase();
  if (!PRECISION_VALUES.includes(value)) throw codedError("INVALID_OCCURRED_PRECISION");
  const when = new Date(occurredAt);
  if (Number.isNaN(when.getTime())) throw codedError("INVALID_OCCURRED_PRECISION");
  return {
    occurred_precision: value,
    occurred_year: value === "EXACT" ? null : when.getUTCFullYear(),
    occurred_month: value === "MONTH" ? when.getUTCMonth() + 1 : null,
  };
}

/**
 * The hand-in place is shown to the other party only after the owner has confirmed the match,
 * like the exact location. Before that, the custody value alone ("Levert inn") is shown.
 */
function redactCustodyForViewer(match, viewerId) {
  if (!match?.found || match.found.user_id === viewerId) return match;
  if (CONFIRMED_MATCH_STATUSES.has(String(match.status || "").toUpperCase())) return match;
  if (match.found.custody_place == null) return match;
  return { ...match, found: { ...match.found, custody_place: null } };
}

module.exports = {
  CUSTODY_VALUES,
  CUSTODY_PLACE_MAX,
  normalizeCustody,
  normalizeOccurredPrecision,
  redactCustodyForViewer,
};
