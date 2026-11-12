"use strict";
// T1.9Y: a short, one-language description of a report for push texts, for example
// "Ball (gul, Wilson)" / "Ball (yellow, Wilson)". Built from the stored keys in the recipient's
// language, never from reports.title (which is stored in the reporter's language).
// Names come from server/data/itemCatalog.json, generated from the app catalog.
const catalog = require("../data/itemCatalog.json");
const { canonicalItemKey } = require("./itemKeys");
const { normalizeMainColor } = require("./colorKeys");

const { normalizeLanguage } = require("./languages");

const lang = (language) => normalizeLanguage(language);
// A draft language without a catalog name uses the English name.
const named = (entry, l) => entry[l] || entry.en || entry.no;
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function itemPart(report, l) {
  const custom = clean(report.subcategory_custom);
  if (custom) return custom.charAt(0).toUpperCase() + custom.slice(1);
  const key = canonicalItemKey(report.subcategory_key);
  if (key && key !== "CUSTOM" && catalog.items[key]) return named(catalog.items[key], l);
  const category = String(report.category ?? "").trim().toUpperCase();
  if (category && catalog.categories[category]) return named(catalog.categories[category], l);
  return "";
}

/** "Ball (gul, Wilson)"; empty string when the report says nothing usable. */
function reportItemText(report, language) {
  if (!report) return "";
  const l = lang(language);
  const item = itemPart(report, l);
  if (!item) return "";
  const colorKey = String(normalizeMainColor(report.color) ?? "").trim().toLowerCase();
  const color = colorKey && colorKey !== "unknown" && catalog.colors[colorKey] ? named(catalog.colors[colorKey], l).toLowerCase() : "";
  const brand = clean(report.brand).slice(0, 40);
  const extra = [color, brand].filter(Boolean).join(", ");
  return extra ? `${item} (${extra})` : item;
}

module.exports = { reportItemText };
