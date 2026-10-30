// src/lib/caseDisplay.ts
// How a report is named in lists ("My cases", matches, notifications).
// The title is the item only, with a capital first letter. Colour and brand are shown as
// separate attributes, so Norwegian adjectives never need gender agreement. Known Norwegian
// compound words (gullring, sølvklokke) are kept; English uses two words (Gold ring).
import { colorLabel, itemLabel, categoryLabel, type AppLanguage } from "./localizedReport";
import { METAL_COMPOUND_NAMES, colorName } from "../i18n/catalog";
import { translate } from "../i18n/translate";
import { formatDate } from "../i18n/formatters";
import { reportSecondaryColor } from "./reportDescription";

type CaseLike = {
  type?: string | null;
  title?: string | null;
  category?: string | null;
  subcategory_key?: string | null;
  subcategory_custom?: string | null;
  color?: string | null;
  secondary_color?: string | null;
  description?: string | null;
  brand?: string | null;
};

const METALS = ["gold", "silver", "bronze"] as const;
type Metal = (typeof METALS)[number];


export function sentenceCase(value?: string | null): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function titleCaseWords(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase())
    .join(" ");
}

function metalOf(r: CaseLike): Metal | null {
  const c = String(r.color ?? "").trim().toLowerCase();
  return (METALS as readonly string[]).includes(c) ? (c as Metal) : null;
}

function compoundTitle(r: CaseLike, language: AppLanguage): string | null {
  const metal = metalOf(r);
  const key = String(r.subcategory_key ?? "").toUpperCase();
  if (!metal || !key) return null;
  // Only items that have a metal version (rings, watches, jewellery) get a combined title.
  if (!METAL_COMPOUND_NAMES.no?.[metal]?.[key]) return null;
  const compound = METAL_COMPOUND_NAMES[language]?.[metal]?.[key];
  if (compound) return compound;
  return sentenceCase(
    translate(language, "catalog.metalItem", {
      metal: colorName(metal, language),
      item: itemLabel(key, language, r.category).toLocaleLowerCase(),
    }),
  );
}

// "Toalettmappe" / "Toiletry bag" / "Gullring" / "Gold ring"
export function caseTitle(r: CaseLike, language: AppLanguage): string {
  const compound = compoundTitle(r, language);
  if (compound) return compound;
  const custom = String(r.subcategory_custom ?? "").trim();
  if (custom) return sentenceCase(custom);
  const key = String(r.subcategory_key ?? "").trim();
  if (key && key.toUpperCase() !== "CUSTOM") return sentenceCase(itemLabel(key, language, r.category));
  if (r.category) return sentenceCase(categoryLabel(r.category, language));
  return sentenceCase(r.title);
}

// Main and secondary colour as one phrase: "Rød og gul". `main` is the already-named main colour
// (empty when it is left out).
function colorsText(main: string, r: CaseLike, language: AppLanguage): string {
  const secondKey = reportSecondaryColor(r);
  const second =
    secondKey && secondKey !== String(r.color ?? "").trim().toLowerCase() ? colorLabel(secondKey, language) : "";
  const colors =
    main && second
      ? translate(language, "catalog.colorPair", { first: main, second: second.toLocaleLowerCase() })
      : main || second;
  return sentenceCase(colors);
}

// T1.9G: both colours for the details card, "Rød og gul" (also when the colour is in the title).
export function caseColors(r: CaseLike, language: AppLanguage): string {
  return colorsText(r.color ? colorLabel(r.color, language) : "", r, language);
}

// "Flerfarget" / "Rød og gul · Pandora" (colour is left out when it is part of the title)
export function caseAttributes(r: CaseLike, language: AppLanguage): string {
  const parts: string[] = [];
  // T1.9F: main and secondary colour together, "Rød og gul". The main colour is left out when
  // it is part of the title (Gullring).
  const main = r.color && !compoundTitle(r, language) ? colorLabel(r.color, language) : "";
  const colors = colorsText(main, r, language);
  if (colors) parts.push(colors);
  const brand = titleCaseWords(r.brand);
  if (brand) parts.push(brand);
  return parts.join(" · ");
}

// "29. okt. 2026" / "29 Oct 2026"
export function formatCaseDate(iso: string | null | undefined, language: AppLanguage): string {
  return formatDate(iso, language);
}
