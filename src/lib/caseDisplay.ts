// src/lib/caseDisplay.ts
// How a report is named in lists ("My cases", matches, notifications).
// The title is the item only, with a capital first letter. Colour and brand are shown as
// separate attributes, so Norwegian adjectives never need gender agreement. Known Norwegian
// compound words (gullring, sølvklokke) are kept; English uses two words (Gold ring).
import { colorLabel, itemLabel, categoryLabel, type AppLanguage } from "./localizedReport";

type CaseLike = {
  type?: string | null;
  title?: string | null;
  category?: string | null;
  subcategory_key?: string | null;
  subcategory_custom?: string | null;
  color?: string | null;
  brand?: string | null;
};

const METALS = ["gold", "silver", "bronze"] as const;
type Metal = (typeof METALS)[number];

const METAL_COMPOUNDS_NO: Record<Metal, Record<string, string>> = {
  gold: {
    RING: "Gullring", WEDDING_RING: "Gullgiftering", ENGAGEMENT_RING: "Gullforlovelsesring",
    SIGNET_RING: "Gullsignetring", WATCH: "Gullklokke", BRACELET: "Gullarmbånd",
    NECKLACE: "Gullhalskjede", EARRINGS: "Gulløredobber", PENDANT: "Gullanheng",
    BROOCH: "Gullbrosje", CUFFLINKS: "Gullmansjettknapper",
  },
  silver: {
    RING: "Sølvring", WEDDING_RING: "Sølvgiftering", ENGAGEMENT_RING: "Sølvforlovelsesring",
    SIGNET_RING: "Sølvsignetring", WATCH: "Sølvklokke", BRACELET: "Sølvarmbånd",
    NECKLACE: "Sølvhalskjede", EARRINGS: "Sølvøredobber", PENDANT: "Sølvanheng",
    BROOCH: "Sølvbrosje", CUFFLINKS: "Sølvmansjettknapper",
  },
  bronze: {
    RING: "Bronsering", WATCH: "Bronseklokke", BRACELET: "Bronsearmbånd",
    NECKLACE: "Bronsehalskjede", PENDANT: "Bronseanheng",
  },
};
const METAL_EN: Record<Metal, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

const MONTHS: Record<AppLanguage, string[]> = {
  no: ["jan.", "feb.", "mars", "apr.", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

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
  if (language === "no") return METAL_COMPOUNDS_NO[metal][key] ?? null;
  if (!METAL_COMPOUNDS_NO[metal][key]) return null;
  return `${METAL_EN[metal]} ${itemLabel(key, "en", r.category).toLocaleLowerCase()}`;
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

// "Flerfarget" / "Gull · Pandora" (colour is left out when it is part of the title)
export function caseAttributes(r: CaseLike, language: AppLanguage): string {
  const parts: string[] = [];
  if (r.color && !compoundTitle(r, language)) parts.push(sentenceCase(colorLabel(r.color, language)));
  const brand = titleCaseWords(r.brand);
  if (brand) parts.push(brand);
  return parts.join(" · ");
}

// "29. okt. 2026" / "29 Oct 2026"
export function formatCaseDate(iso: string | null | undefined, language: AppLanguage): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const month = MONTHS[language][d.getMonth()];
  return language === "no" ? `${day}. ${month} ${d.getFullYear()}` : `${day} ${month} ${d.getFullYear()}`;
}
