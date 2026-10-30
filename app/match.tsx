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
  Image,
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
import { InlineNotice } from "../src/ui/InlineNotice";
import { EmptyState, InfoButton, ScoreBadge, ScoreLevelsExplained, ScreenHeader, SCORE_LABEL_KEYS, scoreLevel as scoreLevelKey } from "../src/ui/kit";
import { caseAttributes, caseTitle } from "../src/lib/caseDisplay";
import { shortPlace } from "../src/lib/places";
import { formatDate } from "../src/i18n/formatters";
import { reportSecondaryColor } from "../src/lib/reportDescription";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../src/i18n/I18nProvider";

import type { TranslationKey } from "../src/i18n/locales/en";
import { codedError, userErrorMessage } from "../src/lib/userError";
import { translate } from "../src/i18n/I18nProvider";
import { categoryName, colorName, itemName } from "../src/i18n/catalog";
import { formatDistance as formatDistanceText, formatNumber, formatTimeAgo } from "../src/i18n/formatters";
function tr(
  language: "no" | "en",
  key: TranslationKey,
  params?: Record<string, string | number | null | undefined>,
): string {
  return translate(language, key, params);
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



function localizeCategoryLabel(cat?: string, language: AppLang = "no") {
  if (!cat) return null;
  return categoryName(cat, language);
}

function localizeSubcategoryLabel(
  cat?: string,
  sub?: string,
  language: AppLang = "no",
) {
  if (!cat || !sub) return null;
  return itemName(sub, language, cat);
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
  if (score >= 85) return tr(language, "match.score.excellent");
  if (score >= 70) return tr(language, "match.score.good");
  if (score >= 55) return tr(language, "match.score.possible");
  return tr(language, "match.score.low");
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
  return formatTimeAgo(iso, (k, p) => tr(language, k, p), "short") || null;
}
function pickReasons(m: Match, language: AppLang = "no") {
  const dist = formatDistance(reasonVal(m.reasons, "distance_m"), language);
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
      text: tr(language, "match.distanceAway", { distance: dist }),
    });
  if (days) lines.push({ icon: "✓", text: tr(language, "match.time") + days });
  if (lines.length < 4 && txt)
    lines.push({ icon: "✓", text: tr(language, "match.text") + txt });
  return lines.slice(0, 4);
}
function statusLabel(s: any, language: AppLang = "no") {
  const keys: Record<string, TranslationKey> = {
    NEW: "match.status.new",
    SEEN: "match.status.seen",
    DISMISSED: "match.status.dismissed",
    CONFIRMED: "match.status.confirmed",
  };
  const key = keys[String(s)];
  return key ? tr(language, key) : String(s);
}
function formatDistance(meters: any, language: AppLang = "no") {
  const n = Number(meters);
  if (meters == null || !Number.isFinite(n)) return null;
  return formatDistanceText(n, language, (k, p) => tr(language, k, p));
}
function formatDays(days: any, language: AppLang = "no") {
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return tr(language, "match.today");
  return tr(language, "time.short.days", { count: formatNumber(n, language, 1) });
}
function formatTextSim(sim: any) {
  const n = Number(sim);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}
function colorLabel(v?: string | null, language: AppLang = "no") {
  if (!v) return null;
  return colorName(v, language);
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
  return formatTimeAgo(iso, (k, p) => tr(language, k, p), "long") || null;
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
  return reportSecondaryColor(report);
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
    tr(language, "match.outsideSelectedArea", { distance: String(value) });
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
    return { label, value: outsideText(formatDistance(outsideMeters, language)), tone };
  }
  if (Number.isFinite(dist) && radius != null) {
    if (dist <= radius) return { label, value: insideText, tone: "green" };
    const delta = dist - radius;
    const tone: SimilarityTone =
      delta <= 500 ? "yellow" : delta <= 2000 ? "orange" : "red";
    return { label, value: outsideText(formatDistance(delta, language)), tone };
  }
  if (Number.isFinite(dist))
    return {
      label,
      value: formatDistance(distRaw, language) || "—",
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
  const { language, t } = useI18n();
  const params = useLocalSearchParams<{ reportId?: string | string[] }>();
  const reportId = useMemo(() => {
    const rid = params?.reportId;
    return Array.isArray(rid) ? rid[0] : rid;
  }, [params?.reportId]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setLoadError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw codedError("LOGIN_REQUIRED");
      await loadLastSeen();
      const r = await fetch(
        `${API_BASE_URL}/matches?reportId=${encodeURIComponent(reportId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const serverMsg = String(data?.error ?? "MATCHES_LOAD_FAILED");
        if (r.status === 404 && /report not found/i.test(serverMsg)) {
          setLoadError(t("match.this.case.no.longer.exists.or.you.do.not.have.ac"));
          setMatches([]);
          return;
        }
        throw Object.assign(codedError(serverMsg), { status: r.status });
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
      setLoadError(userErrorMessage(e, t, "match.unknown.error", "match.list"));
    } finally {
      setLoading(false);
    }
  }, [reportId, loadLastSeen, computeUnreadForMatch, t]);
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
  const visibleMatches = useMemo(
    () =>
      matches
        .filter((item) => scoreLevel(item.score) >= 2 && item.status !== "DISMISSED")
        .sort((first, second) => Number(second.score || 0) - Number(first.score || 0)),
    [matches],
  );
  const ownReport = useMemo(() => {
    const first = matches[0];
    if (!first) return null;
    return first.lost?.id === reportId ? first.lost : first.found;
  }, [matches, reportId]);

  const header = (
    <ScreenHeader
      title={t("match.matches")}
      subtitle={t("match.ranked.matches.for.your.case")}
      onBack={() => router.back()}
      right={
        <InfoButton title={t("info.matchLevels.title")} body={t("info.matchLevels.body")} label={t("info.matchLevels.label")}>
          <ScoreLevelsExplained />
        </InfoButton>
      }
    />
  );

  if (!reportId) {
    return (
      <View style={list.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <View style={list.content}>
          <InlineNotice tone="error" title={t("match.missing.reportid")} />
        </View>
      </View>
    );
  }

  const daysText = (m: Match) => {
    const days = Number(reasonVal(m.reasons, "days_apart"));
    if (!Number.isFinite(days)) return null;
    const whole = Math.round(Math.abs(days));
    return whole === 0 ? t("matchDetail.compare.sameDay") : t("matchDetail.compare.daysBetween", { count: whole });
  };

  const ownIsFound = ownReport?.type === "FOUND";
  const ownCard = ownReport ? (
    <View style={list.ownCard}>
      <View style={[list.ownIcon, { backgroundColor: ownIsFound ? "#DCFCE7" : "#FEF3C7" }]}>
        <Ionicons
          name={ownIsFound ? "checkmark-circle-outline" : "search-outline"}
          size={22}
          color={ownIsFound ? "#166534" : "#92400E"}
        />
      </View>
      <View style={list.ownText}>
        <Text style={[list.ownKicker, { color: ownIsFound ? "#166534" : "#92400E" }]}>
          {t("matchDetail.sideLabel", {
            who: t("matchDetail.your.case"),
            type: ownIsFound ? t("common.found") : t("common.lost"),
          })}
        </Text>
        <Text style={list.ownTitle} numberOfLines={1}>
          {[caseTitle(ownReport, language), caseAttributes(ownReport, language)].filter(Boolean).join(" · ")}
        </Text>
        <Text style={list.meta} numberOfLines={1}>
          {[shortPlace(ownReport.location_label), formatDate(ownReport.occurred_at ?? ownReport.created_at, language)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </View>
  ) : null;

  return (
    <View style={list.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}
      {loading && !matches.length ? (
        <View style={list.center}>
          <ActivityIndicator />
          <Text style={list.meta}>{t("match.loading.matches")}</Text>
        </View>
      ) : (
        <FlatList
          style={list.flex}
          contentContainerStyle={list.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          data={visibleMatches}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={
            <View style={list.headerBlock}>
              {ownCard}
              {!!loadError && (
                <InlineNotice
                  tone="error"
                  title={loadError}
                  actionLabel={t("errors.retry")}
                  onAction={() => void fetchMatches()}
                  style={list.noticeTight}
                />
              )}
              {visibleMatches.length > 0 && (
                <Text style={list.section}>{t("match.countLabel", { count: visibleMatches.length })}</Text>
              )}
            </View>
          }
          ItemSeparatorComponent={() => <View style={list.gap} />}
          renderItem={({ item }) => {
            const unread = unreadByMatch[item.id] === true;
            const ownIsLost = item.lost?.id === reportId;
            const other = ownIsLost ? item.found : item.lost;
            const thumb = thumbMap[item.id]?.other;
            const dist = formatDistance(reasonVal(item.reasons, "distance_m"), language);
            const line1 = [dist ? t("match.distanceAway", { distance: dist }) : null, daysText(item)].filter(Boolean).join(" · ");
            const line2 = other ? caseAttributes(other, language) : "";
            const title = other ? caseTitle(other, language) : headlineTitle(item, language);
            const isNew = unread || item.status === "NEW";
            const statusText = unread
              ? t("match.newMessage")
              : t(
                  item.status === "CONFIRMED"
                    ? "match.status.confirmed"
                    : item.status === "NEW"
                      ? "match.status.new"
                      : "match.status.seen",
                );
            return (
              <Pressable
                style={({ pressed }) => [list.card, pressed && list.pressed]}
                onPress={() => router.push(`/matches/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={[title, t(SCORE_LABEL_KEYS[scoreLevelKey(item.score)]), statusText, line1]
                  .filter(Boolean)
                  .join(", ")}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={list.thumb} />
                ) : (
                  <View style={[list.thumb, list.thumbEmpty]}>
                    <Text style={list.thumbEmptyText}>{t("matchDetail.noImage")}</Text>
                  </View>
                )}
                <View style={list.cardText}>
                  <View style={list.badgeRow}>
                    <ScoreBadge score={item.score} />
                    <View style={list.statusWrap}>
                      {isNew && <View style={list.dot} />}
                      <Text style={[list.status, isNew && list.statusStrong]}>{statusText}</Text>
                    </View>
                  </View>
                  <Text style={list.title} numberOfLines={1}>
                    {title}
                  </Text>
                  {!!line1 && (
                    <Text style={list.meta} numberOfLines={1}>
                      {line1}
                    </Text>
                  )}
                  {!!line2 && (
                    <Text style={list.meta} numberOfLines={1}>
                      {line2}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={loadError ? null : <EmptyState title={t("match.empty.title")} body={t("match.empty.body")} />}
        />
      )}
    </View>
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

// T1.9F: styles for the reworked match list.
const list = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  headerBlock: { gap: 14, marginBottom: 12 },
  noticeTight: { marginTop: 0 },
  ownCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 12,
  },
  ownIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ownText: { flex: 1, minWidth: 0, gap: 2 },
  ownKicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  ownTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  section: { fontSize: 13, fontWeight: "800", color: theme.colors.textSecondary, letterSpacing: 0.3, textTransform: "uppercase" },
  gap: { height: 12 },
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 14,
  },
  pressed: { opacity: 0.85 },
  thumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: "#E2E8F0" },
  thumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#CBD5E1",
    backgroundColor: "#F1F5F9",
  },
  thumbEmptyText: { fontSize: 11, fontWeight: "700", color: theme.colors.textSecondary, textAlign: "center" },
  cardText: { flex: 1, minWidth: 0, gap: 5 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusWrap: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: theme.colors.unread },
  status: { fontSize: 12, fontWeight: "700", color: theme.colors.textSecondary },
  statusStrong: { color: theme.colors.unread, fontWeight: "800" },
  title: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  meta: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
});
