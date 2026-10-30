// app/matches/[matchId].tsx
// Match details v2: shows the latest message, sender, and chat unread indicator.
// Always shows latest-message status; chat opens only when status is CONFIRMED.
import { requireAccount } from "../../src/ui/AccountRequired";
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
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Image,
  Alert,
  Linking,
  Platform,
} from "react-native";
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  useFocusEffect,
} from "expo-router";
import ImageViewing from "react-native-image-viewing";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { getLastSeenMap } from "../../src/lib/unread";
import { useAuth } from "../../src/contexts/AuthContext";
import {
  CATEGORIES,
  SUBCATEGORIES,
  OBJECT_LABELS_EN,
  objectLabel,
  objectSearchText,
} from "../../src/lib/categories";
import { shortPlace } from "../../src/lib/places";
import { PremiumHeader } from "../../src/ui/PremiumHeader";
import { AuthHeaderAction } from "../../src/ui/AuthHeaderAction";
import { useI18n } from "../../src/i18n/I18nProvider";

import type { TranslationKey } from "../../src/i18n/locales/en";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { translate } from "../../src/i18n/I18nProvider";
import { categoryName, colorName, itemName } from "../../src/i18n/catalog";
import { formatDistance as formatDistanceText, formatMoney, formatNumber, formatTimeAgo } from "../../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../../src/lib/market";
function tr(
  language: "no" | "en",
  key: TranslationKey,
  params?: Record<string, string | number | null | undefined>,
): string {
  return translate(language, key, params);
}

type Reason = { k: string; v: any };
type ReportFull = {
  id: string;
  user_id: string;
  type: "LOST" | "FOUND";
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
  reward_ore?: number | null;
  location_label?: string | null;
  radius_m?: number | null;
  search_radius_m?: number | null;
  area_radius_m?: number | null;
  location_radius_m?: number | null;
  report_images?: { id: any; path: string; sort_order: number }[];
};
type MatchFull = {
  id: string;
  score: number;
  status: "NEW" | "SEEN" | "DISMISSED" | "CONFIRMED";
  reasons: Reason[];
  lost: ReportFull;
  found: ReportFull;
};
type LastMsg = {
  id: string;
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
  const hit = (reasons || []).find((r) => r?.k === key);
  return hit?.v;
}
function scoreLabel(score: number, language: AppLang = "no") {
  if (score >= 85) return tr(language, "match.score.excellent");
  if (score >= 70) return tr(language, "match.score.good");
  if (score >= 55) return tr(language, "match.score.possible");
  return tr(language, "match.score.low");
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
  if (n < 1) return tr(language, "matchDetail.today");
  return tr(language, "time.short.days", { count: formatNumber(n, language, 1) });
}
function formatTextSim(sim: any) {
  const n = Number(sim);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}
function timeAgoLong(iso?: string | null, language: AppLang = "no") {
  return formatTimeAgo(iso, (k, p) => tr(language, k, p), "long") || null;
}
function shortMessage(body?: string) {
  if (!body) return "";
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length <= 80) return t;
  return t.slice(0, 77) + "…";
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
function categoryLabel(cat?: string, language: AppLang = "no") {
  return localizeCategoryLabel(cat, language);
}
function subcategoryLabel(
  cat?: string,
  sub?: string,
  language: AppLang = "no",
) {
  return localizeSubcategoryLabel(cat, sub, language);
}
function prettyHeading(rep: any, language: AppLang = "no") {
  const typ =
    rep?.type === "LOST"
      ? tr(language, "matchDetail.lost")
      : tr(language, "matchDetail.found");
  const sub = subcategoryLabel(rep?.category, rep?.subcategory_key, language);
  const col = colorLabel(rep?.color, language);
  const brand = titleCase(rep?.brand);
  const parts = [
    col ? col.toLowerCase() : null,
    sub ? sub.toLowerCase() : null,
  ].filter(Boolean);
  const core = parts.length ? parts.join(" ") : rep?.title || typ;
  const tail = brand ? " (" + brand + ")" : "";
  return typ + ": " + core + tail;
}
function objectComparison(match: MatchFull, language: AppLang = "no") {
  const lost = subcategoryLabel(
    match.lost?.category,
    match.lost?.subcategory_key,
    language,
  );
  const found = subcategoryLabel(
    match.found?.category,
    match.found?.subcategory_key,
    language,
  );
  const level = Number(reasonVal(match.reasons, "object_match_level"));
  const same = !!lost && !!found && lost.toLowerCase() === found.toLowerCase();
  const value =
    lost && found ? (same ? lost : `${lost} ↔ ${found}`) : lost || found || "";
  const note =
    same || !lost || !found
      ? null
      : level >= 2
        ? tr(language, "matchDetail.related.items")
        : tr(language, "matchDetail.possibly.related.items");
  return { level, same, value, note };
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
function reportRadiusMeters(rep?: ReportFull | null) {
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
function areaSummaryForMatch(match: any, language: AppLang = "no") {
  const distRaw = reasonVal(match.reasons, "distance_m");
  const dist = Number(distRaw);
  const explicitInside =
    reasonVal(match.reasons, "within_radius") ??
    reasonVal(match.reasons, "inside_radius") ??
    reasonVal(match.reasons, "inside_area") ??
    reasonVal(match.reasons, "within_area");
  const outsideRaw =
    reasonVal(match.reasons, "outside_radius_m") ??
    reasonVal(match.reasons, "distance_outside_m") ??
    reasonVal(match.reasons, "outside_area_m");
  const outsideMeters = Number(outsideRaw);
  const radius = reportRadiusMeters(match.lost);
  const insideText = tr(language, "matchDetail.within.selected.area");
  const outsideText = (v: string | null) =>
    tr(language, "match.outsideSelectedArea", { distance: String(v) });
  if (
    explicitInside === true ||
    explicitInside === "true" ||
    explicitInside === 1 ||
    explicitInside === "1"
  )
    return insideText;
  if (Number.isFinite(outsideMeters)) {
    if (outsideMeters <= 0) return insideText;
    return outsideText(formatDistance(outsideMeters, language));
  }
  if (Number.isFinite(dist) && radius != null) {
    if (dist <= radius) return insideText;
    return outsideText(formatDistance(dist - radius, language));
  }
  if (Number.isFinite(dist))
    return tr(
      language,
      "matchDetail.distance.between.reported.points.formatdistance.",
    );
}
async function getSignedUrl(path: string, token: string) {
  const u = `${API_BASE_URL}/storage/signed-download?path=${encodeURIComponent(path)}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Kunne ikke hente bilde-URL");
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
function MatchDetailsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { language } = useI18n();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = useMemo(() => {
    const mid = params?.matchId;
    return Array.isArray(mid) ? mid[0] : mid;
  }, [params?.matchId]);
  const [match, setMatch] = useState<MatchFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({}); // reportId -> urls
  // Last message + unread
  const [lastMsg, setLastMsg] = useState<LastMsg | null>(null);
  const [unread, setUnread] = useState(false);
  const lastSeenRef = useRef<Record<string, string>>({});
  // Fullscreen viewer
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<{ uri: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const loadLastSeen = useCallback(async () => {
    lastSeenRef.current = await getLastSeenMap();
  }, []);
  const computeUnread = useCallback(
    (msg: LastMsg | null) => {
      if (!user?.id || !matchId || !msg) return false;
      const lastSeen = lastSeenRef.current[matchId];
      const isNewerThanSeen =
        !lastSeen || new Date(msg.created_at) > new Date(lastSeen);
      const fromOther = msg.sender_id !== user.id;
      return isNewerThanSeen && fromOther;
    },
    [user?.id, matchId],
  );
  const fetchLastMessage = useCallback(async () => {
    if (!matchId) return;
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, body, created_at")
      .eq("conversation_id", matchId)
      .order("created_at", { ascending: false })
      .limit(1);
    const m = msgs && msgs[0] ? (msgs[0] as any as LastMsg) : null;
    setLastMsg(m);
    setUnread(computeUnread(m));
  }, [matchId, computeUnread]);
  const fetchMatch = useCallback(async () => {
    try {
      if (!matchId) return;
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw codedError("LOGIN_REQUIRED");
      await loadLastSeen();
      const r = await fetch(`${API_BASE_URL}/matches/${matchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Kunne ikke hente treff");
      const m: MatchFull = data.match;
      setMatch(m);
      console.log("lost.location_label", m?.lost?.location_label);
      console.log("found.location_label", m?.found?.location_label);
      // Prefetch thumbs (maks 10 per report) - batch signering for raskere UI
      const perReport = async (rep: ReportFull) => {
        const paths = (rep.report_images ?? [])
          .slice(0, 10)
          .map((x) => x.path)
          .filter(Boolean);
        if (!paths.length) return;
        // Batch-signér alle paths i ett kall
        let urlMap: Record<string, string> = {};
        try {
          urlMap = await getSignedUrlsBatch(paths, token);
        } catch (e: any) {
          console.warn(
            "[match-detail] signed-download-batch failed",
            e?.message ?? e,
          );
          // fallback: prøv single sign (best effort)
          try {
            const urls = await Promise.all(
              paths.map(async (p) => {
                try {
                  return await getSignedUrl(p, token);
                } catch {
                  return null;
                }
              }),
            );
            const cleaned = urls.filter(Boolean) as string[];
            if (cleaned.length) {
              setThumbs((prev) => ({ ...prev, [rep.id]: cleaned }));
              try {
                cleaned.forEach((u) => Image.prefetch(u));
              } catch {}
            }
            return;
          } catch {
            return;
          }
        }
        // Behold rekkefølge, dropp de som ikke ble signert
        const urls = paths.map((p) => urlMap[p]).filter(Boolean) as string[];
        if (!urls.length) return;
        setThumbs((prev) => ({ ...prev, [rep.id]: urls }));
        // Prefetch (best effort)
        try {
          urls.forEach((u) => Image.prefetch(u));
        } catch {}
      };
      await Promise.allSettled([perReport(m.lost), perReport(m.found)]);
      await fetchLastMessage();
    } catch (e: any) {
      Alert.alert(
        tr(language, "matchDetail.error"),
        userErrorMessage(e, (k) => tr(language, k), "matchDetail.unknown.error", "match.detail"),
      );
    } finally {
      setLoading(false);
    }
  }, [matchId, loadLastSeen, fetchLastMessage]);
  useEffect(() => {
    fetchMatch();
  }, [fetchMatch]);
  // Når skjermen får fokus (tilbake fra chat), oppdater lastSeen og unread
  useFocusEffect(
    useCallback(() => {
      (async () => {
        await loadLastSeen();
        await fetchLastMessage();
      })();
      return () => {};
    }, [loadLastSeen, fetchLastMessage]),
  );
  // Realtime: oppdater siste melding + unread mens detaljsiden er åpen
  useEffect(() => {
    if (!matchId || !user?.id) return;
    const channel = supabase
      .channel(`realtime:match-detail:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${matchId}`,
        },
        (payload: any) => {
          const msg = payload?.new as LastMsg | undefined;
          if (!msg) return;
          setLastMsg(msg);
          setUnread(computeUnread(msg));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, user?.id, computeUnread]);
  const setStatus = async (status: "CONFIRMED" | "DISMISSED" | "SEEN") => {
    try {
      if (!matchId) return;
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw codedError("LOGIN_REQUIRED");
      const r = await fetch(`${API_BASE_URL}/matches/${matchId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Kunne ikke oppdatere status");
      // Refresh match
      await fetchMatch();
    } catch (e: any) {
      Alert.alert(
        tr(language, "matchDetail.error"),
        userErrorMessage(e, (k) => tr(language, k), "matchDetail.unknown.error", "match.detail"),
      );
    }
  };
  const openChat = () => {
    if (!match) return;
    router.push(`/chat/${match.id}`);
  };
  const openInMaps = async (rep: ReportFull) => {
    const lat = Number(rep?.lat);
    const lng = Number(rep?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert(
        tr(language, "matchDetail.map"),
        tr(language, "matchDetail.map.position.is.missing.for.this.report"),
      );
      return;
    }
    const label = encodeURIComponent(rep.location_label || "Funnsted");
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${lat},${lng}&q=${label}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    if (!url) return;
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert(
        tr(language, "matchDetail.map"),
        tr(language, "matchDetail.could.not.open.maps.on.this.device"),
      );
      return;
    }
    await Linking.openURL(url);
  };
  const openViewerForReport = (reportId: string, index: number) => {
    const urls = thumbs[reportId] || [];
    if (!urls.length) return;
    setViewerImages(urls.map((u) => ({ uri: u })));
    setViewerIndex(Math.max(0, Math.min(index, urls.length - 1)));
    setViewerVisible(true);
  };
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>
          {tr(language, "matchDetail.loading")}
        </Text>
      </View>
    );
  }
  if (!match) {
    return (
      <View style={styles.center}>
        <Text>{tr(language, "matchDetail.missing.match")}</Text>
      </View>
    );
  }
  const level =
    match.score >= 85 ? 4 : match.score >= 70 ? 3 : match.score >= 55 ? 2 : 1;
  const hiddenLow = level < 2;
  const areaSummary = areaSummaryForMatch(match, language);
  const objectCompare = objectComparison(match, language);
  const counterpartSeen = timeAgoLong(
    match.found?.occurred_at ||
      match.found?.created_at ||
      match.lost?.occurred_at ||
      match.lost?.created_at,
    language,
  );
  const latestReportAt =
    [match.lost?.created_at, match.found?.created_at]
      .map((iso) => ({ iso, t: Date.parse(String(iso ?? "")) }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => b.t - a.t)[0]?.iso ?? null;
  const reportUpdatedAgo = timeAgoLong(latestReportAt, language);
  const lastFromMe = lastMsg?.sender_id === user?.id;
  const lastLine = lastMsg
    ? tr(language, lastFromMe ? "matchDetail.lastMessageFromYou" : "matchDetail.lastMessageFromOther", {
        message: shortMessage(lastMsg.body),
      })
    : tr(language, "matchDetail.noMessagesYet");
  // Din rapport/motpart basert på user_id
  const youOwnLost = match.lost?.user_id === user?.id;
  const youOwnFound = match.found?.user_id === user?.id;
  const labelLostOwner = youOwnLost
    ? tr(language, "matchDetail.your.case")
    : tr(language, "matchDetail.other.party");
  const labelFoundOwner = youOwnFound
    ? tr(language, "matchDetail.your.case")
    : tr(language, "matchDetail.other.party");
  const ReportBlock = ({
    rep,
    ownerLabel,
  }: {
    rep: ReportFull;
    ownerLabel: string;
  }) => {
    const urls = thumbs[rep.id] || [];
    const cat = categoryLabel(rep.category, language);
    const sub = subcategoryLabel(rep.category, rep.subcategory_key, language);
    const col = colorLabel(rep.color, language);
    const brand = titleCase(rep.brand);
    const place = shortPlace(rep.location_label);
    const canOpenMap =
      match.status === "CONFIRMED" &&
      rep.type === "FOUND" &&
      rep.user_id !== user?.id &&
      Number.isFinite(Number(rep.lat)) &&
      Number.isFinite(Number(rep.lng));
    return (
      <View style={styles.repCard}>
        <Text style={styles.repOwner}>{ownerLabel}</Text>
        <Text style={styles.repTitle}>{prettyHeading(rep, language)}</Text>
        {!!rep.description && rep.type === "LOST" && (
          <View style={styles.finderMessageBox}>
            <Text style={styles.finderMessageLabel}>
              {tr(language, "matchDetail.message.to.finder")}
            </Text>
            <Text style={styles.finderMessageText}>{rep.description}</Text>
          </View>
        )}
        <View style={styles.metaRow}>
          {!!cat && <Text style={styles.badge}>{cat}</Text>}
          {!!sub && <Text style={styles.badge}>{sub}</Text>}
          {!!col && (
            <Text style={styles.badge}>
              {tr(language, "matchDetail.color")}: {col}
            </Text>
          )}
          {!!secondaryColorValue(rep) && (
            <Text style={styles.badge}>
              {tr(language, "matchDetail.secondary.color")}:{" "}
              {colorLabel(secondaryColorValue(rep), language)}
            </Text>
          )}
          {!!brand && (
            <Text style={styles.badge}>
              {tr(language, "matchDetail.brand")}: {brand}
            </Text>
          )}
          {!!place && (
            <Text style={styles.badge}>
              {tr(language, "matchDetail.place")}: {place}
            </Text>
          )}
        </View>
        {canOpenMap && (
          <View style={styles.locationHelpBox}>
            <Text style={styles.locationHelpText}>
              {tr(
                language,
                "matchDetail.you.can.open.the.exact.find.location.in.maps",
              )}
            </Text>
            <Pressable
              style={styles.mapLinkBtn}
              onPress={() => openInMaps(rep)}
            >
              <Text style={styles.mapLinkTxt}>
                {tr(language, "matchDetail.open.in.maps")}
              </Text>
            </Pressable>
          </View>
        )}
        {!!rep.description && rep.type !== "LOST" && (
          <Text style={styles.repDesc}>{rep.description}</Text>
        )}
        {urls.length ? (
          <View style={styles.thumbRow}>
            {urls.map((u, idx) => (
              <Pressable
                key={u}
                onPress={() => openViewerForReport(rep.id, idx)}
              >
                <Image source={{ uri: u }} style={styles.thumb} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>
            {tr(language, "matchDetail.no.images")}
          </Text>
        )}
        {typeof rep.reward_ore === "number" && rep.reward_ore > 0 && (
          <Text style={styles.reward}>
            {tr(language, "matchDetail.reward")}:{" "}
            {formatMoney(rep.reward_ore / 100, STORED_MONEY_CURRENCY, language)}
          </Text>
        )}
      </View>
    );
  };
  return (
    <>
      <Stack.Screen options={{ title: tr(language, "matchDetail.screenTitle") }} />
      <ImageViewing
        images={viewerImages}
        imageIndex={viewerIndex}
        visible={viewerVisible}
        onRequestClose={() => setViewerVisible(false)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
        <PremiumHeader
          title={tr(language, "matchDetail.match")}
          subtitle={tr(language, "matchDetail.details.and.photos")}
          onBack={() => router.back()}
          right={<AuthHeaderAction />}
        />
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <Text style={styles.hTitle}>
              {scoreLabel(match.score, language)} •{" "}
              {statusLabel(match.status, language)}
            </Text>
            {unread && <Text style={styles.unreadDot}>●</Text>}
          </View>
          <Text style={styles.headerBlurb}>
            {objectCompare.same
              ? tr(
                  language,
                  "matchDetail.the.reported.item.type.is.the.same.in.both.cases",
                )
              : tr(
                  language,
                  "matchDetail.the.item.descriptions.differ.but.the.items.are.r",
                )}
          </Text>
          {!!objectCompare.value && (
            <View style={styles.compareBox}>
              <Text style={styles.compareLabel}>
                {tr(language, "matchDetail.item.comparison")}
              </Text>
              <Text style={styles.compareValue}>{objectCompare.value}</Text>
              {!!objectCompare.note && (
                <Text style={styles.compareNote}>{objectCompare.note}</Text>
              )}
            </View>
          )}
          <View style={styles.metaRow}>
            {!!areaSummary && (
              <Text style={styles.badge}>
                {tr(language, "matchDetail.location")}: {areaSummary}
              </Text>
            )}
            {!!counterpartSeen && (
              <Text style={styles.badge}>
                {tr(language, "matchDetail.last.seen")}: {counterpartSeen}
              </Text>
            )}
            {!!reportUpdatedAgo && (
              <Text style={styles.badge}>
                {tr(language, "matchDetail.case.updated")}: {reportUpdatedAgo}
              </Text>
            )}
          </View>
          <Text style={styles.lastLine}>{lastLine}</Text>
          {hiddenLow && (
            <Text style={styles.muted}>
              {tr(language, "matchDetail.lowMatchHidden")}
            </Text>
          )}
        </View>
        {/* VS-bilde: vis toppbilde fra begge rapporter når tilgjengelig */}
        <View style={styles.vsCard}>
          <Text style={styles.vsTitle}>
            {tr(language, "matchDetail.images.your.case.vs.other.party")}
          </Text>
          <View style={styles.vsRow}>
            <Pressable
              style={[styles.vsCol, styles.vsColLeft]}
              onPress={() => {
                const your = youOwnLost
                  ? match.lost
                  : youOwnFound
                    ? match.found
                    : match.lost;
                const other =
                  your.id === match.lost.id ? match.found : match.lost;
                const yourUrls = thumbs[your.id] ?? [];
                const otherUrls = thumbs[other.id] ?? [];
                const all = [...yourUrls, ...otherUrls];
                if (!all.length) return;
                setViewerImages(all.map((u) => ({ uri: u })));
                setViewerIndex(0);
                setViewerVisible(true);
              }}
            >
              <Text style={styles.vsLabel}>
                {tr(language, "matchDetail.yours")}
              </Text>
              {(thumbs[
                youOwnLost
                  ? match.lost.id
                  : youOwnFound
                    ? match.found.id
                    : match.lost.id
              ] ?? [])[0] ? (
                <Image
                  source={{
                    uri: (thumbs[
                      youOwnLost
                        ? match.lost.id
                        : youOwnFound
                          ? match.found.id
                          : match.lost.id
                    ] ?? [])[0],
                  }}
                  style={styles.vsThumb}
                />
              ) : (
                <View style={styles.vsThumbPlaceholder} />
              )}
            </Pressable>
            <View style={styles.vsMid}>
              <Text style={styles.vsMidTxt}>VS</Text>
            </View>
            <Pressable
              style={[styles.vsCol, styles.vsColRight]}
              onPress={() => {
                const your = youOwnLost
                  ? match.lost
                  : youOwnFound
                    ? match.found
                    : match.lost;
                const other =
                  your.id === match.lost.id ? match.found : match.lost;
                const yourUrls = thumbs[your.id] ?? [];
                const otherUrls = thumbs[other.id] ?? [];
                const all = [...yourUrls, ...otherUrls];
                if (!all.length) return;
                setViewerImages(all.map((u) => ({ uri: u })));
                setViewerIndex(Math.max(0, yourUrls.length));
                setViewerVisible(true);
              }}
            >
              <Text style={styles.vsLabel}>
                {tr(language, "matchDetail.other.party")}
              </Text>
              {(thumbs[
                youOwnLost
                  ? match.found.id
                  : youOwnFound
                    ? match.lost.id
                    : match.found.id
              ] ?? [])[0] ? (
                <Image
                  source={{
                    uri: (thumbs[
                      youOwnLost
                        ? match.found.id
                        : youOwnFound
                          ? match.lost.id
                          : match.found.id
                    ] ?? [])[0],
                  }}
                  style={styles.vsThumb}
                />
              ) : (
                <View style={styles.vsThumbPlaceholder} />
              )}
            </Pressable>
          </View>
          <Text style={styles.vsHint}>
            {tr(
              language,
              "matchDetail.tap.an.image.to.open.all.images.in.one.viewer",
            )}
          </Text>
        </View>
        <ReportBlock
          rep={match.lost}
          ownerLabel={`${labelLostOwner} (${tr(language, "matchDetail.lost")})`}
        />
        <ReportBlock
          rep={match.found}
          ownerLabel={`${labelFoundOwner} (${tr(language, "matchDetail.found")})`}
        />
        <View style={styles.actions}>
          {match.status === "CONFIRMED" ? (
            <>
              <Pressable
                style={[styles.btn, styles.btnOutline]}
                onPress={() => setStatus("DISMISSED")}
              >
                <Text style={styles.btnOutlineTxt}>
                  {tr(language, "matchDetail.dismiss")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={openChat}
              >
                <Text style={styles.btnPrimaryTxt}>
                  {unread
                    ? tr(language, "matchDetail.open.chat.new.message")
                    : tr(language, "matchDetail.open.chat")}
                </Text>
              </Pressable>
            </>
          ) : youOwnLost ? (
            <>
              <Pressable
                style={[styles.btn, styles.btnOutline]}
                onPress={() => setStatus("DISMISSED")}
              >
                <Text style={styles.btnOutlineTxt}>
                  {tr(language, "matchDetail.dismiss")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => setStatus("CONFIRMED")}
              >
                <Text style={styles.btnPrimaryTxt}>
                  {tr(language, "matchDetail.confirm.match")}
                </Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingTitle}>
                {tr(
                  language,
                  "matchDetail.waiting.for.approval.from.the.owner",
                )}
              </Text>
              <Text style={styles.pendingText}>
                {tr(
                  language,
                  "matchDetail.chat.opens.only.when.the.owner.has.confirmed.the",
                )}
              </Text>
            </View>
          )}
        </View>
        {match.status !== "CONFIRMED" && !youOwnLost && (
          <Text style={styles.infoNote}>
            {tr(
              language,
              "matchDetail.you.can.view.details.now.chat.opens.automaticall",
            )}
          </Text>
        )}
      </ScrollView>
    </>
  );
}
const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  backTxt: { fontWeight: "900", color: "#111", fontSize: 18 },
  h1: { fontSize: 22, fontWeight: "900", color: "#111" },
  h2: { marginTop: 2, color: "#666", fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hTitle: { fontWeight: "900", fontSize: 16, flex: 1, paddingRight: 8 },
  unreadDot: { color: "#2563EB", fontWeight: "900" },
  headerBlurb: {
    marginTop: 8,
    color: "#334155",
    fontWeight: "700",
    lineHeight: 20,
  },
  compareBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  compareLabel: {
    color: "#9A3412",
    fontWeight: "900",
    fontSize: 12,
    textTransform: "uppercase",
  },
  compareValue: {
    marginTop: 4,
    color: "#111827",
    fontWeight: "900",
    fontSize: 16,
  },
  compareNote: {
    marginTop: 3,
    color: "#9A3412",
    fontWeight: "700",
    fontSize: 12,
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    fontWeight: "700",
    color: "#111",
    fontSize: 12,
  },
  lastLine: { marginTop: 10, color: "#111", fontWeight: "700" },
  repCard: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  repOwner: { color: "#666", fontWeight: "900" },
  repTitle: { marginTop: 6, fontWeight: "900", fontSize: 16 },
  repDesc: { marginTop: 8, color: "#333" },
  finderMessageBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  finderMessageLabel: {
    color: "#1D4ED8",
    fontWeight: "900",
    marginBottom: 4,
    fontSize: 12,
    textTransform: "uppercase",
  },
  finderMessageText: { color: "#1E293B", fontWeight: "700", lineHeight: 20 },
  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: "#eee" },
  muted: { marginTop: 8, color: "#666", fontWeight: "600" },
  reward: { marginTop: 10, fontWeight: "800" },
  locationHelpBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  locationHelpText: { color: "#475569", fontWeight: "700", lineHeight: 19 },
  mapLinkBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  mapLinkTxt: { color: "#1D4ED8", fontWeight: "900" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  pendingCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  pendingTitle: { color: "#0F172A", fontWeight: "900", marginBottom: 4 },
  pendingText: { color: "#475569", fontWeight: "700", lineHeight: 18 },
  infoNote: { marginTop: 10, color: "#666", fontWeight: "700" },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnPrimary: { backgroundColor: "#2563EB" },
  btnPrimaryTxt: { color: "#fff", fontWeight: "900" },
  btnOutline: { borderWidth: 1, borderColor: "#b00", backgroundColor: "#fff" },
  btnOutlineTxt: { color: "#b00", fontWeight: "900" },
  // VS-bilde (din vs motpart)
  vsCard: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  vsTitle: { fontWeight: "900", fontSize: 14, color: "#111" },
  vsRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  vsCol: { flex: 1 },
  vsColLeft: { paddingRight: 6 },
  vsColRight: { paddingLeft: 6 },
  vsLabel: { fontWeight: "900", color: "#666", marginBottom: 6 },
  vsThumb: {
    width: "100%",
    height: 120,
    borderRadius: 12,
    backgroundColor: "#eee",
  },
  vsThumbPlaceholder: {
    width: "100%",
    height: 120,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  vsMid: { width: 42, alignItems: "center", justifyContent: "center" },
  vsMidTxt: { fontWeight: "900", color: "#111" },
  vsHint: { marginTop: 8, color: "#666", fontWeight: "600" },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MatchDetailsScreen);
