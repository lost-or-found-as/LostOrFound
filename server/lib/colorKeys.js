"use strict";
// T1.9F: colour keys the app stores in reports.color and reports.secondary_color.
// The names shown to users live in the app catalog (src/i18n/catalog.ts); the database check
// constraint in 20261030150000_t1_9f_secondary_color_and_chat_reads.sql uses the same list.
// scripts/test-t1-9f.js checks that all three agree.
const COLOR_KEYS = Object.freeze([
  "black", "white", "gray", "red", "orange", "yellow", "green", "blue", "purple", "brown", "pink",
  "beige", "navy", "light-blue", "turquoise", "burgundy", "lime", "cyan", "magenta", "olive",
  "gold", "silver", "bronze", "camo", "multicolor", "patterned", "unknown", "other",
]);

/** A stored colour key, or null for empty input. Throws INVALID_SECONDARY_COLOR otherwise. */
function normalizeSecondaryColor(value) {
  if (value == null || value === "") return null;
  const key = String(value).trim().toLowerCase();
  if (!COLOR_KEYS.includes(key)) {
    const error = new Error("INVALID_SECONDARY_COLOR");
    error.code = "INVALID_SECONDARY_COLOR";
    throw error;
  }
  return key;
}

module.exports = { COLOR_KEYS, normalizeSecondaryColor };
