// app/notifications.tsx
// In-app notification feed with read state, validated deep links, and deletion of unavailable targets.
// T1.9G: tap a card to open it, small trash button per card, "Merk alle som lest", grouped by
// I dag / Tidligere, icon per type. Errors show in the screen instead of system dialogs.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, SectionList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import { theme } from "../src/ui/theme";
import { ConfirmSheet, EmptyState, IconButton, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { groupByDay, notificationIcon, type NotificationTone } from "../src/lib/notificationDisplay";
import { useI18n } from "../src/i18n/I18nProvider";
import { notificationCaseLabel } from "../src/lib/localizedReport";
import { userErrorMessage } from "../src/lib/userError";
import { formatTimeAgo } from "../src/i18n/formatters";
import type { TranslationKey } from "../src/i18n/locales/en";

type Translate = ReturnType<typeof useI18n>["t"];
type Notif = {
  id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  body?: string | null;
  created_at: string;
  read_at?: string | null;
  agg_count?: number | null;
  target_status?: "ok" | "missing";
  target_kind?: "match" | "report" | "chat" | "unknown" | string;
  report_context?: any;
  merged_message?: boolean;
};

function reportHeading(n: Notif, language: "no" | "en", t: Translate) {
  return notificationCaseLabel(n.report_context, language, t) || null;
}

function compactNotifications(items: Notif[]) {
  const lifecyclePriority: Record<string, number> = {
    REPORT_EXPIRING: 1,
    REPORT_EXPIRED: 2,
    REPORT_ARCHIVED: 3,
  };
  const retained = new Map<string, Notif>();
  const hidden = new Set<string>();
  for (const item of items) {
    const type = String(item.type || "").toUpperCase();
    if (!(type in lifecyclePriority) || !item.entity_id) continue;
    const key = `report:${item.entity_id}`;
    const current = retained.get(key);
    if (!current) {
      retained.set(key, item);
      continue;
    }
    const currentType = String(current.type || "").toUpperCase();
    const replace =
      lifecyclePriority[type] > lifecyclePriority[currentType] ||
      (lifecyclePriority[type] === lifecyclePriority[currentType] &&
        new Date(item.created_at).getTime() >
          new Date(current.created_at).getTime());
    if (replace) {
      hidden.add(current.id);
      retained.set(key, item);
    } else hidden.add(item.id);
  }
  const confirmed = new Map<string, Notif>();
  for (const item of items)
    if (
      String(item.type || "").toUpperCase() === "MATCH_CONFIRMED" &&
      item.entity_id
    )
      confirmed.set(item.entity_id, item);
  const merged = new Set<string>();
  for (const item of items) {
    if (
      String(item.type || "").toUpperCase() !== "NEW_MESSAGE" ||
      !item.entity_id
    )
      continue;
    const match = confirmed.get(item.entity_id);
    if (!match) continue;
    if (
      Math.abs(
        new Date(item.created_at).getTime() -
          new Date(match.created_at).getTime(),
      ) <=
      10 * 60 * 1000
    ) {
      hidden.add(item.id);
      merged.add(match.id);
    }
  }
  return items
    .filter((item) => !hidden.has(item.id))
    .map((item) =>
      merged.has(item.id) ? { ...item, merged_message: true } : item,
    );
}

function notificationTitle(n: Notif, language: "no" | "en", t: Translate) {
  const type = String(n.type || "").toUpperCase();
  if (type === "NEW_MATCH") return t("notifications.new.match");
  if (type === "MATCH_CONFIRMED") return t("notifications.match.confirmed");
  if (type === "NEW_MESSAGE") return t("notifications.new.message");
  if (type === "REPORT_UPDATED") return t("notifications.case.updated");
  if (["REPORT_EXPIRING", "REPORT_EXPIRED", "REPORT_ARCHIVED"].includes(type)) {
    return (
      reportHeading(n, language, t) || n.title || t("notifications.notification")
    );
  }
  if (
    type === "RESOLUTION_PROPOSED" ||
    type === "RESOLUTION_CONFIRMED" ||
    type === "RESOLUTION_REJECTED"
  )
    return n.title || t("notifications.case.resolution");
  if (type === "OBSERVATION_MESSAGE")
    return t("notifications.observationMessageTitle");
  if (type === "OBSERVATION_STATUS")
    return t("notifications.observation.update");
  if (type === "AREA_ALERT_OBSERVATION")
    return t("notifications.new.observation");
  if (type === "AREA_ALERT" || type === "GEO_ALERT")
    return t("notifications.lost.item.near.you");
  return String(n.title || t("notifications.notification"));
}

function notificationBody(n: Notif, language: "no" | "en", t: Translate) {
  const type = String(n.type || "").toUpperCase();
  const count = Number(n.agg_count || 0);
  if (type === "NEW_MATCH") {
    if (count > 1) return t("notifications.possible.matches.count", { count });
    return t("notifications.a.possible.match.was.found.for.your.case");
  }
  if (type === "MATCH_CONFIRMED") {
    return n.merged_message
      ? t("notifications.match.confirmed.with.message")
      : t(
          "notifications.the.other.party.has.confirmed.the.match.open.chat.to.continue",
        );
  }
  if (type === "NEW_MESSAGE") {
    return t("notifications.you.have.a.new.chat.message");
  }
  if (type === "REPORT_UPDATED")
    return t("notifications.a.case.has.been.updated");
  if (type === "REPORT_EXPIRING")
    return t("notifications.case.expiring.combined");
  if (type === "REPORT_EXPIRED")
    return t("notifications.case.expired.combined");
  if (type === "REPORT_ARCHIVED")
    return t(
      "notifications.a.found.report.has.been.archived.and.is.available.in.your.history",
    );
  if (type === "OBSERVATION_MESSAGE")
    return t("notifications.observationMessageBody");
  if (type === "AREA_ALERT_OBSERVATION")
    return t("notifications.open.the.observation.for.details");
  if (type === "AREA_ALERT" || type === "GEO_ALERT")
    return t("notifications.areaAlertBody");
  return n.body ? String(n.body) : null;
}

function invalidReasonLabel(n: Notif, language: "no" | "en", t: Translate) {
  if (n.target_kind === "report") return t("notifications.case.unavailable");
  if (n.target_kind === "match") return t("notifications.match.unavailable");
  if (n.target_kind === "chat") return t("notifications.chat.unavailable");
  return t("notifications.unavailable");
}

const ICON_TONES: Record<NotificationTone, { fg: string; bg: string }> = {
  match: { fg: theme.score.possible.fg, bg: theme.score.possible.bg },
  success: { fg: theme.tone.success.icon, bg: "#DCFCE7" },
  info: { fg: theme.tone.info.fg, bg: "#DBEAFE" },
  warning: { fg: theme.tone.warning.icon, bg: "#FEF3C7" },
  neutral: { fg: theme.colors.textSecondary, bg: "#F1F5F9" },
};

type ScreenNotice = { titleKey: TranslationKey; body: string } | null;

function NotificationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { language, t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ScreenNotice>(null);
  const [pendingDelete, setPendingDelete] = useState<Notif | null>(null);
  const [selectedTab, setSelectedTab] = useState<"mine" | "nearby">(params.tab === "nearby" ? "nearby" : "mine");
  useEffect(() => {
    if (params.tab === "nearby") setSelectedTab("nearby");
  }, [params.tab]);

  const getToken = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    return sess.session?.access_token ?? null;
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const token = await getToken();
        if (!token) {
          setItems([]);
          return;
        }
        const r = await fetch(`${API_BASE_URL}/notifications?limit=80`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP_${r.status}`), { status: r.status });
        setItems(compactNotifications((data?.notifications ?? []) as Notif[]));
        setNotice(null);
      } catch (e: any) {
        setNotice({
          titleKey: "notifications.could.not.load.notifications",
          body: userErrorMessage(e, t, "notifications.unknown.error", "notifications.load"),
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getToken, language],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        const token = await getToken();
        if (!token) return;
        await fetch(`${API_BASE_URL}/notifications/${encodeURIComponent(id)}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Read state is best effort; the next load shows the server state.
      }
    },
    [getToken],
  );

  const resolveNotif = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (!token) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
      const r = await fetch(`${API_BASE_URL}/notifications/${encodeURIComponent(id)}/resolve`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP_${r.status}`), { status: r.status });
      return data as { ok: boolean; target_kind?: string; target_id?: string; reason?: string };
    },
    [getToken],
  );

  const deleteNotification = useCallback(
    async (id: string) => {
      try {
        setBusy(true);
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`${API_BASE_URL}/notifications/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP_${r.status}`), { status: r.status });
        setItems((prev) => prev.filter((x) => x.id !== id));
      } catch (e: any) {
        setNotice({
          titleKey: "notifications.could.not.delete.notification",
          body: userErrorMessage(e, t, "notifications.could.not.delete.notification", "notifications.delete"),
        });
      } finally {
        setBusy(false);
        setPendingDelete(null);
      }
    },
    [getToken, language],
  );

  const deleteMissingNotifications = useCallback(async () => {
    try {
      setBusy(true);
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_BASE_URL}/notifications/missing`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP_${r.status}`), { status: r.status });
      await load("refresh");
    } catch (e: any) {
      setNotice({
        titleKey: "notifications.could.not.delete.unavailable.notifications",
        body: userErrorMessage(e, t, "notifications.could.not.delete.unavailable.notifications", "notifications.delete"),
      });
    } finally {
      setBusy(false);
    }
  }, [getToken, language, load]);

  const openNotif = useCallback(
    async (n: Notif) => {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: x.read_at ?? new Date().toISOString() } : x)));
      void markRead(n.id);

      try {
        const notificationType = String(n.type || "").toUpperCase();
        if (
          (notificationType === "OBSERVATION_MESSAGE" ||
            notificationType === "OBSERVATION_STATUS" ||
            notificationType === "AREA_ALERT_OBSERVATION") &&
          n.entity_id
        ) {
          router.push(`/observation/${n.entity_id}`);
          return;
        }
        if ((notificationType === "AREA_ALERT" || notificationType === "GEO_ALERT") && n.entity_id) {
          router.push(`/area-alert/${n.entity_id}`);
          return;
        }
        const resolved = await resolveNotif(n.id);
        if (!resolved.ok || !resolved.target_id) {
          setItems((prev) =>
            prev.map((x) =>
              x.id === n.id
                ? { ...x, target_status: "missing", target_kind: resolved.target_kind || x.target_kind || x.entity_type }
                : x,
            ),
          );
          setNotice({
            titleKey: "notifications.unavailable",
            body: t("notifications.this.notification.points.to.content.that.no.longer.exists.you.can.dele"),
          });
          return;
        }
        if (resolved.target_kind === "chat") {
          router.push(`/chat/${resolved.target_id}`);
          return;
        }
        if (resolved.target_kind === "match") {
          router.push(`/matches/${resolved.target_id}`);
          return;
        }
        if (resolved.target_kind === "report") {
          if (notificationType === "NEW_MATCH") {
            router.push({ pathname: "/match", params: { reportId: resolved.target_id } });
            return;
          }
          // T1.9G: lifecycle notifications open the case itself, where Neste steg shows what to do.
          router.push({ pathname: "/report-details/[id]", params: { id: resolved.target_id } });
          return;
        }
        setNotice({ titleKey: "notifications.unavailable", body: t("notifications.this.notification.could.not.be.opened") });
      } catch (e: any) {
        setNotice({
          titleKey: "notifications.error",
          body: userErrorMessage(e, t, "notifications.could.not.open.the.notification", "notifications.open"),
        });
      }
    },
    [router, markRead, resolveNotif, language],
  );

  const isNearbyNotification = useCallback((item: Notif) => {
    const type = String(item.type || "").toUpperCase();
    return type === "AREA_ALERT" || type === "GEO_ALERT" || String(item.entity_type || "").toLowerCase() === "area_alert_campaign";
  }, []);
  const mineItems = useMemo(() => items.filter((item) => !isNearbyNotification(item)), [items, isNearbyNotification]);
  const nearbyItems = useMemo(() => items.filter(isNearbyNotification), [items, isNearbyNotification]);
  const visibleItems = selectedTab === "nearby" ? nearbyItems : mineItems;
  const mineUnread = useMemo(() => mineItems.filter((x) => !x.read_at).length, [mineItems]);
  const nearbyUnread = useMemo(() => nearbyItems.filter((x) => !x.read_at).length, [nearbyItems]);
  const unreadCount = mineUnread + nearbyUnread;
  const missingCount = useMemo(() => mineItems.filter((x) => x.target_status === "missing").length, [mineItems]);

  const sections = useMemo(() => {
    const { today, earlier } = groupByDay(visibleItems);
    return [
      { key: "today", title: t("notifications.group.today"), data: today },
      { key: "earlier", title: t("notifications.group.earlier"), data: earlier },
    ].filter((x) => x.data.length > 0);
  }, [visibleItems, language]);

  const markAllRead = useCallback(async () => {
    if (!unreadCount) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_BASE_URL}/notifications/read-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw Object.assign(new Error(`HTTP_${r.status}`), { status: r.status });
      const readAt = new Date().toISOString();
      setItems((prev) => prev.map((item) => ({ ...item, read_at: item.read_at || readAt })));
    } catch (e: any) {
      setNotice({ titleKey: "notifications.error", body: userErrorMessage(e, t, "notifications.unknown.error", "notifications.readAll") });
    } finally {
      setBusy(false);
    }
  }, [unreadCount, getToken, language]);

  const tab = (key: "mine" | "nearby", label: string, count: number) => {
    const active = selectedTab === key;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        style={[styles.tab, active && styles.tabActive]}
        onPress={() => setSelectedTab(key)}
      >
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{count ? `${label} · ${count}` : label}</Text>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <ScreenHeader
          title={t("notifications.notifications")}
          subtitle={unreadCount ? t("notifications.unread.count", { count: unreadCount }) : t("notifications.allRead")}
          onBack={() => router.back()}
          right={
            unreadCount ? (
              <Pressable accessibilityRole="button" onPress={() => void markAllRead()} disabled={busy} style={styles.markAll} hitSlop={6}>
                <Text style={styles.markAllText}>{t("notifications.markAllRead")}</Text>
              </Pressable>
            ) : undefined
          }
        >
          <View style={styles.tabs} accessibilityRole="tablist">
            {tab("mine", t("notifications.my.cases"), mineUnread)}
            {tab("nearby", t("notifications.nearby"), nearbyUnread)}
          </View>
        </ScreenHeader>

        {!!notice && (
          <View style={styles.noticeWrap}>
            <InlineNotice tone="warning" title={t(notice.titleKey)} body={notice.body} style={styles.notice} />
          </View>
        )}
        {selectedTab === "mine" && missingCount > 0 && (
          <View style={styles.noticeWrap}>
            <InlineNotice
              tone="info"
              icon="trash-outline"
              title={t("notifications.missingTitle", { count: missingCount })}
              body={t("notifications.missingBody")}
              actionLabel={t("notifications.delete.unavailable")}
              onAction={() => void deleteMissingNotifications()}
              busy={busy}
              style={styles.notice}
            />
          </View>
        )}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.muted}>{t("notifications.loading")}</Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(x) => x.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
            ListEmptyComponent={
              <EmptyState
                icon="notifications-outline"
                title={selectedTab === "nearby" ? t("notifications.no.nearby.alerts.yet") : t("notifications.no.case.notifications.yet")}
                body={selectedTab === "nearby" ? t("notifications.emptyBodyNearby") : t("notifications.emptyBody")}
              />
            }
            renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
            renderItem={({ item }) => {
              const unread = !item.read_at;
              const invalid = item.target_status === "missing";
              const look = notificationIcon(item.type);
              const colors = ICON_TONES[look.tone];
              const title = notificationTitle(item, language, t);
              const caseLabel = !["REPORT_EXPIRING", "REPORT_EXPIRED", "REPORT_ARCHIVED"].includes(String(item.type || "").toUpperCase())
                ? notificationCaseLabel(item.report_context, language, t)
                : "";
              const body = notificationBody(item, language, t);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={[unread ? t("notifications.unreadLabel") : "", title, caseLabel].filter(Boolean).join(", ")}
                  onPress={() => void openNotif(item)}
                  style={({ pressed }) => [styles.card, invalid && styles.cardInvalid, pressed && styles.cardPressed]}
                >
                  <View style={[styles.iconCircle, { backgroundColor: colors.bg }]}>
                    <Ionicons name={look.icon} size={20} color={colors.fg} />
                  </View>
                  <View style={styles.cardText}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.title, !unread && styles.titleRead]} numberOfLines={2}>
                        {title}
                      </Text>
                      <View style={styles.timeWrap}>
                        <Text style={styles.time}>{formatTimeAgo(item.created_at, t, "short")}</Text>
                        {unread && <View style={styles.unreadDot} />}
                      </View>
                    </View>
                    {!!caseLabel && (
                      <Text style={styles.caseContext} numberOfLines={1}>
                        {caseLabel}
                      </Text>
                    )}
                    {!!body && (
                      <Text style={styles.body} numberOfLines={2}>
                        {body}
                      </Text>
                    )}
                    {invalid && (
                      <View style={styles.invalidBadgeWrap}>
                        <Text style={styles.invalidBadgeTxt}>{invalidReasonLabel(item, language, t)}</Text>
                      </View>
                    )}
                  </View>
                  <IconButton
                    icon="trash-outline"
                    label={t("notifications.deleteLabel")}
                    onPress={() => setPendingDelete(item)}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              );
            }}
          />
        )}
      </View>

      <ConfirmSheet
        visible={!!pendingDelete}
        title={t("notifications.delete.notification")}
        body={t("notifications.this.only.removes.the.notification.from.your.list")}
        confirmLabel={t("notifications.delete")}
        cancelLabel={t("notifications.cancel")}
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteNotification(pendingDelete.id)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  muted: { marginTop: 8, color: theme.colors.textSecondary, fontWeight: "700" },
  markAll: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  markAllText: { fontSize: 14, fontWeight: "800", color: theme.colors.primary },
  tabs: { flexDirection: "row", gap: 6, backgroundColor: "#EEF2F6", borderRadius: 14, padding: 4 },
  tab: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  tabActive: { backgroundColor: theme.colors.card, ...theme.shadow.card, shadowOpacity: 0.04, elevation: 1 },
  tabText: { color: theme.colors.textSecondary, fontWeight: "800", fontSize: 14 },
  tabTextActive: { color: theme.colors.text, fontWeight: "900" },
  noticeWrap: { paddingHorizontal: 16, paddingTop: 8 },
  notice: { marginTop: 0 },
  list: { padding: 16, paddingTop: 4, paddingBottom: 32, flexGrow: 1 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: theme.colors.textSecondary,
    paddingTop: 12,
    paddingBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    backgroundColor: theme.colors.card,
    marginBottom: 10,
  },
  cardPressed: { opacity: 0.9 },
  cardInvalid: { backgroundColor: "#F8FAFC", borderColor: "#CBD5E1" },
  iconCircle: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1, minWidth: 0, gap: 3 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "900", color: theme.colors.text },
  titleRead: { fontWeight: "700" },
  timeWrap: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 },
  time: { color: theme.colors.textSecondary, fontWeight: "700", fontSize: 12 },
  unreadDot: { width: 9, height: 9, borderRadius: 999, backgroundColor: theme.colors.unread },
  caseContext: { color: theme.colors.textSecondary, fontWeight: "800", fontSize: 13 },
  body: { color: "#334155", fontWeight: "500", fontSize: 14, lineHeight: 20 },
  invalidBadgeWrap: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  invalidBadgeTxt: { color: theme.colors.textSecondary, fontWeight: "900", fontSize: 12 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(NotificationsScreen);
