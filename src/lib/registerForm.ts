// src/lib/registerForm.ts
// T1.9K: rules for the new one-page registration (app/(report)/register.tsx): item search,
// date precision, validation and the request body. Pure, so they are tested without the app.
import {
  CATEGORY_CATALOG,
  ITEM_CATALOG,
  categoryName,
  colorName,
  itemName,
  itemSearchText,
} from "../i18n/catalog";
import { translate, type Lang } from "../i18n/translate";
import type { TranslationKey } from "../i18n/locales/en";
import type { ReportDraft } from "../contexts/ReportDraftContext";
import { reportDescriptionText } from "./reportDescription";

export type ItemHit = { category: string; key: string; name: string; categoryName: string };
export type OccurredPrecision = "EXACT" | "MONTH" | "YEAR";
export type Custody = "WITH_FINDER" | "LEFT_AT_PLACE" | "HANDED_IN";

const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .trim();

/** Items whose name (any language) or alias matches the query; name starts first. */
export function searchItems(query: string, language: Lang, limit = 6): ItemHit[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const hits: { hit: ItemHit; rank: number }[] = [];
  const seen = new Set<string>();
  for (const category of CATEGORY_CATALOG) {
    for (const item of ITEM_CATALOG[category.key] || []) {
      if (item.key === "CUSTOM") continue;
      const id = `${category.key}:${item.key}`;
      if (seen.has(id)) continue;
      const own = fold(item.names[language]);
      const all = fold([itemSearchText(item.key), ...Object.values(item.names), ...(item.aliases || [])].join(" "));
      const rank = own.startsWith(q) ? 0 : own.includes(q) ? 1 : all.includes(q) ? 2 : -1;
      if (rank < 0) continue;
      seen.add(id);
      hits.push({
        rank,
        hit: { category: category.key, key: item.key, name: item.names[language], categoryName: category.names[language] },
      });
    }
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.hit.name.localeCompare(b.hit.name))
    .slice(0, limit)
    .map((h) => h.hit);
}

/** A pet that is not in the list needs its own description ("Hvilket dyr?"). */
export function needsCustomPet(category: string | undefined, key: string | undefined): boolean {
  return String(category) === "PETS" && String(key) === "CUSTOM";
}

/** Stored date for a chosen date and precision: MONTH keeps the 1st, YEAR keeps 1 January. */
export function occurredAtFor(date: Date, precision: OccurredPrecision): string {
  if (precision === "EXACT") return date.toISOString();
  const month = precision === "MONTH" ? date.getMonth() : 0;
  return new Date(Date.UTC(date.getFullYear(), month, 1, 12, 0, 0)).toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const HISTORIC_HINT_DAYS = 365;

export function isLongAgo(iso: string | undefined, now = Date.now()): boolean {
  const when = Date.parse(iso || "");
  return Number.isFinite(when) && now - when >= HISTORIC_HINT_DAYS * DAY_MS;
}

/** Fields still missing before the report can be sent, as text keys (in screen order). */
export function missingFields(draft: ReportDraft, rewardEnabled: boolean): TranslationKey[] {
  const missing: TranslationKey[] = [];
  if (!draft.subcategoryKey) missing.push("register.missing.item");
  if (needsCustomPet(draft.category, draft.subcategoryKey) && !String(draft.subcategoryCustom || "").trim())
    missing.push("register.missing.pet");
  if (!draft.color) missing.push("register.missing.color");
  if (!Number.isFinite(Date.parse(draft.occurredAtISO || ""))) missing.push("register.missing.time");
  if (!draft.location?.confirmed || !String(draft.locationLabel || "").trim()) missing.push("register.missing.place");
  if (draft.type === "FOUND" && draft.custody === "HANDED_IN" && String(draft.custodyPlace || "").trim().length < 2)
    missing.push("register.missing.handedIn");
  if (draft.type === "LOST" && rewardEnabled) {
    const n = Number(draft.rewardNOK || "0");
    if (!Number.isFinite(n) || n < 0) missing.push("register.missing.reward");
  }
  return missing;
}

/** The stored title, as the current registration builds it: "Mistet • Kategori • Gjenstand • …". */
export function reportTitle(draft: ReportDraft, language: Lang): string {
  const type = draft.type === "FOUND" ? translate(language, "report.create.found") : translate(language, "report.create.lost");
  const pet = needsCustomPet(draft.category, draft.subcategoryKey) ? String(draft.subcategoryCustom || "").trim() : "";
  return [
    type,
    categoryName(draft.category, language),
    draft.subcategoryKey && draft.subcategoryKey !== "CUSTOM" ? itemName(draft.subcategoryKey, language, draft.category) : "",
    pet,
    String(draft.brand || "").trim(),
    draft.color ? colorName(draft.color, language) : "",
    draft.colorSecondary && draft.colorSecondary !== draft.color ? colorName(draft.colorSecondary, language) : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

/** POST /reports body. Same fields as the current registration plus custody and date precision. */
export function reportBody(
  draft: ReportDraft,
  options: { language: Lang; rewardEnabled: boolean; clientRequestId: string; testOverrideWeeklyLimit?: boolean },
): Record<string, unknown> {
  const type = draft.type === "FOUND" ? "FOUND" : "LOST";
  const secondary = draft.colorSecondary && draft.colorSecondary !== draft.color ? draft.colorSecondary : undefined;
  const radius = type === "FOUND" ? 10 : draft.location?.radiusMeters;
  // A found item is with the finder unless the finder says otherwise.
  const custody = type === "FOUND" ? draft.custody || "WITH_FINDER" : undefined;
  return {
    type,
    category: String(draft.category || "").trim().toUpperCase(),
    subcategory_key: draft.subcategoryKey ? String(draft.subcategoryKey).trim().toUpperCase() : undefined,
    subcategory_custom: needsCustomPet(draft.category, draft.subcategoryKey)
      ? String(draft.subcategoryCustom || "").trim() || undefined
      : undefined,
    title: reportTitle(draft, options.language),
    description: reportDescriptionText(draft.description) || undefined,
    color: draft.color || undefined,
    secondary_color: secondary,
    brand: String(draft.brand || "").trim() || undefined,
    occurred_at: draft.occurredAtISO,
    occurred_precision: draft.occurredPrecision || "EXACT",
    lat: draft.location?.latitude,
    lng: draft.location?.longitude,
    radius_m: radius ?? undefined,
    location_label: String(draft.locationLabel || "").trim() || undefined,
    search_areas: draft.searchAreas || [],
    ...(type === "LOST" && options.rewardEnabled
      ? { reward_ore: Math.max(0, Math.round(Number(draft.rewardNOK || "0") * 100)) }
      : {}),
    ...(custody ? { custody, custody_place: custody === "HANDED_IN" ? String(draft.custodyPlace || "").trim() : undefined } : {}),
    client_request_id: options.clientRequestId,
    ...(options.testOverrideWeeklyLimit ? { test_override_weekly_limit: true } : {}),
  };
}

/** Reward field text: digits only, no leading zeros ("01000" becomes "1000"). */
export function cleanRewardInput(value: string): string {
  return String(value || "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").replace(/^0$/, "");
}

export function newClientRequestId(): string {
  return `report-${Date.now()}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}
