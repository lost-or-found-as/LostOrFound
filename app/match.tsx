// app/match.tsx
// Match list: premium header, latest-message status, sender, and unread indicator.
// Behavior: reportId identifies the current case; chat opens only when status is CONFIRMED.
import { requireAccount } from "../src/ui/AccountRequired";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  FlatList,
  Alert,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Pressable,
} from "react-native";
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  useFocusEffect,
} from "expo-router";
import { API_BASE_URL } from "../src/lib/config";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/contexts/AuthContext";
import { getLastSeenMap } from "../src/lib/unread";
import {
  CATEGORIES,
  SUBCATEGORIES,
  OBJECT_LABELS_EN,
  objectLabel,
  objectSearchText,
} from "../src/lib/categories";
import { theme } from "../src/ui/theme";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { AuthHeaderAction } from "../src/ui/AuthHeaderAction";
import { useI18n } from "../src/i18n/I18nProvider";

import { en } from "../src/i18n/locales/en";
import { no } from "../src/i18n/locales/no";
import type { TranslationKey } from "../src/i18n/locales/en";
function tr(language: "no" | "en", key: TranslationKey): string {
  return language === "en" ? en[key] : no[key];
}

type Reason = { k: string; v: any };
type ReportLite = {
  id: string;
  type?: "LOST" | "FOUND";
  category?: string;
  subcategory_key?: string;
  title?: string;
  description?: string | null;
  color?: string | null;
  brand?: string | null;
  occurred_at?: string | null;
  created_at?: string;
  lat?: number | null;
  lng?: number | null;
  location_label?: string | null;
  radius_m?: number | null;
  search_radius_m?: number | null;
  area_radius_m?: number | null;
  location_radius_m?: number | null;
  reward_ore?: number | null;
  report_images?: { path: string; sort_order?: number }[];
};
type Match = {
  id: string;
  score: number;
  status: "NEW" | "SEEN" | "DISMISSED" | "CONFIRMED";
  reasons: Reason[];
  lost: ReportLite;
  found: ReportLite;
};
type LastMsg = {
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type AppLang = "no" | "en";

const SUBCATEGORY_LABELS_EN: Record<string, string> = {
  ...OBJECT_LABELS_EN,
  KEYS: "Keys",
  WALLET: "Wallet",
  MOBILE_PHONE: "Mobile phone",
  SUNGLASSES: "Sunglasses",
  GLASSES: "Glasses",
  BANK_CARD: "Bank card",
  ID_CARD: "ID card",
  PASSPORT: "Passport",
  DRIVER_LICENSE: "Driver license",
  HEARING_AID: "Hearing aid",
  OTHER_PERSONAL: "Other personal item",
  HEADPHONES: "Headphones / AirPods",
  SMARTWATCH: "Smartwatch",
  TABLET: "Tablet",
  LAPTOP: "Laptop",
  POWERBANK: "Power bank",
  CAMERA: "Camera",
  OTHER_ELECTRONICS: "Other electronics",
  BACKPACK: "Backpack",
  HANDBAG: "Handbag",
  SUITCASE: "Suitcase",
  GYM_BAG: "Gym bag",
  LAPTOP_BAG: "Laptop bag",
  SHOULDER_BAG: "Shoulder bag",
  DOCUMENT_BRIEFCASE: "Document case",
  SCHOOL_BAG: "School bag",
  TRAVEL_LUGGAGE: "Travel luggage",
  TOTE_BAG: "Tote bag",
  OTHER_BAGS: "Other bag/luggage",
  JACKET: "Jacket",
  HAT: "Hat",
  GLOVES: "Gloves",
  SCARF: "Scarf",
  BELT: "Belt",
  SHOES: "Shoes",
  UMBRELLA: "Umbrella",
  OTHER_CLOTHING: "Other clothing/accessory",
  RING: "Ring",
  EARRINGS: "Earrings",
  NECKLACE: "Necklace",
  BRACELET: "Bracelet",
  WATCH: "Watch",
  OTHER_JEWELRY: "Other jewelry",
  TOOLS: "Tools",
  OTHER_TOOLS: "Other tools",
  CAR_KEYS: "Car keys",
  BICYCLE: "Bicycle",
  SCOOTER: "Scooter",
  OTHER_VEHICLE: "Other vehicle/transport",
  FOOTBALL: "Football",
  TENNIS_RACKET: "Tennis racket",
  FISHING_ROD: "Fishing rod",
  HEADLAMP: "Headlamp",
  CAMPING_GEAR: "Camping gear",
  SKIS: "Skis",
  SNOWBOARD: "Snowboard",
  HELMET: "Helmet",
  GOGGLES: "Goggles",
  WATER_BOTTLE: "Water bottle",
  OTHER_SPORT: "Other sport/outdoor item",
  BOOK: "Book",
  OTHER_HOBBY: "Other culture/hobby item",
  DOG: "Dog",
  CAT: "Cat",
  BIRD: "Bird",
  RABBIT: "Rabbit",
  OTHER_PET: "Other pet",
  CUSTOM: "Custom",
};

const CATEGORY_LABELS_EN: Record<string, string> = {
  PERSONAL: "Personal items",
  ELECTRONICS: "Electronics",
  BAGS_LUGGAGE: "Bags and luggage",
  CLOTHING_ACCESSORIES: "Clothing and accessories",
  JEWELRY: "Jewelry",
  TOOLS_HOUSE: "Tools",
  VEHICLE_TRANSPORT: "Vehicle / transport",
  SPORT_OUTDOOR: "Sport and outdoor",
  CULTURE_HOBBY: "Culture and hobby",
  PETS: "Pets",
};

function localizeCategoryLabel(cat?: string, language: AppLang = "no") {
  if (!cat) return null;
  if (language === "en") return CATEGORY_LABELS_EN[cat] ?? cat;
  return (
    CATEGORIES.find((c: { value: string; label: string }) => c.value === cat)
      ?.label ?? cat
  );
}

function localizeSubcategoryLabel(
  cat?: string,
  sub?: string,
  language: AppLang = "no",
) {
  if (!cat || !sub) return null;
  if (language === "en") return SUBCATEGORY_LABELS_EN[sub] ?? sub;
  const list = (SUBCATEGORIES as any)[cat] ?? [];
  return list.find((s: any) => s.value === sub)?.label ?? sub;
}

function colorLabelOldUnused(v?: string | null) {
  return colorLabel(v, "no");
}

function scoreLabelOldUnused(score: number) {
  return scoreLabel(score, "no");
}

function statusLabelText(s: string, language: AppLang = "no") {
  const no: Record<string, string> = {
    NEW: "Ny",
    SEEN: "Sett",
    DISMISSED: "Avvist",
    CONFIRMED: "Bekreftet",
  };
  const en: Record<string, string> = {
    NEW: "New",
    SEEN: "Seen",
    DISMISSED: "Dismissed",
    CONFIRMED: "Confirmed",
  };
  return (language === "en" ? en : no)[s] ?? s;
}

function formatDaysOldUnused(days: any) {
  return formatDays(days, "no");
}

function timeAgoLongOldUnused(iso?: string | null) {
  return timeAgoLong(iso, "no");
}

function lowerForPhrase(
  value: string | null | undefined,
  language: AppLang = "no",
) {
  if (!value) return null;
  return language === "en" ? value.toLowerCase() : value.toLowerCase();
}

function reasonVal(reasons: Reason[] | undefined, key: string) {
  return (reasons ?? []).find((r) => r?.k === key)?.v;
}
function scoreLabel(score: number, language: AppLang = "no") {
  if (language === "en") {
    if (score >= 85) return "Excellent match";
    if (score >= 70) return "Good match";
    if (score >= 55) return "Possible match";
    return "Low match";
  }
  if (score >= 85) return "Svært godt treff";
  if (score >= 70) return "Godt treff";
  if (score >= 55) return "Mulig treff";
  return "Lavt samsvar";
}
function scoreLevel(score: number) {
  // 1 = low (hidden), 2 = possible, 3 = likely, 4 = very likely
  if (score >= 85) return 4;
  if (score >= 70) return 3;
  if (score >= 55) return 2;
  return 1;
}
function bannerTone(level: number) {
  switch (level) {
    case 4:
      return { bg: "#166534", fg: "#fff" }; // dark green
    case 3:
      return { bg: "#15803D", fg: "#fff" }; // green
    case 2:
      return { bg: "#F59E0B", fg: "#111" }; // amber
    default:
      return { bg: "#64748B", fg: "#fff" }; // slate (normally hidden)
  }
}
function reportCore(rep: any, language: AppLang = "no") {
  const sub = subcategoryLabel(rep?.category, rep?.subcategory_key, language);
  const col = colorLabel(rep?.color, language);
  const brand = titleCase(rep?.brand);
  const parts = [col, sub].filter(Boolean).map((x) => String(x).trim());
  const core = parts.length ? parts.join(" ") : (rep?.title ?? "");
  return brand ? core + " (" + brand + ")" : core;
}
function timeAgoShort(iso?: string | null, language: AppLang = "no") {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return tr(language, "match.now");
  if (min < 60) return String(min) + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return String(h) + " h";
  const days = Math.floor(h / 24);
  return String(days) + " d";
}
function pickReasons(m: Match, language: AppLang = "no") {
  const dist = formatDistance(reasonVal(m.reasons, "distance_m"));
  const days = formatDays(reasonVal(m.reasons, "days_apart"), language);
  const txt = formatTextSim(reasonVal(m.reasons, "text_sim"));
  const lostLabel = reportCore(m.lost, language);
  const foundLabel = reportCore(m.found, language);
  const lines: { icon: string; text: string }[] = [];
  if (lostLabel) lines.push({ icon: "✓", text: lostLabel });
  if (foundLabel) lines.push({ icon: "✓", text: foundLabel });
  if (dist)
    lines.push({
      icon: "✓",
      text: language === "en" ? dist + " away" : dist + " unna",
    });
  if (days) lines.push({ icon: "✓", text: tr(language, "match.time") + days });
  if (lines.length < 4 && txt)
    lines.push({ icon: "✓", text: tr(language, "match.text") + txt });
  return lines.slice(0, 4);
}
function statusLabel(s: any, language: AppLang = "no") {
  const no: Record<string, string> = {
    NEW: "Ny",
    SEEN: "Sett",
    DISMISSED: "Avvist",
    CONFIRMED: "Bekreftet",
  };
  const en: Record<string, string> = {
    NEW: "New",
    SEEN: "Seen",
    DISMISSED: "Dismissed",
    CONFIRMED: "Confirmed",
  };
  return (language === "en" ? en : no)[String(s)] ?? String(s);
}
function formatDistance(meters: any) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`;
  return `${Math.round(n)} m`;
}
function formatDays(days: any, language: AppLang = "no") {
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return tr(language, "match.today");
  return n.toFixed(1) + " d";
}
function formatTextSim(sim: any) {
  const n = Number(sim);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}
function colorLabel(v?: string | null, language: AppLang = "no") {
  if (!v) return null;
  const key = String(v).toLowerCase();
  const no: Record<string, string> = {
    black: "Svart",
    white: "Hvit",
    gray: "Grå",
    grey: "Grå",
    red: "Rød",
    orange: "Oransje",
    yellow: "Gul",
    green: "Grønn",
    blue: "Blå",
    purple: "Lilla",
    brown: "Brun",
    pink: "Rosa",
    beige: "Beige",
    gold: "Gull",
    silver: "Sølv",
  };
  const en: Record<string, string> = {
    black: "Black",
    white: "White",
    gray: "Gray",
    grey: "Gray",
    red: "Red",
    orange: "Orange",
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    purple: "Purple",
    brown: "Brown",
    pink: "Pink",
    beige: "Beige",
    gold: "Gold",
    silver: "Silver",
  };
  return (language === "en" ? en : no)[key] ?? v;
}
function titleCase(s?: string | null) {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function subcategoryLabel(
  cat?: string,
  sub?: string,
  language: AppLang = "no",
) {
  return localizeSubcategoryLabel(cat, sub, language);
}
function timeAgoLong(iso?: string | null, language: AppLang = "no") {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60000);
  if (language === "en") {
    if (min < 1) return "now";
    if (min < 60) return String(min) + " min ago";
    const h = Math.floor(min / 60);
    if (h < 24) return String(h) + " h ago";
    const days = Math.floor(h / 24);
    if (days < 7) return String(days) + " days ago";
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return String(weeks) + " weeks ago";
    const months = Math.floor(days / 30);
    if (months < 12) return String(months) + " months ago";
    const years = Math.floor(days / 365);
    return String(years) + " years ago";
  }
  if (min < 1) return "nå";
  if (min < 60) return String(min) + " min siden";
  const h = Math.floor(min / 60);
  if (h < 24) return String(h) + " t siden";
  const days = Math.floor(h / 24);
  if (days < 7) return String(days) + " dager siden";
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return String(weeks) + " uker siden";
  const months = Math.floor(days / 30);
  if (months < 12) return String(months) + " mnd siden";
  const years = Math.floor(days / 365);
  return String(years) + " år siden";
}
type SimilarityTone = "green" | "yellow" | "orange" | "red" | "neutral";
type SimilarityRow = {
  label: string;
  value: string;
  tone: SimilarityTone;
  note?: string | null;
};
function latestReportIso(m: Match) {
  const candidates = [m.lost?.created_at, m.found?.created_at]
    .map((iso) => ({ iso, t: Date.parse(String(iso ?? "")) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);
  return candidates[0]?.iso ?? null;
}
function normalizeText(v?: string | null) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}
function primarySubcategory(m: Match, language: AppLang = "no") {
  return (
    subcategoryLabel(m.lost?.category, m.lost?.subcategory_key, language) ||
    subcategoryLabel(m.found?.category, m.found?.subcategory_key, language) ||
    null
  );
}
function objectComparison(m: Match, language: AppLang = "no") {
  const lost = subcategoryLabel(
    m.lost?.category,
    m.lost?.subcategory_key,
    language,
  );
  const found = subcategoryLabel(
    m.found?.category,
    m.found?.subcategory_key,
    language,
  );
  const level = Number(reasonVal(m.reasons, "object_match_level"));
  const same =
    !!lost && !!found && normalizeText(lost) === normalizeText(found);
  const value =
    lost && found ? (same ? lost : `${lost} ↔ ${found}`) : lost || found || "";
  const note =
    same || !lost || !found
      ? null
      : level >= 2
        ? tr(language, "match.related.items")
        : tr(language, "match.possibly.related.items");
  return { lost, found, level, same, value, note };
}

function primaryColor(m: Match, language: AppLang = "no") {
  return (
    colorLabel(m.lost?.color, language) ||
    colorLabel(m.found?.color, language) ||
    null
  );
}
function headlineTitle(m: Match, language: AppLang = "no") {
  const sub = primarySubcategory(m, language);
  const sharedColor = sharedColorValue(m);
  const color = sharedColor
    ? colorLabel(sharedColor, language)
    : primaryColor(m, language);
  const parts = [color, sub ? String(sub).toLowerCase() : null].filter(
    Boolean,
  ) as string[];
  if (parts.length) {
    const merged = parts.join(" ").trim();
    return merged.charAt(0).toUpperCase() + merged.slice(1);
  }
  return (
    reportCore(m.lost, language) ||
    reportCore(m.found, language) ||
    tr(language, "match.unknown.item")
  );
}
function objectTone(m: Match, language: AppLang = "no"): SimilarityTone {
  const comparison = objectComparison(m, language);
  if (comparison.same || comparison.level >= 3) return "green";
  if (comparison.level === 2) return "yellow";
  if (comparison.level === 1) return "orange";
  return comparison.lost || comparison.found ? "red" : "neutral";
}
function secondaryColorValue(report: any) {
  const direct = String(report?.secondary_color || "").trim();
  if (direct) return direct;
  const match = String(report?.description || "").match(
    /(?:Secondary color|Tilleggsfarge):\s*([^\n]+)/i,
  );
  return match?.[1]?.trim() || null;
}
function normalizedReportColors(report: any) {
  return [report?.color, secondaryColorValue(report)]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}
function sharedColorValue(match: any) {
  const lost = normalizedReportColors(match?.lost);
  const found = normalizedReportColors(match?.found);
  return lost.find((value) => found.includes(value)) || null;
}
function colorTone(m: Match, language: AppLang = "no"): SimilarityTone {
  const lostColors = normalizedReportColors(m.lost);
  const foundColors = normalizedReportColors(m.found);
  if (lostColors.some((value) => foundColors.includes(value))) return "green";
  if (!lostColors.length || !foundColors.length) return "neutral";
  return "red";
}
function distanceToneFromMeters(meters: any): SimilarityTone {
  const n = Number(meters);
  if (!Number.isFinite(n)) return "neutral";
  if (n <= 1000) return "green";
  if (n <= 3000) return "yellow";
  if (n <= 7000) return "orange";
  return "red";
}
function daysTone(days: any): SimilarityTone {
  const n = Number(days);
  if (!Number.isFinite(n)) return "neutral";
  if (n <= 1) return "green";
  if (n <= 3) return "yellow";
  if (n <= 7) return "orange";
  return "red";
}
function similarityAccent(tone: SimilarityTone) {
  switch (tone) {
    case "green":
      return { color: "#15803D", icon: "✓" };
    case "yellow":
      return { color: "#CA8A04", icon: "•" };
    case "orange":
      return { color: "#EA580C", icon: "•" };
    case "red":
      return { color: "#DC2626", icon: "•" };
    default:
      return { color: "#64748B", icon: "•" };
  }
}
function detailRowsForMatch(
  m: Match,
  reportId?: string,
  language: AppLang = "no",
): SimilarityRow[] {
  const ownIsLost = m.lost?.id === reportId;
  const counterpart = ownIsLost ? m.found : m.lost;
  const rows: SimilarityRow[] = [];
  const areaInfo = areaRelationForMatch(m, language);
  const daysApart = reasonVal(m.reasons, "days_apart");
  const object = objectComparison(m, language);
  const color = primaryColor(m, language);
  const seenAgo = timeAgoLong(
    counterpart?.occurred_at || counterpart?.created_at || null,
    language,
  );
  const updatedAgo = timeAgoLong(latestReportIso(m), language);
  if (object.value)
    rows.push({
      label: tr(language, "match.item"),
      value: object.value,
      tone: objectTone(m, language),
      note: object.note,
    });
  if (color)
    rows.push({
      label: tr(language, "match.color"),
      value: String(color),
      tone: colorTone(m, language),
    });
  rows.push(areaInfo);
  if (seenAgo)
    rows.push({
      label: tr(language, "match.last.seen"),
      value: seenAgo,
      tone: daysTone(daysApart),
    });
  if (updatedAgo)
    rows.push({
      label: tr(language, "match.case.updated"),
      value: updatedAgo,
      tone: "neutral",
    });
  return rows;
}
function reportRadiusMeters(rep?: ReportLite | null) {
  const candidates = [
    rep?.radius_m,
    rep?.search_radius_m,
    rep?.area_radius_m,
    rep?.location_radius_m,
    (rep as any)?.search_radius,
    (rep as any)?.radius,
    (rep as any)?.area_radius,
    (rep as any)?.location_radius,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function areaRelationForMatch(
  m: Match,
  language: AppLang = "no",
): SimilarityRow {
  const label = tr(language, "match.location");
  const insideText = tr(language, "match.within.selected.area");
  const missingText = tr(language, "match.location.information.missing");
  const outsideText = (value: string | null) =>
    language === "en"
      ? String(value) + " outside selected area"
      : String(value) + " utenfor valgt område";
  const distRaw = reasonVal(m.reasons, "distance_m");
  const dist = Number(distRaw);
  const explicitInside =
    reasonVal(m.reasons, "within_radius") ??
    reasonVal(m.reasons, "inside_radius") ??
    reasonVal(m.reasons, "inside_area") ??
    reasonVal(m.reasons, "within_area");
  const outsideRaw =
    reasonVal(m.reasons, "outside_radius_m") ??
    reasonVal(m.reasons, "distance_outside_m") ??
    reasonVal(m.reasons, "outside_area_m");
  const outsideMeters = Number(outsideRaw);
  const radius = reportRadiusMeters(m.lost);
  if (
    explicitInside === true ||
    explicitInside === "true" ||
    explicitInside === 1 ||
    explicitInside === "1"
  )
    return { label, value: insideText, tone: "green" };
  if (Number.isFinite(outsideMeters)) {
    if (outsideMeters <= 0) return { label, value: insideText, tone: "green" };
    const tone: SimilarityTone =
      outsideMeters <= 500
        ? "yellow"
        : outsideMeters <= 2000
          ? "orange"
          : "red";
    return { label, value: outsideText(formatDistance(outsideMeters)), tone };
  }
  if (Number.isFinite(dist) && radius != null) {
    if (dist <= radius) return { label, value: insideText, tone: "green" };
    const delta = dist - radius;
    const tone: SimilarityTone =
      delta <= 500 ? "yellow" : delta <= 2000 ? "orange" : "red";
    return { label, value: outsideText(formatDistance(delta)), tone };
  }
  if (Number.isFinite(dist))
    return {
      label,
      value: formatDistance(distRaw) || "—",
      tone: distanceToneFromMeters(distRaw),
    };
  return { label, value: missingText, tone: "neutral" };
}
function prettyShort(
  rep: ReportLite,
  forcedType?: "LOST" | "FOUND",
  language: AppLang = "no",
) {
  const typ = forcedType ?? rep.type ?? "LOST";
  const typLabel =
    typ === "LOST" ? tr(language, "match.lost") : tr(language, "match.found");
  const sub = subcategoryLabel(rep.category, rep.subcategory_key, language);
  const col = colorLabel(rep.color, language);
  const brand = titleCase(rep.brand);
  const parts = [
    col ? col.toLowerCase() : null,
    sub ? sub.toLowerCase() : null,
  ].filter(Boolean);
  const core = parts.length
    ? (parts as string[]).join(" ")
    : (rep.title ?? typLabel);
  const tail = brand ? " (" + brand + ")" : "";
  return typLabel + ": " + core + tail;
}
async function getSignedUrl(pathStr: string, token: string) {
  const u = `${API_BASE_URL}/storage/signed-download?path=${encodeURIComponent(pathStr)}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error ?? "Kunne ikke hente signed URL");
  return data.url as string;
}
async function getSignedUrlsBatch(paths: string[], token: string) {
  const u = `${API_BASE_URL}/storage/signed-download-batch`;
  const r = await fetch(u, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ paths }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? "Kunne ikke hente signed URLs");
  return (data?.urls ?? {}) as Record<string, string>;
}
function MatchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { language } = useI18n();
  const params = useLocalSearchParams<{ reportId?: string | string[] }>();
  const reportId = useMemo(() => {
    const rid = params?.reportId;
    return Array.isArray(rid) ? rid[0] : rid;
  }, [params?.reportId]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [thumbMap, setThumbMap] = useState<
    Record<string, { own?: string; other?: string }>
  >({});
  const thumbMapRef = useRef<Record<string, { own?: string; other?: string }>>(
    {},
  );
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<any>(null);
  useEffect(() => {
    thumbMapRef.current = thumbMap;
  }, [thumbMap]);
  useEffect(() => {
    visibleIdsRef.current = new Set(matches.map((m) => m.id));
  }, [matches]);
  const [lastMsgByMatch, setLastMsgByMatch] = useState<
    Record<string, LastMsg | null>
  >({});
  const [unreadByMatch, setUnreadByMatch] = useState<Record<string, boolean>>(
    {},
  );
  const lastSeenMapRef = useRef<Record<string, string>>({});
  const loadLastSeen = useCallback(async () => {
    lastSeenMapRef.current = await getLastSeenMap();
  }, []);
  const computeUnreadForMatch = useCallback(
    (matchId: string, msg: LastMsg | null) => {
      if (!user?.id || !msg) return false;
      const lastSeen = lastSeenMapRef.current[matchId];
      const isNewerThanSeen =
        !lastSeen || new Date(msg.created_at) > new Date(lastSeen);
      const fromOther = msg.sender_id !== user.id;
      return isNewerThanSeen && fromOther;
    },
    [user?.id],
  );
  const fetchMatches = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Mangler innlogging (token).");
      await loadLastSeen();
      const r = await fetch(
        `${API_BASE_URL}/matches?reportId=${encodeURIComponent(reportId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const serverMsg = String(data?.error ?? "Kunne ikke hente treff");
        if (r.status === 404 && /report not found/i.test(serverMsg)) {
          Alert.alert(
            tr(language, "match.case.not.found"),
            tr(
              language,
              "match.this.case.no.longer.exists.or.you.do.not.have.ac",
            ),
            [{ text: "OK", onPress: () => router.back() }],
          );
          setMatches([]);
          return;
        }
        throw new Error(serverMsg);
      }
      const list: Match[] = data?.matches ?? [];
      setMatches(list);
      const resolvePaths = async (m: Match) => {
        const ownIsLost = m.lost?.id === reportId;
        const own = ownIsLost ? m.lost : m.found;
        const other = ownIsLost ? m.found : m.lost;
        let ownPath = own?.report_images?.[0]?.path ?? null;
        let otherPath = other?.report_images?.[0]?.path ?? null;
        if ((!ownPath || !otherPath) && token) {
          try {
            const rr = await fetch(`${API_BASE_URL}/matches/${m.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const jj = await rr.json().catch(() => ({}));
            if (rr.ok && jj?.match) {
              const full: Match = jj.match;
              const ownIsLost2 = full.lost?.id === reportId;
              const own2 = ownIsLost2 ? full.lost : full.found;
              const other2 = ownIsLost2 ? full.found : full.lost;
              ownPath = ownPath ?? own2?.report_images?.[0]?.path ?? null;
              otherPath = otherPath ?? other2?.report_images?.[0]?.path ?? null;
            }
          } catch {}
        }
        return { ownPath, otherPath };
      };
      const existingMap = thumbMapRef.current || {};
      const neededByMatch: Record<
        string,
        { ownPath?: string; otherPath?: string }
      > = {};
      const pathSet = new Set<string>();
      await Promise.all(
        list.map(async (m) => {
          const existing = existingMap[m.id] ?? {};
          if (existing.own && existing.other) return;
          const { ownPath, otherPath } = await resolvePaths(m);
          const rec: { ownPath?: string; otherPath?: string } = {};
          if (!existing.other && otherPath) {
            rec.otherPath = String(otherPath);
            pathSet.add(String(otherPath));
          }
          if (!existing.own && ownPath) {
            rec.ownPath = String(ownPath);
            pathSet.add(String(ownPath));
          }
          if (rec.ownPath || rec.otherPath) neededByMatch[m.id] = rec;
        }),
      );
      const allPaths = Array.from(pathSet);
      if (allPaths.length) {
        let urlMap: Record<string, string> = {};
        try {
          urlMap = await getSignedUrlsBatch(allPaths, token);
        } catch (e: any) {
          console.warn("[match] signed-download-batch failed", e?.message ?? e);
          urlMap = {};
        }
        setThumbMap((prev) => {
          const next = { ...prev };
          for (const mid of Object.keys(neededByMatch)) {
            const want = neededByMatch[mid];
            const prevEntry = next[mid] ?? {};
            const patch: { own?: string; other?: string } = {};
            if (want.otherPath && urlMap[want.otherPath])
              patch.other = urlMap[want.otherPath];
            if (want.ownPath && urlMap[want.ownPath])
              patch.own = urlMap[want.ownPath];
            if (patch.own || patch.other) {
              next[mid] = { ...prevEntry, ...patch };
            }
          }
          return next;
        });
      }
      const ids = list.map((m) => m.id);
      if (ids.length) {
        const { data: lastRows, error: lastErr } = await supabase
          .from("last_message_per_conversation")
          .select("conversation_id, sender_id, body, created_at")
          .in("conversation_id", ids);
        if (lastErr) {
          console.warn(
            "[match] last_message_per_conversation error",
            lastErr.message,
          );
        } else {
          const map: Record<string, LastMsg | null> = {};
          for (const id of ids) map[id] = null;
          for (const row of lastRows ?? []) {
            const cid = String((row as any).conversation_id);
            map[cid] = {
              conversation_id: cid,
              sender_id: String((row as any).sender_id),
              body: String((row as any).body ?? ""),
              created_at: String((row as any).created_at),
            };
          }
          setLastMsgByMatch((prev) => ({ ...prev, ...map }));
          setUnreadByMatch((prev) => {
            const next: Record<string, boolean> = { ...prev };
            for (const id of ids) next[id] = computeUnreadForMatch(id, map[id]);
            return next;
          });
        }
      }
    } catch (e: any) {
      Alert.alert(
        tr(language, "match.error"),
        e?.message ?? tr(language, "match.unknown.error"),
      );
    } finally {
      setLoading(false);
    }
  }, [reportId, loadLastSeen, computeUnreadForMatch]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMatches();
    setRefreshing(false);
  }, [fetchMatches]);
  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);
  useFocusEffect(
    useCallback(() => {
      (async () => {
        await loadLastSeen();
        setUnreadByMatch((prev) => {
          const next: Record<string, boolean> = { ...prev };
          for (const m of matches) {
            const last = lastMsgByMatch[m.id] ?? null;
            next[m.id] = computeUnreadForMatch(m.id, last);
          }
          return next;
        });
      })();
      return () => {};
    }, [matches, lastMsgByMatch, loadLastSeen, computeUnreadForMatch]),
  );
  useEffect(() => {
    if (!user?.id || !reportId) return;
    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }
    const channelName = `match-list-${reportId}-${user.id}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload: any) => {
        const msg = payload?.new as LastMsg | undefined;
        if (!msg?.conversation_id) return;
        if (!visibleIdsRef.current.has(msg.conversation_id)) return;
        setLastMsgByMatch((prev) => ({ ...prev, [msg.conversation_id]: msg }));
        setUnreadByMatch((prev) => ({
          ...prev,
          [msg.conversation_id]: computeUnreadForMatch(
            msg.conversation_id,
            msg,
          ),
        }));
      },
    );
    channel.subscribe();
    return () => {
      if (channelRef.current === channel) channelRef.current = null;
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [reportId, user?.id, computeUnreadForMatch]);
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        try {
          supabase.removeChannel(channelRef.current);
        } catch {}
        channelRef.current = null;
      }
    };
  }, []);
  if (!reportId) {
    return (
      <View style={styles.center}>
        <Text>{tr(language, "match.missing.reportid")}</Text>
      </View>
    );
  }
  const visibleMatches = useMemo(() => {
    return matches
      .filter((item) => scoreLevel(item.score) >= 2)
      .sort(
        (first, second) => Number(second.score || 0) - Number(first.score || 0),
      );
  }, [matches]);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={tr(language, "match.matches")}
          subtitle={tr(language, "match.ranked.matches.for.your.case")}
          onBack={() => router.back()}
          right={<AuthHeaderAction />}
        />
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8 }}>
              {tr(language, "match.loading.matches")}
            </Text>
          </View>
        ) : (
          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: 12,
              paddingBottom: 24,
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            data={visibleMatches}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => {
              const level = scoreLevel(item.score);
              const tone = bannerTone(level);
              const unread = unreadByMatch[item.id] === true;
              const ownIsLost = item.lost?.id === reportId;
              const ownLabel = ownIsLost
                ? tr(language, "match.your.case")
                : tr(language, "match.other.party");
              const otherLabel = ownIsLost
                ? tr(language, "match.other.party")
                : tr(language, "match.your.case");

              const title = headlineTitle(item, language);
              const detailRows = detailRowsForMatch(item, reportId, language);
              if (level < 2) return null;
              const summary = detailRows.slice(0, 4);
              const rank =
                visibleMatches.findIndex(
                  (candidate) => candidate.id === item.id,
                ) + 1;
              return (
                <Pressable
                  style={styles.listRow}
                  onPress={() => router.push(`/matches/${item.id}`)}
                >
                  <View style={[styles.rankPill, { backgroundColor: tone.bg }]}>
                    <Text style={styles.rankText}>{rank}</Text>
                  </View>
                  <View style={styles.listContent}>
                    <View style={styles.listTopRow}>
                      <Text style={styles.listTitle} numberOfLines={1}>
                        {title}
                      </Text>
                      {unread && <Text style={styles.unreadDot}>●</Text>}
                    </View>
                    <Text style={[styles.listLevel, { color: tone.bg }]}>
                      {scoreLabel(item.score, language)}
                    </Text>
                    {summary.map((row, index) => (
                      <Text
                        key={`${item.id}-summary-${index}`}
                        style={styles.listMeta}
                        numberOfLines={1}
                      >
                        {row.label}: {row.value}
                        {row.note ? ` · ${row.note}` : ""}
                      </Text>
                    ))}
                    <Text style={styles.listOpen}>
                      {tr(language, "match.view.full.details")}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={{ textAlign: "center", marginTop: 32 }}>
                {tr(language, "match.no.matches.yet.top.3.levels")}
              </Text>
            }
          />
        )}
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 132,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: theme.colors.card,
    padding: 14,
  },
  rankPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rankText: { color: "#FFF", fontWeight: "900" },
  listContent: { flex: 1 },
  listTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  listTitle: {
    flex: 1,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 16,
  },
  listLevel: {
    marginTop: 3,
    fontWeight: "900",
    fontSize: 12,
    textTransform: "uppercase",
  },
  listMeta: {
    marginTop: 5,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 13,
  },
  listOpen: {
    marginTop: 9,
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 13,
  },
  compactCard: {
    flexDirection: "row",
    minHeight: 126,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: theme.colors.card,
    overflow: "hidden",
  },
  compactAccent: { width: 7 },
  compactImageWrap: {
    width: 108,
    margin: 10,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#E2E8F0",
  },
  compactImage: { width: "100%", height: "100%" },
  compactPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#E2E8F0",
  },
  compactContent: { flex: 1, paddingVertical: 12, paddingRight: 12 },
  compactTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  compactTitle: {
    flex: 1,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 15,
  },
  compactLevel: { marginTop: 3, fontWeight: "900", fontSize: 12 },
  compactMeta: {
    marginTop: 4,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 12,
  },
  compactOpen: {
    marginTop: 7,
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 12,
  },
  card: {
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: theme.colors.card,
  },
  banner: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bannerTxt: { fontWeight: "900", fontSize: 14 },
  bannerDot: { fontWeight: "900", fontSize: 14 },
  pairRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  pairCol: { flex: 1 },
  pairImgWrap: {
    width: "100%",
    height: 88,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#f1f5f9",
  },
  pairImg: { width: "100%", height: "100%" },
  pairPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#e5e7eb",
  },
  pairMeta: {
    marginBottom: 6,
    color: theme.colors.muted,
    fontWeight: "900",
    fontSize: 12,
  },
  divider: { height: 1, backgroundColor: theme.colors.border, marginTop: 12 },
  summaryHeading: {
    marginTop: 12,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 16,
  },
  sectionLabel: {
    marginTop: 8,
    color: theme.colors.muted,
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
  },
  reasonList: { marginTop: 10, gap: 8 },
  reasonRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  reasonIcon: { fontWeight: "900", width: 16, marginTop: 1 },
  reasonTxt: { color: theme.colors.text, fontWeight: "700", flex: 1 },
  reasonLabel: { color: theme.colors.text, fontWeight: "900" },
  reasonNote: { color: theme.colors.muted, fontWeight: "700", fontSize: 12 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnGhost: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionBtnPrimary: { backgroundColor: theme.colors.primary },
  actionBtnMuted: { backgroundColor: "#E5E7EB" },
  actionTxtGhost: { color: theme.colors.text, fontWeight: "900" },
  actionTxtPrimary: { color: "#fff", fontWeight: "900" },
  actionTxtMuted: { color: "#475569", fontWeight: "900" },
  row: { flexDirection: "row", gap: 12 },
  thumb: { width: 72, height: 108, borderRadius: 12, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  thumbPlaceholder: { width: "100%", height: "100%", backgroundColor: "#eee" },
  thumbStack: { flex: 1, flexDirection: "column", gap: 4 },
  thumbSlot: { flex: 1, overflow: "hidden" },
  thumbSlotTop: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  thumbSlotBottom: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontWeight: "900",
    marginBottom: 6,
    flex: 1,
    paddingRight: 8,
    color: theme.colors.text,
  },
  unreadDot: { color: theme.colors.primary, fontWeight: "900" },
  lineStrong: { color: theme.colors.text, fontWeight: "800" },
  line: { color: theme.colors.text },
  placeLine: { marginTop: 6, color: theme.colors.muted, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    fontWeight: "700",
    color: "#111",
    fontSize: 12,
  },
  lastMsg: { marginTop: 8, color: theme.colors.text, fontWeight: "700" },
  lastMsgMuted: { marginTop: 8, color: theme.colors.muted, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  link: { color: theme.colors.primary, fontWeight: "800" },
  chatBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },
  chatBtnTxt: { color: "#fff", fontWeight: "900", fontSize: 12 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MatchScreen);
