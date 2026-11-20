"use strict";
// T1.9AW: the optional size on a report, in the user's own words ("M", "38", "128 cm").
// Animals never have one. At most 30 characters, whitespace collapsed.
const { isAnimal } = require("./reportPet");

const MAX_ITEM_SIZE = 30;

/** The size to store, or null (empty, or the report is an animal). */
function normalizeItemSize(category, subcategoryKey, value) {
  if (isAnimal(category, subcategoryKey)) return null;
  const t = String(value ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_ITEM_SIZE) : null;
}

module.exports = { MAX_ITEM_SIZE, normalizeItemSize };
