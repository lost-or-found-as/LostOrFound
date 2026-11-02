"use strict";
// T1.9F: colour keys the app stores in reports.color and reports.secondary_color.
// The names shown to users live in the app catalog (src/i18n/catalog.ts); the database check
// constraint in 20261030150000_t1_9f_secondary_color_and_chat_reads.sql uses the same list.
// scripts/test-t1-9f.js checks that all three agree.
const COLOR_KEYS = Object.freeze([
  "black", "white", "gray", "red", "orange", "yellow", "green", "blue", "purple", "brown", "pink",
  "beige", "navy", "light-blue", "turquoise", "burgundy", "olive",
  "gold", "silver", "bronze", "camo", "multicolor", "patterned", "unknown", "other",
]);

// T1.9U: colours folded into a neighbour. Older app builds can still send them.
const LEGACY_COLOR_KEYS = Object.freeze({ lime: "green", cyan: "turquoise", magenta: "pink" });

/** Main colour as stored: an older colour key becomes its replacement; anything else is kept. */
function normalizeMainColor(value) {
  if (value == null || value === "") return null;
  const key = String(value).trim().toLowerCase();
  return LEGACY_COLOR_KEYS[key] || value;
}

/** A stored colour key, or null for empty input. Throws INVALID_SECONDARY_COLOR otherwise. */
function normalizeSecondaryColor(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  const key = LEGACY_COLOR_KEYS[raw] || raw;
  if (!COLOR_KEYS.includes(key)) {
    const error = new Error("INVALID_SECONDARY_COLOR");
    error.code = "INVALID_SECONDARY_COLOR";
    throw error;
  }
  return key;
}

module.exports = { COLOR_KEYS, LEGACY_COLOR_KEYS, normalizeMainColor, normalizeSecondaryColor };
