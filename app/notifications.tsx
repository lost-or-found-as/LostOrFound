// app/notifications.tsx
// In-app notification feed with read state, validated deep links, and deletion of unavailable targets.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import { theme } from "../src/ui/theme";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { AuthHeaderAction } from "../src/ui/AuthHeaderAction";
import { useI18n } from "../src/i18n/I18nProvider";
import { notificationCaseLabel } from "../src/lib/localizedReport";
import { userErrorMessage } from "../src/lib/userError";
import { formatTimeAgo } from "../src/i18n/formatters";

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

function timeAgo(iso: string, t: Translate) {
  return formatTimeAgo(iso, t, "short");
}

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

function NotificationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { language, t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Notif[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedTab, setSelectedTab] = useState<"mine" | "nearby">(
    params.tab === "nearby" ? "nearby" : "mine",
  );
  useEffect(() => {
    if (params.tab === "nearby") setSelectedTab("nearby");
  }, [params.tab]);

  const getToken = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    return sess.session?.access_token ?? null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
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
      if (!r.ok)
        throw new Error(
          data?.error ?? t("notifications.could.not.load.notifications"),
        );

      setItems(compactNotifications((data?.notifications ?? []) as Notif[]));
    } catch (e: any) {
      Alert.alert(
        t("notifications.error"),
        userErrorMessage(e, t, "notifications.unknown.error", "notifications.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [getToken, language]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        const token = await getToken();
        if (!token) return;
        await fetch(
          `${API_BASE_URL}/notifications/${encodeURIComponent(id)}/read`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      } catch {
        // ignore
      }
    },
    [getToken],
  );

  const resolveNotif = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (!token) throw new Error(t("notifications.missing.login"));

      const r = await fetch(
        `${API_BASE_URL}/notifications/${encodeURIComponent(id)}/resolve`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(
          data?.error ?? t("notifications.could.not.validate.notification"),
        );

      return data as {
        ok: boolean;
        target_kind?: string;
        target_id?: string;
        reason?: string;
      };
    },
    [getToken, language],
  );

  const deleteNotification = useCallback(
    async (id: string) => {
      try {
        setBusy(true);
        const token = await getToken();
        if (!token) return;

        const r = await fetch(
          `${API_BASE_URL}/notifications/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new Error(
            data?.error ?? t("notifications.could.not.delete.notification"),
          );

        setItems((prev) => prev.filter((x) => x.id !== id));
      } catch (e: any) {
        Alert.alert(
          t("notifications.error"),
          userErrorMessage(e, t, "notifications.could.not.delete.notification", "notifications.delete"),
        );
      } finally {
        setBusy(false);
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
      if (!r.ok)
        throw new Error(
          data?.error ??
            t("notifications.could.not.delete.unavailable.notifications"),
        );

      await load();
      Alert.alert(
        t("notifications.done"),
        t("notifications.deleted.unavailable.count", {
          count: data?.deleted ?? 0,
        }),
      );
    } catch (e: any) {
      Alert.alert(
        t("notifications.error"),
        userErrorMessage(e, t, "notifications.could.not.delete.unavailable.notifications", "notifications.delete"),
      );
    } finally {
      setBusy(false);
    }
  }, [getToken, language, load]);

  const openNotif = useCallback(
    async (n: Notif) => {
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id
            ? { ...x, read_at: x.read_at ?? new Date().toISOString() }
            : x,
        ),
      );
      markRead(n.id);

      try {
        const notificationType = String(n.type || "").toUpperCase();
        if (
          (notificationType === "OBSERVATION_MESSAGE" ||
            notificationType === "OBSERVATION_STATUS") &&
          n.entity_id
        ) {
          router.push(`/observation/${n.entity_id}`);
          return;
        }
        if (notificationType === "AREA_ALERT_OBSERVATION" && n.entity_id) {
          router.push(`/observation/${n.entity_id}`);
          return;
        }
        if (
          (notificationType === "AREA_ALERT" ||
            notificationType === "GEO_ALERT") &&
          n.entity_id
        ) {
          router.push(`/area-alert/${n.entity_id}`);
          return;
        }
        const resolved = await resolveNotif(n.id);
        if (!resolved.ok || !resolved.target_id) {
          setItems((prev) =>
            prev.map((x) =>
              x.id === n.id
                ? {
                    ...x,
                    target_status: "missing",
                    target_kind:
                      resolved.target_kind || x.target_kind || x.entity_type,
                  }
                : x,
            ),
          );
          Alert.alert(
            t("notifications.unavailable"),
            t(
              "notifications.this.notification.points.to.content.that.no.longer.exists.you.can.dele",
            ),
          );
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
          const notificationType = String(n.type || "").toUpperCase();
          if (notificationType === "NEW_MATCH") {
            router.push({
              pathname: "/match",
              params: { reportId: resolved.target_id },
            });
            return;
          }
          const section = ["REPORT_EXPIRED", "REPORT_ARCHIVED"].includes(
            notificationType,
          )
            ? "history"
            : "active";
          router.push({
            pathname: "/my-reports",
            params: { section, reportId: resolved.target_id },
          });
          return;
        }

        Alert.alert(
          t("notifications.unavailable"),
          t("notifications.this.notification.could.not.be.opened"),
        );
      } catch (e: any) {
        Alert.alert(
          t("notifications.error"),
          userErrorMessage(e, t, "notifications.could.not.open.the.notification", "notifications.open"),
        );
      }
    },
    [router, markRead, resolveNotif, language],
  );

  const isNearbyNotification = useCallback((item: Notif) => {
    const type = String(item.type || "").toUpperCase();
    return (
      type === "AREA_ALERT" ||
      type === "GEO_ALERT" ||
      String(item.entity_type || "").toLowerCase() === "area_alert_campaign"
    );
  }, []);
  const mineItems = useMemo(
    () => items.filter((item) => !isNearbyNotification(item)),
    [items, isNearbyNotification],
  );
  const nearbyItems = useMemo(
    () => items.filter(isNearbyNotification),
    [items, isNearbyNotification],
  );
  const visibleItems = selectedTab === "nearby" ? nearbyItems : mineItems;
  const mineUnread = useMemo(
    () => mineItems.filter((x) => !x.read_at).length,
    [mineItems],
  );
  const nearbyUnread = useMemo(
    () => nearbyItems.filter((x) => !x.read_at).length,
    [nearbyItems],
  );
  const unreadCount = mineUnread + nearbyUnread;
  const missingCount = useMemo(
    () => mineItems.filter((x) => x.target_status === "missing").length,
    [mineItems],
  );

  const markVisibleRead = useCallback(async () => {
    const unreadIds = visibleItems
      .filter((item) => !item.read_at)
      .map((item) => item.id);
    if (!unreadIds.length) return;
    setBusy(true);
    try {
      await Promise.all(
        unreadIds.map((notificationId) => markRead(notificationId)),
      );
      const visibleSet = new Set(unreadIds);
      const readAt = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) =>
          visibleSet.has(item.id)
            ? { ...item, read_at: item.read_at || readAt }
            : item,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [visibleItems, markRead]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={t("notifications.notifications")}
          subtitle={
            unreadCount
              ? t("notifications.unread.count", { count: unreadCount })
              : t("notifications.overview")
          }
          onBack={() => router.back()}
          right={<AuthHeaderAction />}
        />

        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, selectedTab === "mine" && styles.tabActive]}
            onPress={() => setSelectedTab("mine")}
          >
            <Text
              style={[
                styles.tabText,
                selectedTab === "mine" && styles.tabTextActive,
              ]}
            >
              {t("notifications.my.cases")}
              {mineUnread ? ` ${mineUnread}` : ""}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, selectedTab === "nearby" && styles.tabActive]}
            onPress={() => setSelectedTab("nearby")}
          >
            <Text
              style={[
                styles.tabText,
                selectedTab === "nearby" && styles.tabTextActive,
              ]}
            >
              {t("notifications.nearby")}
              {nearbyUnread ? ` ${nearbyUnread}` : ""}
            </Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>{t("notifications.loading")}</Text>
          </View>
        ) : visibleItems.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>
              {selectedTab === "nearby"
                ? t("notifications.no.nearby.alerts.yet")
                : t("notifications.no.case.notifications.yet")}
            </Text>
          </View>
        ) : (
          <FlatList
            data={visibleItems}
            keyExtractor={(x) => x.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
            renderItem={({ item }) => {
              const unread = !item.read_at;
              const invalid = item.target_status === "missing";
              return (
                <View
                  style={[
                    styles.card,
                    unread && styles.cardUnread,
                    invalid && styles.cardInvalid,
                  ]}
                >
                  <Pressable
                    onPress={() => openNotif(item)}
                    style={({ pressed }) => [pressed && { opacity: 0.9 }]}
                  >
                    <View style={styles.rowTop}>
                      <Text style={styles.title} numberOfLines={1}>
                        {notificationTitle(item, language, t)}
                      </Text>
                      <View style={styles.timeWrap}>
                        {unread && <Text style={styles.unreadDot}>●</Text>}
                        <Text style={styles.time}>
                          {timeAgo(item.created_at, t)}
                        </Text>
                      </View>
                    </View>

                    {!!notificationCaseLabel(item.report_context, language, t) &&
                      ![
                        "REPORT_EXPIRING",
                        "REPORT_EXPIRED",
                        "REPORT_ARCHIVED",
                      ].includes(String(item.type || "").toUpperCase()) && (
                        <Text style={styles.caseContext} numberOfLines={1}>
                          {notificationCaseLabel(item.report_context, language, t)}
                        </Text>
                      )}
                    {notificationBody(item, language, t) && (
                      <Text style={styles.body} numberOfLines={2}>
                        {notificationBody(item, language, t)}
                      </Text>
                    )}

                    {invalid && (
                      <View style={styles.invalidBadgeWrap}>
                        <Text style={styles.invalidBadgeTxt}>
                          {invalidReasonLabel(item, language, t)}
                        </Text>
                      </View>
                    )}
                  </Pressable>

                  <View style={styles.itemActions}>
                    <Pressable
                      style={styles.itemDeleteBtn}
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          t("notifications.delete.notification"),
                          t(
                            "notifications.this.only.removes.the.notification.from.your.list",
                          ),
                          [
                            {
                              text: t("notifications.cancel"),
                              style: "cancel",
                            },
                            {
                              text: t("notifications.delete"),
                              style: "destructive",
                              onPress: () => deleteNotification(item.id),
                            },
                          ],
                        )
                      }
                    >
                      <Text style={styles.itemDeleteTxt}>
                        {t("notifications.delete")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={styles.footer}>
          <Pressable style={styles.footerBtn} onPress={load} disabled={busy}>
            <Text style={styles.footerTxt}>{t("notifications.refresh")}</Text>
          </Pressable>

          {selectedTab === "mine" && (
            <Pressable
              style={[
                styles.footerBtn,
                missingCount > 0
                  ? styles.footerBtnDanger
                  : styles.footerBtnDisabled,
              ]}
              onPress={deleteMissingNotifications}
              disabled={busy || missingCount === 0}
            >
              <Text
                style={[
                  styles.footerTxt,
                  missingCount > 0
                    ? styles.footerTxtDanger
                    : styles.footerTxtDisabled,
                ]}
              >
                {t("notifications.delete.unavailable")}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={[styles.footerBtn, styles.footerBtnPrimary]}
            disabled={busy}
            onPress={markVisibleRead}
          >
            <Text style={[styles.footerTxt, styles.footerTxtPrimary]}>
              {t("notifications.mark.tab.read")}
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  muted: { marginTop: 8, color: theme.colors.muted, fontWeight: "700" },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  tabActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  tabText: { color: theme.colors.text, fontWeight: "900", fontSize: 13 },
  tabTextActive: { color: "#FFFFFF" },
  card: {
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: theme.colors.card,
  },
  cardUnread: { borderColor: theme.colors.primary, borderWidth: 1.5 },
  cardInvalid: {
    opacity: 0.82,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: { flex: 1, fontWeight: "900", color: theme.colors.text },
  timeWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { color: theme.colors.muted, fontWeight: "800", fontSize: 12 },
  caseContext: {
    marginTop: 7,
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 13,
  },
  body: {
    marginTop: 6,
    color: theme.colors.text,
    fontWeight: "400",
    lineHeight: 21,
  },
  unreadDot: { color: theme.colors.primary, fontWeight: "900" },
  invalidBadgeWrap: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  invalidBadgeTxt: { color: "#475569", fontWeight: "900", fontSize: 12 },
  itemActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  itemDeleteBtn: {
    borderWidth: 1,
    borderColor: "#DC2626",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  itemDeleteTxt: { color: "#DC2626", fontWeight: "900" },
  footer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  footerBtnPrimary: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  footerBtnDanger: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  footerBtnDisabled: { backgroundColor: "#F1F5F9", borderColor: "#CBD5E1" },
  footerTxt: { fontWeight: "900", color: theme.colors.text, fontSize: 12 },
  footerTxtPrimary: { color: "#fff" },
  footerTxtDanger: { color: "#DC2626" },
  footerTxtDisabled: { color: "#94A3B8" },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(NotificationsScreen);
