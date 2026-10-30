// app/matches/[matchId].tsx
// T1.9F: match details. Shows both sides' photos, how the cases compare, the reward and the
// owner's message, and the next step: the owner confirms (chat opens) or says "Not mine".
// The finder waits until the owner has confirmed.
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import ImageViewing from "react-native-image-viewing";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { getLastSeenMap } from "../../src/lib/unread";
import { useAuth } from "../../src/contexts/AuthContext";
import { shortPlace } from "../../src/lib/places";
import { useI18n } from "../../src/i18n/I18nProvider";
import type { TranslationKey } from "../../src/i18n/locales/en";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { colorName, itemName } from "../../src/i18n/catalog";
import {
  formatDistance,
  formatLocalizedDateTime,
  formatMoney,
} from "../../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../../src/lib/market";
import { caseTitle } from "../../src/lib/caseDisplay";
import { reportDescriptionText, reportSecondaryColor } from "../../src/lib/reportDescription";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { theme } from "../../src/ui/theme";
import {
  Button,
  ConfirmSheet,
  InfoButton,
  ScoreBadge,
  ScoreLevelsExplained,
  ScreenHeader,
  scoreLevel,
} from "../../src/ui/kit";

type Reason = { k: string; v: any };
type ReportFull = {
  id: string;
  user_id: string;
  type: "LOST" | "FOUND";
  category?: string;
  subcategory_key?: string;
  subcategory_custom?: string | null;
  title?: string;
  description?: string | null;
  color?: string | null;
  secondary_color?: string | null;
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
type LastMsg = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
type Lang = "no" | "en";
type Mark = "good" | "partial" | "bad" | "unknown";
type CompareRow = { key: string; labelKey: TranslationKey; value: string; mark: Mark };

const reasonVal = (reasons: Reason[] | undefined, key: string) => (reasons ?? []).find((r) => r?.k === key)?.v;

function radiusOf(rep?: ReportFull | null) {
  for (const raw of [rep?.radius_m, rep?.search_radius_m, rep?.area_radius_m, rep?.location_radius_m]) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function titleCase(s?: string | null) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function colorsOf(rep: ReportFull) {
  return [rep.color, reportSecondaryColor(rep)].map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
}

// The rows of "How the cases compare". Each row says what was compared and how well it fits.
function compareRows(m: MatchFull, language: Lang, t: (k: TranslationKey, p?: any) => string): CompareRow[] {
  const rows: CompareRow[] = [];
  const lostItem = itemName(m.lost.subcategory_key, language, m.lost.category);
  const foundItem = itemName(m.found.subcategory_key, language, m.found.category);
  const level = Number(reasonVal(m.reasons, "object_match_level"));
  const sameItem = !!lostItem && lostItem.toLowerCase() === foundItem.toLowerCase();
  if (lostItem || foundItem) {
    rows.push({
      key: "item",
      labelKey: "matchDetail.compare.item",
      value: sameItem
        ? t("matchDetail.compare.sameType", { item: lostItem })
        : `${lostItem || t("matchDetail.compare.notGiven")} ↔ ${foundItem || t("matchDetail.compare.notGiven")}`,
      mark: sameItem || level >= 3 ? "good" : level === 2 ? "partial" : "bad",
    });
  }

  const lostColors = colorsOf(m.lost);
  const foundColors = colorsOf(m.found);
  const shared = lostColors.find((c) => foundColors.includes(c));
  if (lostColors.length || foundColors.length) {
    rows.push({
      key: "color",
      labelKey: "matchDetail.compare.color",
      value: shared
        ? colorName(shared, language)
        : `${lostColors[0] ? colorName(lostColors[0], language) : t("matchDetail.compare.notGiven")} ↔ ${
            foundColors[0] ? colorName(foundColors[0], language) : t("matchDetail.compare.notGiven")
          }`,
      mark: shared ? "good" : lostColors.length && foundColors.length ? "bad" : "unknown",
    });
  }

  const lostBrand = titleCase(m.lost.brand);
  const foundBrand = titleCase(m.found.brand);
  if (lostBrand || foundBrand) {
    const same = !!lostBrand && lostBrand === foundBrand;
    rows.push({
      key: "brand",
      labelKey: "matchDetail.compare.brand",
      value: same
        ? lostBrand
        : lostBrand && foundBrand
          ? `${lostBrand} ↔ ${foundBrand}`
          : t("matchDetail.compare.brandOneSide", { brand: lostBrand || foundBrand }),
      mark: same ? "good" : lostBrand && foundBrand ? "bad" : "unknown",
    });
  }

  const tt = (k: TranslationKey, p?: any) => t(k, p);
  const dist = Number(reasonVal(m.reasons, "distance_m"));
  const radius = radiusOf(m.lost);
  const inside =
    [true, "true", 1, "1"].includes(reasonVal(m.reasons, "within_radius") ?? reasonVal(m.reasons, "inside_area")) ||
    (Number.isFinite(dist) && radius != null && dist <= radius);
  if (inside || Number.isFinite(dist)) {
    rows.push({
      key: "place",
      labelKey: "matchDetail.compare.place",
      value: inside
        ? t("matchDetail.within.selected.area")
        : t("matchDetail.compare.distanceFromLost", { distance: formatDistance(dist, language, tt) }),
      mark: inside ? "good" : dist <= 3000 ? "partial" : "bad",
    });
  }

  const days = Number(reasonVal(m.reasons, "days_apart"));
  if (Number.isFinite(days)) {
    const whole = Math.round(Math.abs(days));
    rows.push({
      key: "time",
      labelKey: "matchDetail.compare.time",
      value: whole === 0 ? t("matchDetail.compare.sameDay") : t("matchDetail.compare.daysBetween", { count: whole }),
      mark: whole <= 3 ? "good" : whole <= 14 ? "partial" : "bad",
    });
  }
  return rows;
}

const MARK_ICON: Record<Mark, { name: React.ComponentProps<typeof Ionicons>["name"]; color: string; labelKey: TranslationKey }> = {
  good: { name: "checkmark", color: "#166534", labelKey: "matchDetail.compare.markGood" },
  partial: { name: "remove", color: "#B45309", labelKey: "matchDetail.compare.markPartial" },
  unknown: { name: "help", color: "#475569", labelKey: "matchDetail.compare.markUnknown" },
  bad: { name: "close", color: "#B91C1C", labelKey: "matchDetail.compare.markBad" },
};

async function signedUrls(paths: string[], token: string): Promise<Record<string, string>> {
  const r = await fetch(`${API_BASE_URL}/storage/signed-download-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ paths }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(data?.error || "SIGNED_URLS_FAILED")), { status: r.status });
  return (data?.urls ?? {}) as Record<string, string>;
}

function MatchDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { language, t } = useI18n();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = useMemo(() => (Array.isArray(params?.matchId) ? params.matchId[0] : params?.matchId), [params?.matchId]);

  const [match, setMatch] = useState<MatchFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({});
  const [lastMsg, setLastMsg] = useState<LastMsg | null>(null);
  const [unread, setUnread] = useState(false);
  const [sheet, setSheet] = useState<null | "confirm" | "dismiss">(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{ images: { uri: string }[]; index: number } | null>(null);
  const lastSeenRef = useRef<Record<string, string>>({});

  const computeUnread = useCallback(
    (msg: LastMsg | null) => {
      if (!user?.id || !matchId || !msg) return false;
      const seen = lastSeenRef.current[matchId];
      return msg.sender_id !== user.id && (!seen || new Date(msg.created_at) > new Date(seen));
    },
    [user?.id, matchId],
  );

  const fetchLastMessage = useCallback(async () => {
    if (!matchId) return;
    lastSeenRef.current = await getLastSeenMap();
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, body, created_at")
      .eq("conversation_id", matchId)
      .order("created_at", { ascending: false })
      .limit(1);
    const m = data && data[0] ? (data[0] as any as LastMsg) : null;
    setLastMsg(m);
    setUnread(computeUnread(m));
  }, [matchId, computeUnread]);

  const fetchMatch = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw codedError("LOGIN_REQUIRED");
      const r = await fetch(`${API_BASE_URL}/matches/${matchId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(codedError(String(data?.error || "MATCH_LOAD_FAILED")), { status: r.status });
      const m: MatchFull = data.match;
      setMatch(m);
      const load = async (rep: ReportFull) => {
        const paths = (rep?.report_images ?? []).slice(0, 10).map((x) => x.path).filter(Boolean);
        if (!paths.length) return;
        try {
          const map = await signedUrls(paths, token);
          const urls = paths.map((p) => map[p]).filter(Boolean) as string[];
          if (urls.length) setThumbs((prev) => ({ ...prev, [rep.id]: urls }));
        } catch (e) {
          console.warn("[match-detail] signed urls failed", e);
        }
      };
      await Promise.allSettled([load(m.lost), load(m.found)]);
      await fetchLastMessage();
    } catch (e) {
      setLoadError(userErrorMessage(e, t, "matchDetail.unknown.error", "match.detail"));
    } finally {
      setLoading(false);
    }
  }, [matchId, fetchLastMessage, t]);

  useEffect(() => {
    void fetchMatch();
  }, [fetchMatch]);

  useFocusEffect(
    useCallback(() => {
      void fetchLastMessage();
      return () => {};
    }, [fetchLastMessage]),
  );

  useEffect(() => {
    if (!matchId || !user?.id) return;
    const channel = supabase
      .channel(`realtime:match-detail:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${matchId}` },
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

  const setStatus = async (status: "CONFIRMED" | "DISMISSED") => {
    if (!matchId) return;
    setBusy(true);
    setActionError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw codedError("LOGIN_REQUIRED");
      const r = await fetch(`${API_BASE_URL}/matches/${matchId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(codedError(String(data?.error || "MATCH_STATUS_FAILED")), { status: r.status });
      setSheet(null);
      if (status === "CONFIRMED") {
        router.push(`/chat/${matchId}`);
      }
      await fetchMatch();
    } catch (e) {
      setSheet(null);
      setActionError(userErrorMessage(e, t, "matchDetail.unknown.error", "match.status"));
    } finally {
      setBusy(false);
    }
  };

  const openInMaps = async (rep: ReportFull) => {
    const lat = Number(rep?.lat);
    const lng = Number(rep?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setActionError(t("matchDetail.map.position.is.missing.for.this.report"));
      return;
    }
    const label = encodeURIComponent(rep.location_label || t("matchDetail.mapPinLabel"));
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${lat},${lng}&q=${label}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    if (!url) return;
    if (!(await Linking.canOpenURL(url))) {
      setActionError(t("matchDetail.could.not.open.maps.on.this.device"));
      return;
    }
    await Linking.openURL(url);
  };

  const header = (
    <ScreenHeader
      title={t("matchDetail.screenTitle")}
      onBack={() => router.back()}
      right={
        <InfoButton title={t("info.matchLevels.title")} body={t("info.matchLevels.body")} label={t("info.matchLevels.label")}>
          <ScoreLevelsExplained />
        </InfoButton>
      }
    />
  );

  if (loading && !match) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.muted}>{t("matchDetail.loading")}</Text>
        </View>
      </View>
    );
  }

  if (!match) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <View style={styles.content}>
          <InlineNotice
            tone="error"
            title={loadError ?? t("matchDetail.missing.match")}
            actionLabel={t("errors.retry")}
            onAction={() => void fetchMatch()}
          />
        </View>
      </View>
    );
  }

  const youOwnLost = match.lost?.user_id === user?.id;
  const own = youOwnLost ? match.lost : match.found;
  const other = youOwnLost ? match.found : match.lost;
  const confirmed = match.status === "CONFIRMED";
  const dismissed = match.status === "DISMISSED";
  const level = scoreLevel(Number(match.score || 0));
  const rows = compareRows(match, language, t);
  const ownerMessage = reportDescriptionText(match.lost?.description);
  const finderDescription = reportDescriptionText(match.found?.description);
  const reward = Number(match.lost?.reward_ore || 0);
  const foundPlace = shortPlace(match.found?.location_label);
  const canOpenMap =
    confirmed && youOwnLost && Number.isFinite(Number(match.found?.lat)) && Number.isFinite(Number(match.found?.lng));

  const sideLabel = (rep: ReportFull) =>
    t("matchDetail.sideLabel", {
      who: rep.user_id === user?.id ? t("matchDetail.your.case") : t("matchDetail.other.party"),
      type: rep.type === "LOST" ? t("common.lost") : t("common.found"),
    });

  const openViewer = (startWith: ReportFull) => {
    const first = thumbs[startWith.id] ?? [];
    const second = thumbs[(startWith.id === own.id ? other : own).id] ?? [];
    const all = [...first, ...second];
    if (!all.length) return;
    setViewer({ images: all.map((uri) => ({ uri })), index: 0 });
  };

  const photo = (rep: ReportFull) => {
    const url = (thumbs[rep.id] ?? [])[0];
    return (
      <Pressable
        style={styles.photoCol}
        onPress={() => openViewer(rep)}
        accessibilityRole="imagebutton"
        accessibilityLabel={t("matchDetail.openPhotos", { side: sideLabel(rep) })}
      >
        {url ? (
          <Image source={{ uri: url }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]}>
            <Ionicons name="image-outline" size={24} color={theme.colors.textSecondary} />
            <Text style={styles.photoEmptyText}>{t("matchDetail.noImage")}</Text>
          </View>
        )}
        <Text style={[styles.sideLabel, { color: rep.type === "LOST" ? "#92400E" : "#166534" }]}>{sideLabel(rep)}</Text>
      </Pressable>
    );
  };

  const lastLine = lastMsg
    ? t(lastMsg.sender_id === user?.id ? "matchDetail.lastMessageFromYou" : "matchDetail.lastMessageFromOther", {
        message: lastMsg.body.length > 70 ? `${lastMsg.body.slice(0, 67)}…` : lastMsg.body,
      })
    : t("matchDetail.noMessagesYet");

  const showOwnerActions = youOwnLost && !confirmed && !dismissed;
  const showChatAction = confirmed;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ImageViewing
        images={viewer?.images ?? []}
        imageIndex={viewer?.index ?? 0}
        visible={!!viewer}
        onRequestClose={() => setViewer(null)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <ScoreBadge level={level} />
            <Text style={[styles.status, unread && styles.statusUnread]}>
              {t(
                confirmed
                  ? "match.status.confirmed"
                  : dismissed
                    ? "match.status.dismissed"
                    : match.status === "NEW"
                      ? "match.status.new"
                      : "match.status.seen",
              )}
            </Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {caseTitle(other, language)}
          </Text>
          <View style={styles.photos}>
            {photo(own)}
            {photo(other)}
          </View>
          <Text style={styles.hint}>{t("matchDetail.tap.an.image.to.open.all.images.in.one.viewer")}</Text>
        </View>

        {rows.length > 0 && (
          <View style={[styles.card, styles.compareCard]}>
            <Text style={styles.cardTitle}>{t("matchDetail.compare.title")}</Text>
            {rows.map((row, i) => {
              const mark = MARK_ICON[row.mark];
              return (
                <View key={row.key} style={[styles.compareRow, i < rows.length - 1 && styles.compareDivider]}>
                  <Ionicons name={mark.name} size={20} color={mark.color} accessibilityLabel={t(mark.labelKey)} />
                  <Text style={styles.compareLabel}>{t(row.labelKey)}</Text>
                  <Text style={styles.compareValue}>{row.value}</Text>
                </View>
              );
            })}
          </View>
        )}

        {(reward > 0 || !!match.found?.occurred_at || !!foundPlace || !!ownerMessage || !!finderDescription) && (
          <View style={styles.card}>
            {reward > 0 && (
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>{t("matchDetail.reward")}</Text>
                <Text style={styles.factValue}>{formatMoney(reward / 100, STORED_MONEY_CURRENCY, language)}</Text>
              </View>
            )}
            {!!match.found?.occurred_at && (
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>{t("matchDetail.foundAt")}</Text>
                <Text style={styles.factValue}>{formatLocalizedDateTime(match.found.occurred_at, language)}</Text>
              </View>
            )}
            {!!foundPlace && (
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>{t("matchDetail.place")}</Text>
                <Text style={styles.factValue}>{foundPlace}</Text>
              </View>
            )}
            {!!ownerMessage && (
              <View style={styles.textBlock}>
                <Text style={styles.factLabel}>{t("matchDetail.message.to.finder")}</Text>
                <Text style={styles.bodyText}>{ownerMessage}</Text>
              </View>
            )}
            {!!finderDescription && (
              <View style={styles.textBlock}>
                <Text style={styles.factLabel}>{t("matchDetail.finderDescription")}</Text>
                <Text style={styles.bodyText}>{finderDescription}</Text>
              </View>
            )}
            {canOpenMap && (
              <Button
                label={t("matchDetail.open.in.maps")}
                variant="secondary"
                onPress={() => void openInMaps(match.found)}
                accessibilityHint={t("matchDetail.you.can.open.the.exact.find.location.in.maps")}
              />
            )}
          </View>
        )}

        {!!actionError && <InlineNotice tone="error" title={actionError} style={styles.noticeTight} />}

        {level === "low" && <InlineNotice tone="info" icon="information-circle-outline" title={t("matchDetail.lowMatchHidden")} style={styles.noticeTight} />}

        {showOwnerActions && (
          <InlineNotice tone="info" icon="chatbubble-outline" title={t("matchDetail.ownerHint")} style={styles.noticeTight} />
        )}
        {!youOwnLost && !confirmed && !dismissed && (
          <InlineNotice
            tone="info"
            icon="time-outline"
            title={t("matchDetail.waiting.for.approval.from.the.owner")}
            body={t("matchDetail.chat.opens.only.when.the.owner.has.confirmed.the")}
            style={styles.noticeTight}
          />
        )}
        {dismissed && (
          <InlineNotice tone="warning" icon="close-circle-outline" title={t("matchDetail.dismissedNotice")} style={styles.noticeTight} />
        )}
        {confirmed && (
          <View style={styles.card}>
            <View style={styles.badgeRow}>
              <Ionicons name="chatbubble-outline" size={18} color={unread ? theme.colors.unread : theme.colors.textSecondary} />
              <Text style={[styles.lastLine, unread && styles.statusUnread]}>{lastLine}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {(showOwnerActions || showChatAction) && (
        <View style={[styles.bar, { paddingBottom: Math.max(16, insets.bottom + 6) }]}>
          {showOwnerActions ? (
            <>
              <Button label={t("matchDetail.notMine")} variant="neutral" onPress={() => setSheet("dismiss")} style={styles.flex1} />
              <Button label={t("matchDetail.confirm.match")} onPress={() => setSheet("confirm")} style={styles.flex2} />
            </>
          ) : (
            <Button
              label={unread ? t("matchDetail.open.chat.new.message") : t("matchDetail.open.chat")}
              onPress={() => router.push(`/chat/${match.id}`)}
              style={styles.flex1}
            />
          )}
        </View>
      )}

      <ConfirmSheet
        visible={sheet === "confirm"}
        title={t("matchDetail.confirmSheet.title")}
        body={t("matchDetail.confirmSheet.body")}
        confirmLabel={t("matchDetail.confirm.match")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void setStatus("CONFIRMED")}
        onCancel={() => setSheet(null)}
        busy={busy}
      />
      <ConfirmSheet
        visible={sheet === "dismiss"}
        title={t("matchDetail.dismissSheet.title")}
        body={t("matchDetail.dismissSheet.body")}
        confirmLabel={t("matchDetail.notMine")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void setStatus("DISMISSED")}
        onCancel={() => setSheet(null)}
        destructive
        busy={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  muted: { color: theme.colors.textSecondary, fontWeight: "600" },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  status: { marginLeft: "auto", fontSize: 12, fontWeight: "800", color: theme.colors.textSecondary },
  statusUnread: { color: theme.colors.unread },
  title: { fontSize: 22, fontWeight: "900", color: theme.colors.text },
  photos: { flexDirection: "row", gap: 10 },
  photoCol: { flex: 1, gap: 6 },
  photo: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: "#E2E8F0" },
  photoEmpty: { alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderStyle: "dashed", borderColor: "#CBD5E1", backgroundColor: "#F1F5F9" },
  photoEmptyText: { fontSize: 12, fontWeight: "700", color: theme.colors.textSecondary },
  sideLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  compareCard: { paddingVertical: 6, gap: 0 },
  cardTitle: { fontSize: 15, fontWeight: "900", color: theme.colors.text, marginTop: 10, marginBottom: 4 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  compareDivider: { borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  compareLabel: { width: 84, fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  compareValue: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.colors.text },
  factRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  factLabel: { fontSize: 14, fontWeight: "700", color: theme.colors.textSecondary },
  factValue: { flexShrink: 1, textAlign: "right", fontSize: 15, fontWeight: "800", color: theme.colors.text },
  textBlock: { gap: 4 },
  bodyText: { fontSize: 15, lineHeight: 21, fontWeight: "500", color: theme.colors.text },
  noticeTight: { marginTop: 0 },
  lastLine: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.colors.text },
  bar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MatchDetailsScreen);
