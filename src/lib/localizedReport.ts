// src/lib/localizedReport.ts
// Report wording for lists and notifications. Names come from src/i18n/catalog.ts.
import { categoryName, colorName, itemName } from "../i18n/catalog";
import type { Lang } from "../i18n/translate";

export type AppLanguage = Lang;

export function categoryLabel(v: any, l: AppLanguage) {
  return categoryName(v, l);
}

export function itemLabel(v: any, l: AppLanguage, c?: any) {
  return itemName(v, l, c);
}

// "unknown"/"other" carry no information for the reader and are not shown.
export function colorLabel(v: any, l: AppLanguage) {
  const k = String(v || "").trim().toLowerCase();
  if (k === "unknown" || k === "other") return "";
  return colorName(v, l);
}

export function reportSummary(r: any, l: AppLanguage, t: (key: "common.found" | "common.lost") => string) {
  if (!r) return "";
  const type = String(r.type || "").toUpperCase() === "FOUND" ? t("common.found") : t("common.lost");
  return [type, categoryLabel(r.category, l), itemLabel(r.subcategory_key, l, r.category), colorLabel(r.color, l)]
    .filter(Boolean)
    .join(" • ");
}

export function localizeStoredReportTitle(v: any) {
  return String(v || "");
}

export function notificationCaseLabel(r: any, l: AppLanguage, t: (key: "common.found" | "common.lost") => string) {
  if (!r) return "";
  const type = String(r.type || "").toUpperCase() === "FOUND" ? t("common.found") : t("common.lost");
  const color = colorLabel(r.color, l).trim().toLowerCase();
  const item = String(r.subcategory_custom || itemLabel(r.subcategory_key, l, r.category) || "").trim().toLowerCase();
  return [type, color, item].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
