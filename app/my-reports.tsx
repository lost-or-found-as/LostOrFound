// app/my-reports.tsx
// Mine saker (language package A)
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  View,
  Alert,
  Modal,
} from "react-native";
import {
  Stack,
  useRouter,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import { theme } from "../src/ui/theme";
import { getLastSeenMap } from "../src/lib/unread";
import { useAuth } from "../src/contexts/AuthContext";
import { shortPlace } from "../src/lib/places";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { AuthHeaderAction } from "../src/ui/AuthHeaderAction";
import { useI18n } from "../src/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import { caseAttributes, caseTitle, formatCaseDate } from "../src/lib/caseDisplay";
import { reportHandledError } from "../src/lib/sentry";
import {
  activateTestReportOrder,
  createReportOrder,
} from "../src/lib/reportCommerce";
import { REPORT_PRODUCT_CODES } from "../src/lib/reportProducts";
import { userErrorMessage } from "../src/lib/userError";
import { formatMoney, formatTime as formatClock } from "../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../src/lib/market";
import { canExtendFound, REACTIVATION_TEST_PRICE } from "../src/lib/reportLifecycle";

// Test price shown in the reactivation dialog until RevenueCat supplies the store price.

type Report = {
  id: string;
  type: "LOST" | "FOUND";
  title?: string;
  created_at: string;
  occurred_at?: string | null;
  category?: string;
  subcategory_key?: string;
  color?: string | null;
  brand?: string | null;
  lat?: number | null;
  lng?: number | null;
  location_label?: string | null;
  status?: "ACTIVE" | "CLOSED" | "EXPIRED" | "ARCHIVED" | string | null;
  visible_until?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  last_extended_at?: string | null;
  extension_count?: number | null;
};

type LastActivity = {
  at: string;
  sender_id: string;
  body: string;
  match_id?: string;
};

type Translate = ReturnType<typeof useI18n>["t"];
type MessageInsert = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};


function reportStatusInfo(r: Report, language: "no" | "en", t: Translate) {
  if ((r as any).status === "ARCHIVED" || (r as any).archived_at)
    return { label: t("cases.archived") };
  if ((r as any).closed_at || (r as any).status === "CLOSED")
    return { label: t("cases.closed") };
  if (
    (r as any).status === "EXPIRED" ||
    ((r as any).visible_until &&
      Date.parse((r as any).visible_until) <= Date.now())
  )
    return { label: t("cases.expired") };
  if ((r as any).visible_until) {
    const daysLeft = Math.ceil(
      (Date.parse((r as any).visible_until) - Date.now()) /
        (24 * 60 * 60 * 1000),
    );
    if (Number.isFinite(daysLeft) && daysLeft >= 0)
      return { label: t("cases.active.days.left", { count: daysLeft }) };
  }
  return { label: t("cases.active") };
}
function lifecycleErrorCopy(code: string | undefined, t: (key: any) => string) {
  switch (String(code || "").toUpperCase()) {
    case "FOUND_EXTENSION_TOO_EARLY":
      return {
        title: t("reports.extendTooEarlyTitle"),
        body: t("reports.extendTooEarlyBody"),
      };
    case "FOUND_EXTENSION_LIMIT":
      return {
        title: t("reports.extendLimitTitle"),
        body: t("reports.extendLimitBody"),
      };
    case "FOUND_MAX_AGE_REACHED":
      return { title: t("reports.maxAgeTitle"), body: t("reports.maxAgeBody") };
    case "REPORT_CLOSED":
      return { title: t("reports.closedTitle"), body: t("reports.closedBody") };
    default:
      return null;
  }
}

function shortMessage(body?: string) {
  if (!body) return "";
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length <= 70) return t;
  return t.slice(0, 67) + "…";
}

function formatTime(iso: string | undefined, language: "no" | "en") {
  return formatClock(iso, language);
}

function sortReportsByActivity(
  reports: Report[],
  activityByReport: Record<string, LastActivity | null>,
) {
  const getKey = (r: Report) => activityByReport[r.id]?.at ?? r.created_at;
  return [...reports].sort((a, b) => {
    const ak = new Date(getKey(a)).getTime();
    const bk = new Date(getKey(b)).getTime();
    return bk - ak;
  });
}

function MyReportsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    section?: string;
    reportId?: string;
  }>();
  const { user } = useAuth();
  const { language, t } = useI18n();
  const [reports, setReports] = useState<Report[]>([]);
  const [unreadByReport, setUnreadByReport] = useState<Record<string, boolean>>(
    {},
  );
  const [activityByReport, setActivityByReport] = useState<
    Record<string, LastActivity | null>
  >({});
  const [matchCountByReport, setMatchCountByReport] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"active" | "history">(
    params.section === "history" ? "history" : "active",
  );
  const [confirmDialog, setConfirmDialog] = useState<{
    kind: "extend" | "reactivateLost" | "close" | "delete";
    report: Report;
  } | null>(null);
  const [menuReport, setMenuReport] = useState<Report | null>(null);
  const [reactivatingReportId, setReactivatingReportId] = useState<
    string | null
  >(null);
  const [reactivationSuccessOpen, setReactivationSuccessOpen] = useState(false);
  const matchToReportRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (params.section === "history" || params.section === "active") {
      setSection(params.section);
    }
  }, [params.section]);
  const lastSeenMapRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token || !user) {
        setReports([]);
        setUnreadByReport({});
        setActivityByReport({});
        setMatchCountByReport({});
        matchToReportRef.current = {};
        lastSeenMapRef.current = {};
        return;
      }

      lastSeenMapRef.current = await getLastSeenMap();
      const res = await fetch(`${API_BASE_URL}/reports/mine/with-activity`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ?? t("cases.could.not.load.cases.activity"),
        );
      }

      const reps: Report[] = data.reports ?? [];
      const matchToReport: Record<string, string> = data.matchToReport ?? {};
      const historyMatchToReport: Record<string, string> =
        data.historyMatchToReport ?? {};
      const allMatchToReport: Record<string, string> = {
        ...historyMatchToReport,
        ...matchToReport,
      };
      const lastMessages: Array<{
        conversation_id: string;
        sender_id: string;
        body: string;
        created_at: string;
      }> = data.lastMessages ?? [];

      const reportToMatches: Record<string, string[]> = {};
      for (const [mid, rid] of Object.entries(allMatchToReport)) {
        if (!rid) continue;
        if (!reportToMatches[rid]) reportToMatches[rid] = [];
        reportToMatches[rid].push(mid);
      }
      const matchCounts: Record<string, number> = {};
      for (const r of reps) {
        matchCounts[r.id] = (reportToMatches[r.id] ?? []).length;
      }

      const lastByMatch: Record<string, LastActivity> = {};
      for (const row of lastMessages) {
        const mid = String(row.conversation_id);
        lastByMatch[mid] = {
          at: String(row.created_at),
          sender_id: String(row.sender_id),
          body: String(row.body ?? ""),
          match_id: mid,
        };
      }

      const unread: Record<string, boolean> = {};
      const activity: Record<string, LastActivity | null> = {};
      for (const r of reps) {
        const matchIds = reportToMatches[r.id] ?? [];
        let hasUnread = false;
        let latest: LastActivity | null = null;
        for (const mid of matchIds) {
          const lastSeen = lastSeenMapRef.current[mid];
          const lastAct = lastByMatch[mid];
          if (!lastAct) continue;
          if (!latest || new Date(lastAct.at) > new Date(latest.at)) {
            latest = lastAct;
          }
          const isNewerThanSeen =
            !lastSeen || new Date(lastAct.at) > new Date(lastSeen);
          const fromOther = lastAct.sender_id !== user.id;
          if (isNewerThanSeen && fromOther) hasUnread = true;
        }
        unread[r.id] = hasUnread;
        activity[r.id] = latest;
      }

      matchToReportRef.current = allMatchToReport;
      setUnreadByReport(unread);
      setActivityByReport(activity);
      setMatchCountByReport(matchCounts);
      setReports(sortReportsByActivity(reps, activity));
    } catch (e) {
      console.warn("[my-reports] could not load cases", e);
      reportHandledError(e, "cases.load");
      setReports([]);
      setUnreadByReport({});
      setActivityByReport({});
      setMatchCountByReport({});
      matchToReportRef.current = {};
      lastSeenMapRef.current = {};
    } finally {
      setLoading(false);
    }
  }, [user, language]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load]),
  );

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("realtime:my-cases-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const msg = payload?.new as MessageInsert | undefined;
          if (!msg?.conversation_id || !msg?.sender_id || !msg?.created_at)
            return;
          const reportId = matchToReportRef.current[msg.conversation_id];
          if (!reportId) return;

          const newActivity: LastActivity = {
            at: msg.created_at,
            sender_id: msg.sender_id,
            body: String(msg.body ?? ""),
            match_id: msg.conversation_id,
          };

          if (msg.sender_id !== user.id) {
            const lastSeen = lastSeenMapRef.current[msg.conversation_id];
            const isNewerThanSeen =
              !lastSeen || new Date(msg.created_at) > new Date(lastSeen);
            if (isNewerThanSeen) {
              setUnreadByReport((prev) => {
                if (prev[reportId] === true) return prev;
                return { ...prev, [reportId]: true };
              });
            }
          }

          setActivityByReport((prev) => {
            const next = { ...prev, [reportId]: newActivity };
            setReports((prevReports) =>
              sortReportsByActivity(prevReports, next),
            );
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const openReport = (r: Report) => {
    router.push({ pathname: "/report-details/[id]", params: { id: r.id } });
  };

  const editReport = (r: Report) => {
    router.push({
      pathname: "/(report)/create-report",
      params: { editReportId: r.id },
    });
  };

  const deleteReport = async (id: string) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      Alert.alert(
        t("cases.error"),
        t("cases.you.must.be.logged.in.to.delete.this.case"),
      );
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/reports/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      Alert.alert(t("cases.delete.failed"), t("cases.delete.failed.body"));
      return;
    }

    setReports((prev) => prev.filter((r) => r.id !== id));
    setUnreadByReport((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setActivityByReport((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setMatchCountByReport((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    load();
  };

  const extendFoundReport = async (r: Report) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      Alert.alert(t("cases.error"), t("cases.you.must.be.logged.in"));
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/reports/${encodeURIComponent(r.id)}/extend-found`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const friendly = lifecycleErrorCopy(data?.error, t);
      Alert.alert(
        friendly?.title || t("cases.could.not.extend"),
        friendly?.body || userErrorMessage({ ...data, status: res.status }, t, "cases.please.try.again.later", "cases.extend"),
      );
      return;
    }
    await load();
  };

  const confirmExtendFound = (r: Report) =>
    setConfirmDialog({ kind: "extend", report: r });
  const reactivateLostReport = async (r: Report) => {
    try {
      setReactivatingReportId(r.id);
      const clientRequestId = `report-reactivation-${r.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const created = await createReportOrder({
        reportId: r.id,
        productCode: REPORT_PRODUCT_CODES.REPORT_REACTIVATION,
        clientRequestId,
        platform: "TEST",
        provider: "TEST",
      });
      await activateTestReportOrder(created.order.id);
      await load();
      setSection("active");
      setReactivationSuccessOpen(true);
    } catch (error: any) {
      Alert.alert(
        t("cases.reactivation.failed"),
        userErrorMessage(error, t, "cases.please.try.again.later", "cases.reactivate"),
      );
    } finally {
      setReactivatingReportId(null);
    }
  };

  const closeReport = async (r: Report) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      Alert.alert(
        t("cases.error"),
        t("cases.you.must.be.logged.in.to.close.this.case"),
      );
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/reports/${encodeURIComponent(r.id)}/close`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      Alert.alert(
        t("cases.error"),
        userErrorMessage({ ...data, status: res.status }, t, "cases.could.not.close.case", "cases.close"),
      );
      return;
    }

    load();
  };

  const confirmClose = (r: Report) =>
    setConfirmDialog({ kind: "close", report: r });

  const confirmDelete = (r: Report) =>
    setConfirmDialog({ kind: "delete", report: r });

  const dialogTitle =
    confirmDialog?.kind === "extend"
      ? t("cases.reactivate.found.report")
      : confirmDialog?.kind === "reactivateLost"
        ? t("cases.reactivate.lost.report")
        : confirmDialog?.kind === "close"
          ? t("cases.close.case")
          : t("cases.delete.case");
  const dialogBody =
    confirmDialog?.kind === "extend"
      ? t(
          "cases.keep.the.report.active.for.up.to.30.more.days.found.reports.can.remain",
        )
      : confirmDialog?.kind === "reactivateLost"
        ? t("cases.reactivate.payment.summary")
        : confirmDialog?.kind === "close"
          ? t(
              "cases.the.case.stays.in.my.cases.but.it.will.no.longer.be.used.for.new.match",
            )
          : t(
              "cases.the.case.is.removed.from.your.account.immediately.for.security.and.fra",
            );
  const activeReports = reports.filter(
    (r) =>
      String(r.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
      !r.closed_at &&
      !r.archived_at &&
      (!r.visible_until || Date.parse(r.visible_until) > Date.now()),
  );
  const activeIds = new Set(activeReports.map((r) => r.id));
  const historyReports = reports.filter((r) => !activeIds.has(r.id));
  const visibleReports = section === "active" ? activeReports : historyReports;

  const runDialogAction = async () => {
    const current = confirmDialog;
    if (!current) return;
    setConfirmDialog(null);
    if (current.kind === "extend") await extendFoundReport(current.report);
    else if (current.kind === "reactivateLost")
      await reactivateLostReport(current.report);
    else if (current.kind === "close") await closeReport(current.report);
    else await deleteReport(current.report.id);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={t("cases.my.cases")}
          subtitle={
            section === "active"
              ? t("cases.active.cases")
              : t("cases.case.history")
          }
          onBack={() => {
            // Return to where the user came from (e.g. Profile); home only when opened directly.
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
          right={<AuthHeaderAction />}
        />

        <View style={styles.sectionTabs}>
          <Pressable
            style={[
              styles.sectionTab,
              section === "active" && styles.sectionTabActive,
            ]}
            onPress={() => setSection("active")}
          >
            <Text
              style={[
                styles.sectionTabText,
                section === "active" && styles.sectionTabTextActive,
              ]}
            >
              {t("cases.active.count", { count: activeReports.length })}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.sectionTab,
              section === "history" && styles.sectionTabActive,
            ]}
            onPress={() => setSection("history")}
          >
            <Text
              style={[
                styles.sectionTabText,
                section === "history" && styles.sectionTabTextActive,
              ]}
            >
              {t("cases.history.count", { count: historyReports.length })}
            </Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>{t("cases.loading.cases")}</Text>
          </View>
        ) : visibleReports.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>
              {section === "active"
                ? t("cases.no.active.cases.right.now")
                : t("cases.no.case.history.yet")}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {visibleReports.map((r) => {
              const act = activityByReport[r.id] ?? null;
              const actFromMe = act?.sender_id === user?.id;
              const statusInfo = reportStatusInfo(r, language, t);
              const isClosed = r.status === "CLOSED" || !!r.closed_at;
              const isExpired =
                r.status === "EXPIRED" ||
                (!!r.visible_until &&
                  Date.parse(r.visible_until) <= Date.now());
              const latestChatId = act?.match_id;
              const count = matchCountByReport[r.id] ?? 0;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => openReport(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`${caseTitle(r, language)}, ${t("cases.view.report")}`}
                  style={({ pressed }) => [
                    styles.card,
                    params.reportId === r.id && styles.cardFocused,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <View style={styles.cardHead}>
                    <View style={[styles.typeTile, r.type === "FOUND" ? styles.typeTileFound : styles.typeTileLost]}>
                      <Ionicons
                        name={r.type === "FOUND" ? "checkmark-circle-outline" : "search-outline"}
                        size={24}
                        color={r.type === "FOUND" ? "#15803D" : "#B45309"}
                      />
                    </View>
                    <View style={styles.cardHeadText}>
                      <View style={styles.cardTopRow}>
                        <Text style={[styles.kindBadge, r.type === "FOUND" && styles.kindBadgeFound]}>
                          {r.type === "LOST" ? t("cases.lost.2") : t("cases.found.2")}
                        </Text>
                        <Text style={[styles.statusText, isExpired && styles.statusExpired, isClosed && styles.statusClosed]}>
                          {statusInfo.label}
                        </Text>
                      </View>
                      <Text style={styles.title} numberOfLines={2}>
                        {caseTitle(r, language)}
                      </Text>
                      {!!caseAttributes(r, language) && (
                        <Text style={styles.attributes}>{caseAttributes(r, language)}</Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.details}>
                    {!!shortPlace(r.location_label) && (
                      <View style={styles.detailRow}>
                        <Ionicons name="location-outline" size={16} color="#64748B" />
                        <Text style={styles.detailText} numberOfLines={1}>{shortPlace(r.location_label)}</Text>
                      </View>
                    )}
                    <View style={styles.detailRow}>
                      <Ionicons name="calendar-outline" size={16} color="#64748B" />
                      <Text style={styles.detailText}>
                        {t("cases.reported.on", { date: formatCaseDate(r.created_at, language) })}
                      </Text>
                    </View>
                    {act && (
                      <View style={styles.detailRow}>
                        <Ionicons name="chatbubble-outline" size={16} color={unreadByReport[r.id] ? "#1D4ED8" : "#64748B"} />
                        <Text style={[styles.detailText, unreadByReport[r.id] && styles.unreadText]} numberOfLines={1}>
                          {unreadByReport[r.id] ? `${t("cases.new.message")} · ` : ""}
                          {actFromMe ? t("cases.you") : t("cases.other.party")}: {shortMessage(act.body)} · {formatTime(act.at, language)}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.primaryActions}>
                    {count > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        style={styles.primaryBtn}
                        onPress={() => router.push({ pathname: "/match", params: { reportId: r.id } })}
                      >
                        <Text style={styles.primaryBtnText}>{t("cases.view.matches.count", { count })}</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.noMatches}>
                        <Text style={styles.noMatchesText}>{t("cases.no.matches.yet")}</Text>
                      </View>
                    )}
                    {latestChatId && (
                      <Pressable
                        accessibilityRole="button"
                        style={styles.outlineBtn}
                        onPress={() => router.push(`/chat/${latestChatId}`)}
                      >
                        <Text style={styles.outlineBtnText}>{t("cases.open.chat")}</Text>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("cases.more.options")}
                      style={styles.moreBtn}
                      hitSlop={6}
                      onPress={() => setMenuReport(r)}
                    >
                      <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text} />
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
            <Pressable style={styles.reloadBtn} onPress={load}>
              <Text style={styles.reloadTxt}>{t("cases.refresh")}</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
      <Modal
        transparent
        visible={!!menuReport}
        animationType="slide"
        onRequestClose={() => setMenuReport(null)}
      >
        <Pressable style={sheetStyles.backdrop} onPress={() => setMenuReport(null)} accessibilityLabel={t("cases.menu.cancel")}>
          {menuReport && (() => {
            const r = menuReport;
            const isClosed = r.status === "CLOSED" || !!r.closed_at;
            const isExpired = r.status === "EXPIRED" || (!!r.visible_until && Date.parse(r.visible_until) <= Date.now());
            // Close the sheet first; iOS cannot show the confirmation dialog while it is closing.
            const run = (action: () => void) => {
              setMenuReport(null);
              setTimeout(action, 350);
            };
            const items: { key: string; icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; danger?: boolean }[] = [
              { key: "view", icon: "eye-outline", label: t("cases.view.report"), onPress: () => run(() => openReport(r)) },
            ];
            if (!isClosed) items.push({ key: "edit", icon: "create-outline", label: isExpired ? t("cases.edit.details") : t("cases.edit"), onPress: () => run(() => editReport(r)) });
            if (canExtendFound(r)) items.push({ key: "extend", icon: "refresh-outline", label: isExpired ? t("cases.reactivate") : t("cases.extend"), onPress: () => run(() => confirmExtendFound(r)) });
            if (r.type === "LOST" && isExpired && !isClosed) items.push({ key: "reactivate", icon: "refresh-outline", label: t("cases.reactivate.30.days"), onPress: () => run(() => setConfirmDialog({ kind: "reactivateLost", report: r })) });
            if (!isClosed && !(r.type === "LOST" && isExpired)) items.push({ key: "close", icon: "checkmark-circle-outline", label: t("cases.close"), onPress: () => run(() => confirmClose(r)) });
            items.push({ key: "delete", icon: "trash-outline", label: t("cases.delete"), danger: true, onPress: () => run(() => confirmDelete(r)) });
            return (
              <Pressable style={sheetStyles.sheet} onPress={() => {}} accessibilityViewIsModal>
                <View style={sheetStyles.handle} />
                <Text style={sheetStyles.title} numberOfLines={2}>{caseTitle(r, language)}</Text>
                <Text style={sheetStyles.subtitle}>
                  {r.type === "LOST" ? t("cases.lost") : t("cases.found")}
                  {r.type === "FOUND" ? ` · ${t("cases.extended.count", { count: Number(r.extension_count || 0) })}` : ""}
                </Text>
                {items.map((item) => (
                  <React.Fragment key={item.key}>
                    {item.danger && <View style={sheetStyles.divider} />}
                    <Pressable
                      accessibilityRole="button"
                      style={({ pressed }) => [sheetStyles.item, pressed && sheetStyles.itemPressed]}
                      onPress={item.onPress}
                    >
                      <Ionicons name={item.icon} size={21} color={item.danger ? "#B91C1C" : theme.colors.text} />
                      <Text style={[sheetStyles.itemText, item.danger && sheetStyles.itemDanger]}>{item.label}</Text>
                    </Pressable>
                  </React.Fragment>
                ))}
                <Pressable accessibilityRole="button" style={sheetStyles.cancel} onPress={() => setMenuReport(null)}>
                  <Text style={sheetStyles.cancelText}>{t("cases.menu.cancel")}</Text>
                </Pressable>
              </Pressable>
            );
          })()}
        </Pressable>
      </Modal>
      <Modal
        transparent
        visible={!!confirmDialog}
        animationType="fade"
        onRequestClose={() => setConfirmDialog(null)}
      >
        <View style={dialogStyles.backdrop}>
          <View style={dialogStyles.card}>
            <View style={dialogStyles.iconCircle}>
              <Text style={dialogStyles.iconText}>
                {confirmDialog?.kind === "delete"
                  ? "!"
                  : confirmDialog?.kind === "close"
                    ? "✓"
                    : "+"}
              </Text>
            </View>
            <Text style={dialogStyles.title}>{dialogTitle}</Text>
            <Text style={dialogStyles.body}>{dialogBody}</Text>
            {confirmDialog?.kind === "reactivateLost" && (
              <View style={dialogStyles.paymentSummary}>
                <View style={dialogStyles.paymentRow}>
                  <Text style={dialogStyles.paymentLabel}>
                    {t("cases.reactivation.product")}
                  </Text>
                  <Text style={dialogStyles.paymentValue}>
                    {t("cases.reactivation.30.days")}
                  </Text>
                </View>
                <View style={dialogStyles.paymentRow}>
                  <Text style={dialogStyles.paymentLabel}>
                    {t("cases.test.price")}
                  </Text>
                  <Text style={dialogStyles.paymentPrice}>{formatMoney(REACTIVATION_TEST_PRICE, STORED_MONEY_CURRENCY, language)}</Text>
                </View>
                <Text style={dialogStyles.testModeText}>
                  {t("cases.test.payment.notice")}
                </Text>
              </View>
            )}
            <View
              style={[
                dialogStyles.actions,
                confirmDialog?.kind === "reactivateLost" &&
                  dialogStyles.paymentActions,
              ]}
            >
              <Pressable
                style={[
                  dialogStyles.cancelBtn,
                  confirmDialog?.kind === "reactivateLost" &&
                    dialogStyles.paymentActionButton,
                ]}
                onPress={() => setConfirmDialog(null)}
              >
                <Text style={dialogStyles.cancelText}>{t("cases.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[
                  dialogStyles.confirmBtn,
                  confirmDialog?.kind === "reactivateLost" &&
                    dialogStyles.paymentActionButton,
                  confirmDialog?.kind === "delete" &&
                    dialogStyles.deleteConfirmBtn,
                ]}
                onPress={() => void runDialogAction()}
              >
                <Text style={dialogStyles.confirmText}>
                  {confirmDialog?.kind === "extend" ||
                  confirmDialog?.kind === "reactivateLost"
                    ? confirmDialog?.kind === "reactivateLost"
                      ? t("cases.complete.test.payment")
                      : t("cases.reactivate.2")
                    : confirmDialog?.kind === "close"
                      ? t("cases.close.case.2")
                      : t("cases.delete")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={reactivationSuccessOpen}
        animationType="fade"
        onRequestClose={() => setReactivationSuccessOpen(false)}
      >
        <View style={successStyles.backdrop}>
          <View style={successStyles.card}>
            <View style={successStyles.iconCircle}>
              <Text style={successStyles.iconText}>✓</Text>
            </View>
            <Text style={successStyles.title}>
              {t("cases.reactivation.success.title")}
            </Text>
            <Text style={successStyles.body}>
              {t("cases.reactivation.success.body")}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={successStyles.closeButton}
              onPress={() => setReactivationSuccessOpen(false)}
            >
              <Text style={successStyles.closeButtonText}>
                {t("cases.reactivation.success.close")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  sectionTabs: {
    flexDirection: "row",
    gap: 4,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
    padding: 4,
    borderRadius: 14,
    backgroundColor: theme.colors.chipBg,
  },
  sectionTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTabActive: {
    backgroundColor: theme.colors.card,
    ...theme.shadow.card,
  },
  sectionTabText: {
    color: "#475569",
    fontWeight: "700",
    fontSize: 15,
  },
  sectionTabTextActive: { color: theme.colors.text, fontWeight: "800" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  muted: { color: theme.colors.muted, fontWeight: "600", textAlign: "center" },
  list: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 30 },
  card: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: 14,
  },
  cardFocused: { borderColor: theme.colors.primary, borderWidth: 2 },
  cardPressed: { backgroundColor: "#F8FAFC" },
  cardHead: { flexDirection: "row", gap: 12 },
  cardHeadText: { flex: 1, minWidth: 0, gap: 4 },
  typeTile: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  typeTileFound: { backgroundColor: "#ECFDF3" },
  typeTileLost: { backgroundColor: "#FEF3C7" },
  cardTopRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  statusText: { color: "#475569", fontSize: 12, fontWeight: "700" },
  attributes: { color: "#475569", fontSize: 14, fontWeight: "600" },
  details: { marginTop: 12, gap: 6 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailText: { flex: 1, color: "#475569", fontSize: 14, fontWeight: "600" },
  unreadText: { color: "#1D4ED8", fontWeight: "800" },
  outlineBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: theme.colors.card,
  },
  outlineBtnText: { color: theme.colors.primary, fontWeight: "800", fontSize: 15 },
  moreBtn: {
    width: 44,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  kindBadge: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#FEF3C7",
    color: "#92400E",
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  kindBadgeFound: { backgroundColor: "#DCFCE7", color: "#166534" },
  statusBadge: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    color: theme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  statusExpired: { color: "#B45309" },
  statusClosed: { color: "#64748B" },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  meta: {
    marginTop: 5,
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  brandLine: {
    marginTop: 5,
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  extensionInfo: {
    marginTop: 7,
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  lastLine: {
    marginTop: 9,
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  unread: {
    marginTop: 6,
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 12,
  },
  primaryActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
  },
  primaryBtnText: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  secondaryPrimary: {
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  secondaryPrimaryText: { color: theme.colors.primary },
  noMatches: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  noMatchesText: { color: "#64748B", fontWeight: "700", fontSize: 14 },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#EEF2F6",
  },
  viewLink: { color: theme.colors.primary, fontWeight: "900", fontSize: 13 },
  secondaryLink: { color: "#475569", fontWeight: "800", fontSize: 13 },
  extendLink: { color: "#15803D", fontWeight: "900", fontSize: 13 },
  deleteLink: { color: "#B42318", fontWeight: "900", fontSize: 13 },
  reloadBtn: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  reloadTxt: { fontWeight: "800", color: theme.colors.text },
});
const dialogStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 410,
    borderRadius: 22,
    backgroundColor: "#FFF",
    padding: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
  },
  iconText: { color: theme.colors.primary, fontSize: 25, fontWeight: "900" },
  title: {
    marginTop: 14,
    textAlign: "center",
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  body: {
    marginTop: 9,
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  paymentSummary: {
    marginTop: 16,
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  paymentLabel: { color: "#64748B", fontWeight: "800" },
  paymentValue: {
    color: "#0F172A",
    fontWeight: "900",
    flexShrink: 1,
    textAlign: "right",
    marginLeft: 12,
  },
  paymentPrice: { color: "#1D4ED8", fontWeight: "900", fontSize: 20 },
  testModeText: {
    marginTop: 5,
    color: "#92400E",
    fontWeight: "700",
    lineHeight: 19,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  paymentActions: { flexDirection: "column-reverse", gap: 10 },
  paymentActionButton: { width: "100%", flex: 0 },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cancelText: { color: theme.colors.text, fontWeight: "900" },
  confirmBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  deleteConfirmBtn: { backgroundColor: "#B42318" },
  confirmText: {
    color: "#FFF",
    fontWeight: "900",
    textAlign: "center",
    width: "100%",
    paddingHorizontal: 8,
  },
});

const successStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 410,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: "#D1FAE5",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  iconText: { color: "#15803D", fontSize: 32, fontWeight: "900" },
  title: {
    marginTop: 18,
    textAlign: "center",
    color: theme.colors.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
  },
  body: {
    marginTop: 10,
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  closeButton: {
    width: "100%",
    minHeight: 50,
    marginTop: 22,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
  },
  closeButtonText: {
    width: "100%",
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    textAlign: "center",
  },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyReportsScreen);

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 34,
    gap: 4,
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 999, backgroundColor: "#CBD5E1", marginBottom: 10 },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "900", paddingHorizontal: 4 },
  subtitle: { color: "#475569", fontSize: 14, fontWeight: "600", paddingHorizontal: 4, marginBottom: 8 },
  item: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: 12 },
  itemPressed: { backgroundColor: "#F1F5F9" },
  itemText: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  itemDanger: { color: "#B91C1C", fontWeight: "800" },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
  cancel: {
    marginTop: 8,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
});
