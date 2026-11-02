// app/my-reports.tsx
// Mine saker. T1.9W: rebuilt in the shared kit style (ScreenHeader, segmented tabs, cards with a
// thumbnail, BottomSheet menu, ConfirmSheet, InlineNotice, pull to refresh). Same data and actions.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
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
import { useI18n } from "../src/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import { caseAttributes, caseTitle, formatCaseDate } from "../src/lib/caseDisplay";
import { reportHandledError } from "../src/lib/sentry";
import { userErrorMessage } from "../src/lib/userError";
import { formatDate, formatMoney, formatTime as formatClock } from "../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../src/lib/market";
import {
  canBuyLongTerm,
  canExtendFound,
  canExtendLost,
  closeReportRequest,
  deleteReportRequest,
  extendFoundRequest,
  extendLostRequest,
  FOUND_EXTENSION_WINDOW_DAYS,
  FOUND_MAX_EXTENSIONS,
  isInLostExtensionWindow,
  isReportClosed,
  isReportExpired,
  LOST_EXTENSION_WINDOW_DAYS,
  LOST_MAX_EXTENSIONS,
  reportDaysLeft,
} from "../src/lib/reportLifecycle";
import { LongTermSheet } from "../src/ui/LongTermSheet";
import { useReactivationPrice } from "../src/lib/useReactivationPrice";
import { WithdrawalConsent } from "../src/ui/WithdrawalConsent";
import { InlineNotice } from "../src/ui/InlineNotice";
import { registerRoute, useNewRegistration } from "../src/lib/newRegistration";
import {
  BottomSheet,
  Button,
  ConfirmSheet,
  EmptyState,
  IconButton,
  InfoButton,
  ScreenHeader,
} from "../src/ui/kit";

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
  // T1.9I: from /reports/mine/with-activity.
  paid_extensions?: number | null;
  long_term_until?: string | null;
  // T1.9W: shown as the card thumbnail when the list endpoint includes them (it does not yet).
  thumbnail_url?: string | null;
  images?: { signed_url?: string | null }[] | null;
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

type DialogKind = "extend" | "reactivateLost" | "close" | "delete";
type MenuItem = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
};

function lifecycleErrorCopy(code: string | undefined, t: Translate) {
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
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= 70) return text;
  return text.slice(0, 67) + "…";
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

function isActiveReport(r: Report) {
  return (
    String(r.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
    !r.closed_at &&
    !r.archived_at &&
    (!r.visible_until || Date.parse(r.visible_until) > Date.now())
  );
}

function thumbnailOf(r: Report): string | null {
  const first = (r.images || []).find((x) => !!x?.signed_url);
  return r.thumbnail_url || first?.signed_url || null;
}

/** Status badge, same rules as Saksdetaljer (closed, historic period, expired, days left). */
function reportStatus(r: Report, language: "no" | "en", t: Translate) {
  const lost = String(r.type).toUpperCase() === "LOST";
  const closed = isReportClosed(r);
  const expired = isReportExpired(r);
  const daysLeft = reportDaysLeft(r);
  const longTermUntil = lost && !closed ? r.long_term_until || null : null;
  const label = closed
    ? r.archived_at || String(r.status || "").toUpperCase() === "ARCHIVED"
      ? t("cases.archived")
      : t("cases.closed")
    : longTermUntil
      ? t("caseDetail.historicUntil", { date: formatDate(longTermUntil, language) })
      : expired
        ? t("cases.expired")
        : daysLeft != null
          ? t("cases.active.days.left", { count: daysLeft })
          : t("caseDetail.active");
  const tone: "historic" | "muted" | "active" = longTermUntil ? "historic" : closed || expired ? "muted" : "active";
  return { label, tone, closed, expired, longTermUntil };
}

function MyReportsScreen() {
  const router = useRouter();
  // T1.9M: extension price from the catalog (the price the server charges); 0 = free in the pilot.
  const reactivationPrice = useReactivationPrice();
  const [newRegistration] = useNewRegistration();
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
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  const [section, setSection] = useState<"active" | "history">(
    params.section === "history" ? "history" : "active",
  );
  const [confirmDialog, setConfirmDialog] = useState<{
    kind: DialogKind;
    report: Report;
  } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<{ title: string; body: string } | null>(null);
  // T1.9R: consent before a paid extension (reset each time the dialog opens).
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    setConsent(false);
    setDialogError(null);
  }, [confirmDialog]);
  const [menuReport, setMenuReport] = useState<Report | null>(null);
  const [reactivationSuccessOpen, setReactivationSuccessOpen] = useState(false);
  const [longTermReportId, setLongTermReportId] = useState<string | null>(null);
  const matchToReportRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (params.section === "history" || params.section === "active") {
      setSection(params.section);
    }
  }, [params.section]);
  const lastSeenMapRef = useRef<Record<string, string>>({});

  const clearAll = () => {
    setReports([]);
    setUnreadByReport({});
    setActivityByReport({});
    setMatchCountByReport({});
    matchToReportRef.current = {};
    lastSeenMapRef.current = {};
  };

  // The full-screen spinner shows only on the first load; later loads (focus, pull to refresh)
  // keep the list on screen.
  const load = useCallback(async (mode: "auto" | "refresh" = "auto") => {
    const seq = ++loadSeqRef.current;
    try {
      if (mode === "refresh") setRefreshing(true);
      else if (!hasLoadedRef.current) setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token || !user) {
        if (seq !== loadSeqRef.current) return;
        clearAll();
        setLoadError(false);
        return;
      }

      const lastSeen = await getLastSeenMap();
      const res = await fetch(`${API_BASE_URL}/reports/mine/with-activity`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "MY_REPORTS_LOAD_FAILED");
      }
      if (seq !== loadSeqRef.current) return;
      lastSeenMapRef.current = lastSeen;

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
          const seenAt = lastSeenMapRef.current[mid];
          const lastAct = lastByMatch[mid];
          if (!lastAct) continue;
          if (!latest || new Date(lastAct.at) > new Date(latest.at)) {
            latest = lastAct;
          }
          const isNewerThanSeen =
            !seenAt || new Date(lastAct.at) > new Date(seenAt);
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
      setLoadError(false);
      hasLoadedRef.current = true;
    } catch (e) {
      console.warn("[my-reports] could not load cases", e);
      reportHandledError(e, "cases.load");
      // Keep what is already on screen; the notice says the list could not be updated.
      if (seq === loadSeqRef.current) setLoadError(true);
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user, language]);

  // Runs on mount and every time the screen gets focus (also when `load` changes).
  useFocusEffect(
    useCallback(() => {
      void load();
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

  const removeLocally = (id: string) => {
    const without = <T,>(prev: Record<string, T>) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    };
    setReports((prev) => prev.filter((r) => r.id !== id));
    setUnreadByReport(without);
    setActivityByReport(without);
    setMatchCountByReport(without);
  };

  const confirmExtendFound = (r: Report) =>
    setConfirmDialog({ kind: "extend", report: r });
  const confirmReactivateLost = (r: Report) =>
    setConfirmDialog({ kind: "reactivateLost", report: r });
  const confirmClose = (r: Report) =>
    setConfirmDialog({ kind: "close", report: r });
  const confirmDelete = (r: Report) =>
    setConfirmDialog({ kind: "delete", report: r });

  // Same server calls as before (DELETE /reports/:id, POST /close, POST /extend-found and the
  // REPORT_REACTIVATION order). A failure stays in the sheet so the user can try again or cancel.
  const reactivateLostReport = async (r: Report) => {
    await extendLostRequest(r.id);
    await load();
    setSection("active");
    setReactivationSuccessOpen(true);
  };

  const runDialogAction = async () => {
    const current = confirmDialog;
    if (!current) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (current.kind === "extend") {
        await extendFoundRequest(current.report.id);
        setConfirmDialog(null);
        await load();
      } else if (current.kind === "reactivateLost") {
        await reactivateLostReport(current.report);
        setConfirmDialog(null);
      } else if (current.kind === "close") {
        await closeReportRequest(current.report.id);
        setConfirmDialog(null);
        await load();
      } else {
        await deleteReportRequest(current.report.id);
        setConfirmDialog(null);
        removeLocally(current.report.id);
        await load();
      }
    } catch (error: any) {
      const friendly = current.kind === "extend" ? lifecycleErrorCopy(error?.code, t) : null;
      const fallback =
        current.kind === "delete"
          ? "cases.delete.failed.body"
          : current.kind === "close"
            ? "cases.could.not.close.case"
            : "cases.please.try.again.later";
      const area =
        current.kind === "delete"
          ? "cases.delete"
          : current.kind === "close"
            ? "cases.close"
            : current.kind === "extend"
              ? "cases.extend"
              : "cases.reactivate";
      const title =
        current.kind === "delete"
          ? t("cases.delete.failed")
          : current.kind === "extend"
            ? t("cases.could.not.extend")
            : current.kind === "reactivateLost"
              ? t("cases.reactivation.failed")
              : t("caseDetail.actionFailed");
      setDialogError({
        title: friendly?.title || title,
        body: friendly?.body || userErrorMessage(error, t, fallback, area),
      });
    } finally {
      setDialogBusy(false);
    }
  };

  const activeReports = reports.filter(isActiveReport);
  const activeIds = new Set(activeReports.map((r) => r.id));
  const historyReports = reports.filter((r) => !activeIds.has(r.id));
  const visibleReports = section === "active" ? activeReports : historyReports;
  const unreadCount = reports.filter((r) => unreadByReport[r.id]).length;

  const subtitle =
    loading && !hasLoadedRef.current
      ? undefined
      : [
          t("cases.subtitle.active", { count: activeReports.length }),
          unreadCount > 0 ? t("cases.subtitle.unread", { count: unreadCount }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const priceText =
    reactivationPrice == null
      ? null
      : reactivationPrice === 0 ? t("areaAlertCreate.pilotFree") : formatMoney(reactivationPrice, STORED_MONEY_CURRENCY, language);

  // ---- Confirm sheet copy ----
  const dialogReport = confirmDialog?.report ?? null;
  const dialogExpired = dialogReport ? isReportExpired(dialogReport) : false;
  const dialogLost = dialogReport?.type === "LOST";
  const dialogCopy: { title: string; body: string; label: string; destructive?: boolean } | null = !confirmDialog
    ? null
    : confirmDialog.kind === "extend"
      ? {
          title: dialogExpired ? t("cases.reactivate.found.report") : t("caseDetail.confirm.extendTitle"),
          body: t("cases.keep.the.report.active.for.up.to.30.more.days.found.reports.can.remain"),
          label: dialogExpired ? t("cases.reactivate.2") : t("cases.extend"),
        }
      : confirmDialog.kind === "reactivateLost"
        ? {
            title: dialogExpired ? t("cases.reactivate.lost.report") : t("caseDetail.confirm.extendTitle"),
            body: t("caseDetail.extendLostBody", { count: Number(confirmDialog.report.paid_extensions || 0) + 1 }),
            label: dialogExpired ? t("cases.reactivate.30.days") : t("caseDetail.next.extendLost"),
          }
        : confirmDialog.kind === "close"
          ? {
              title: dialogLost ? t("caseDetail.confirm.closeLostTitle") : t("cases.close.case"),
              body: t("cases.the.case.stays.in.my.cases.but.it.will.no.longer.be.used.for.new.match"),
              label: t("cases.close.case.2"),
            }
          : {
              title: t("cases.delete.case"),
              body: t("cases.the.case.is.removed.from.your.account.immediately.for.security.and.fra"),
              label: t("cases.delete"),
              destructive: true,
            };

  // ---- Menu (same actions and conditions as before) ----
  // Close the sheet first; iOS cannot open the next sheet while one is still closing.
  const run = (action: () => void) => {
    setMenuReport(null);
    setTimeout(action, 350);
  };
  const menuItems: MenuItem[] = [];
  const menuStatus = menuReport ? reportStatus(menuReport, language, t) : null;
  if (menuReport && menuStatus) {
    const r = menuReport;
    const isClosed = r.status === "CLOSED" || !!r.closed_at;
    const isExpired = menuStatus.expired;
    menuItems.push({ key: "view", icon: "eye-outline", label: t("cases.menu.view"), onPress: () => run(() => openReport(r)) });
    if (!isClosed)
      menuItems.push({ key: "edit", icon: "create-outline", label: isExpired ? t("cases.edit.details") : t("cases.edit"), onPress: () => run(() => editReport(r)) });
    if (canExtendFound(r))
      menuItems.push({
        key: "extend",
        icon: "refresh-outline",
        label: isExpired ? t("cases.reactivate") : t("cases.extend"),
        hint: `${t("cases.extended.count", { count: Number(r.extension_count || 0) })} · ${t("cases.menu.free")}`,
        onPress: () => run(() => confirmExtendFound(r)),
      });
    // T1.9I: a lost case is extended twice; after that it can become a historic case.
    const lostFacts = { paidExtensions: r.paid_extensions, longTermUntil: r.long_term_until };
    if (canExtendLost(r, lostFacts))
      menuItems.push({
        key: "reactivate",
        icon: "refresh-outline",
        label: isExpired ? t("cases.reactivate.30.days") : t("caseDetail.next.extendLost"),
        hint: [t("caseDetail.extensionNumber", { count: Number(r.paid_extensions || 0) + 1 }), priceText].filter(Boolean).join(" · "),
        onPress: () => run(() => confirmReactivateLost(r)),
      });
    else if (r.type === "LOST" && canBuyLongTerm(r) && (r.long_term_until || isInLostExtensionWindow(r)))
      menuItems.push({
        key: "longTerm",
        icon: "hourglass-outline",
        label: r.long_term_until ? t("caseDetail.menu.renewLongTerm") : t("caseDetail.menu.makeHistoric"),
        hint: r.long_term_until
          ? t("caseDetail.historicUntil", { date: formatDate(r.long_term_until, language) })
          : t("caseDetail.menu.makeHistoricHint"),
        onPress: () => run(() => setLongTermReportId(r.id)),
      });
    if (!isClosed && !(r.type === "LOST" && isExpired))
      menuItems.push({
        key: "close",
        icon: "checkmark-circle-outline",
        label: r.type === "LOST" ? t("caseDetail.menu.closeLost") : t("caseDetail.menu.closeFound"),
        hint: t("cases.menu.closeHint"),
        onPress: () => run(() => confirmClose(r)),
      });
    menuItems.push({
      key: "delete",
      icon: "trash-outline",
      label: t("caseDetail.menu.delete"),
      hint: t("cases.menu.deleteHint"),
      danger: true,
      onPress: () => run(() => confirmDelete(r)),
    });
  }

  const goBack = () => {
    // Return to where the user came from (e.g. Profile); home only when opened directly.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const infoButton = (
    <InfoButton title={t("cases.info.title")} label={t("cases.info.label")}>
      <View style={styles.infoBlock}>
        <Text style={styles.infoHeading}>{t("cases.info.sectionsTitle")}</Text>
        <Text style={styles.infoText}>{t("cases.info.sectionsBody")}</Text>
      </View>
      <View style={styles.infoBlock}>
        <Text style={styles.infoHeading}>{t("cases.info.durationTitle")}</Text>
        <Text style={styles.infoText}>
          {t("cases.info.durationLost", { window: LOST_EXTENSION_WINDOW_DAYS, max: LOST_MAX_EXTENSIONS })}
        </Text>
        <Text style={styles.infoText}>
          {t("cases.info.durationFound", { window: FOUND_EXTENSION_WINDOW_DAYS, max: FOUND_MAX_EXTENSIONS })}
        </Text>
      </View>
      <View style={styles.infoBlock}>
        <Text style={styles.infoHeading}>{t("cases.info.matchTitle")}</Text>
        <Text style={styles.infoText}>{t("cases.info.matchBody")}</Text>
      </View>
    </InfoButton>
  );

  const tab = (key: "active" | "history", label: string) => {
    const selected = section === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={[styles.segment, selected && styles.segmentActive]}
        onPress={() => setSection(key)}
      >
        <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text>
      </Pressable>
    );
  };

  const renderCard = (r: Report) => {
    const act = activityByReport[r.id] ?? null;
    const actFromMe = act?.sender_id === user?.id;
    const unread = !!unreadByReport[r.id];
    const status = reportStatus(r, language, t);
    const latestChatId = act?.match_id;
    const count = matchCountByReport[r.id] ?? 0;
    const lost = r.type === "LOST";
    const thumb = thumbnailOf(r);
    const title = caseTitle(r, language);
    const attributes = caseAttributes(r, language);
    const meta = [shortPlace(r.location_label), formatCaseDate(r.created_at, language)].filter(Boolean).join(" · ");
    const hasActions = count > 0 || !!latestChatId;
    return (
      <Pressable
        key={r.id}
        onPress={() => openReport(r)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${status.label}, ${t("cases.view.report")}`}
        style={({ pressed }) => [
          styles.card,
          params.reportId === r.id && styles.cardFocused,
          pressed && styles.cardPressed,
        ]}
      >
        <View style={styles.cardHead}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} accessibilityIgnoresInvertColors />
          ) : (
            <View style={styles.thumb}>
              <Ionicons
                name={lost ? "search-outline" : "checkmark-circle-outline"}
                size={26}
                color={theme.colors.textSecondary}
              />
            </View>
          )}
          <View style={styles.cardHeadText}>
            <View style={styles.badges}>
              <Text style={[styles.badge, lost ? styles.badgeLost : styles.badgeFound]}>
                {lost ? t("caseDetail.lost") : t("caseDetail.found")}
              </Text>
              <Text
                style={[
                  styles.badge,
                  status.tone === "historic" ? styles.badgeHistoric : status.tone === "muted" ? styles.badgeMuted : styles.badgeActive,
                ]}
              >
                {status.label}
              </Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {!!attributes && (
              <Text style={styles.meta} numberOfLines={1}>
                {attributes}
              </Text>
            )}
            {!!meta && (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            )}
            {!hasActions && (
              <Text style={styles.meta} numberOfLines={1}>
                {status.tone === "muted" ? t("cases.no.matches.yet") : t("cases.noMatchesSearching")}
              </Text>
            )}
          </View>
          <View style={styles.moreWrap}>
            <IconButton
              icon="ellipsis-horizontal"
              label={t("cases.more.options")}
              onPress={() => setMenuReport(r)}
              bordered={false}
              color={theme.colors.text}
            />
          </View>
        </View>

        {act && (
          <View style={styles.lastMessage}>
            <Ionicons name="chatbubble-outline" size={16} color={unread ? theme.colors.unread : theme.colors.textSecondary} />
            <Text style={[styles.lastMessageText, unread && styles.unreadText]} numberOfLines={1}>
              {unread ? `${t("cases.new.message")} · ` : ""}
              {actFromMe ? t("cases.you") : t("cases.other.party")}: {shortMessage(act.body)} · {formatClock(act.at, language)}
            </Text>
          </View>
        )}

        {hasActions && (
          <View style={styles.actions}>
            {count > 0 && (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.actionBtn, styles.actionPrimary, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: "/match", params: { reportId: r.id } })}
              >
                <Text style={styles.actionPrimaryText}>{t("caseDetail.next.matchesTitle", { count })}</Text>
              </Pressable>
            )}
            {latestChatId && (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.actionBtn, styles.actionOutline, pressed && styles.pressed]}
                onPress={() => router.push(`/chat/${latestChatId}`)}
              >
                <Text style={[styles.actionOutlineText, unread && styles.unreadText]}>
                  {unread ? t("cases.chatNew") : t("cases.open.chat")}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const empty =
    section === "active" ? (
      <EmptyState
        icon="folder-open-outline"
        title={t("cases.empty.activeTitle")}
        body={t("cases.empty.activeBody")}
        action={
          <View style={styles.emptyActions}>
            <Button label={t("dashboard.lostCta")} onPress={() => router.push(registerRoute(newRegistration, "LOST"))} style={styles.flex} />
            <Button
              label={t("dashboard.foundCta")}
              variant="neutral"
              onPress={() => router.push(registerRoute(newRegistration, "FOUND"))}
              style={styles.flex}
            />
          </View>
        }
      />
    ) : (
      <EmptyState icon="time-outline" title={t("cases.empty.historyTitle")} body={t("cases.empty.historyBody")} />
    );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <ScreenHeader title={t("cases.my.cases")} subtitle={subtitle} onBack={goBack} right={infoButton}>
          <View style={styles.segments} accessibilityRole="tablist">
            {tab("active", t("cases.tab.active", { count: activeReports.length }))}
            {tab("history", t("cases.tab.history", { count: historyReports.length }))}
          </View>
        </ScreenHeader>

        {loading && !hasLoadedRef.current ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>{t("cases.loading.cases")}</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
          >
            {reactivationSuccessOpen && (
              <InlineNotice
                tone="success"
                icon="checkmark-circle-outline"
                title={t("cases.reactivation.success.title")}
                body={t("cases.reactivation.success.body")}
                actionLabel={t("cases.reactivation.success.close")}
                onAction={() => setReactivationSuccessOpen(false)}
                style={styles.notice}
              />
            )}
            {loadError && (
              <InlineNotice
                tone="warning"
                title={t("cases.loadFailed.title")}
                body={t("cases.loadFailed.body")}
                actionLabel={t("errors.retry")}
                onAction={() => void load("refresh")}
                busy={refreshing}
                style={styles.notice}
              />
            )}
            {visibleReports.length > 0
              ? visibleReports.map(renderCard)
              : !loadError && empty}
            {visibleReports.length > 0 && <Text style={styles.footnote}>{t("cases.pullToRefresh")}</Text>}
          </ScrollView>
        )}
      </View>

      <BottomSheet visible={!!menuReport} onClose={() => setMenuReport(null)} accessibilityLabel={t("cases.menu.cancel")}>
        {menuReport && menuStatus && (
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {caseTitle(menuReport, language)}
            </Text>
            <Text style={styles.sheetSubtitle}>
              {menuReport.type === "LOST" ? t("cases.lost") : t("cases.found")} · {menuStatus.label}
            </Text>
          </View>
        )}
        <View>
          {menuItems.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityHint={item.hint}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={item.onPress}
            >
              <Ionicons name={item.icon} size={22} color={item.danger ? theme.colors.dangerStrong : theme.colors.text} />
              <View style={styles.menuText}>
                <Text style={[styles.menuLabel, item.danger && styles.menuDanger]}>{item.label}</Text>
                {!!item.hint && <Text style={styles.menuHint}>{item.hint}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      <ConfirmSheet
        visible={!!confirmDialog}
        title={dialogCopy?.title ?? ""}
        body={dialogCopy?.body}
        confirmLabel={dialogCopy?.label ?? ""}
        cancelLabel={t("cases.cancel")}
        destructive={dialogCopy?.destructive}
        busy={dialogBusy}
        confirmDisabled={confirmDialog?.kind === "reactivateLost" && !consent}
        onCancel={() => {
          if (!dialogBusy) setConfirmDialog(null);
        }}
        onConfirm={() => void runDialogAction()}
      >
        {confirmDialog?.kind === "reactivateLost" && (
          <View style={styles.paymentSummary}>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>{t("cases.reactivation.product")}</Text>
              <Text style={styles.paymentValue}>{t("cases.reactivation.30.days")}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>{t("areaAlertCreate.priceLabel")}</Text>
              <Text style={styles.paymentPrice}>{priceText ?? "…"}</Text>
            </View>
          </View>
        )}
        {!!dialogError && (
          <InlineNotice tone="error" title={dialogError.title} body={dialogError.body} style={styles.sheetNotice} />
        )}
        {confirmDialog?.kind === "reactivateLost" && <WithdrawalConsent checked={consent} onChange={setConsent} />}
      </ConfirmSheet>

      <LongTermSheet
        visible={!!longTermReportId}
        reportId={longTermReportId || ""}
        onClose={() => setLongTermReportId(null)}
        onDone={() => {
          setLongTermReportId(null);
          void load();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  segments: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "#E9EEF5",
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: { backgroundColor: theme.colors.card, ...theme.shadow.card },
  segmentText: { color: theme.colors.textSecondary, fontWeight: "800", fontSize: 14 },
  segmentTextActive: { color: theme.colors.text, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  muted: { color: theme.colors.textSecondary, fontWeight: "600", textAlign: "center" },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  notice: { marginTop: 0 },
  card: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    gap: 10,
  },
  cardFocused: { borderColor: theme.colors.primary, borderWidth: 2 },
  cardPressed: { backgroundColor: "#F8FAFC" },
  cardHead: { flexDirection: "row", gap: 12 },
  cardHeadText: { flex: 1, minWidth: 0, gap: 4 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: "hidden", fontWeight: "900", fontSize: 12 },
  badgeLost: { backgroundColor: "#FFF1F2", color: "#BE123C" },
  badgeFound: { backgroundColor: "#EFF6FF", color: "#1E3A8A" },
  badgeActive: { backgroundColor: "#ECFDF5", color: "#15803D" },
  badgeMuted: { backgroundColor: "#F1F5F9", color: theme.colors.textSecondary },
  badgeHistoric: { backgroundColor: "#EDE9FE", color: "#4C1D95" },
  title: { color: theme.colors.text, fontSize: 17, lineHeight: 22, fontWeight: "900" },
  meta: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  moreWrap: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: theme.colors.divider },
  lastMessage: { flexDirection: "row", alignItems: "center", gap: 8 },
  lastMessageText: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  unreadText: { color: theme.colors.unread, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  actionPrimary: { backgroundColor: theme.colors.primary },
  actionPrimaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  actionOutline: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: theme.colors.card },
  actionOutlineText: { color: theme.colors.text, fontWeight: "800", fontSize: 14 },
  emptyActions: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 8 },
  footnote: { textAlign: "center", fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary, marginTop: 4 },
  infoBlock: { gap: 4 },
  infoHeading: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  infoText: { fontSize: 15, lineHeight: 22, fontWeight: "500", color: "#334155" },
  sheetHead: { gap: 2 },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  sheetSubtitle: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  menuItem: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  menuItemPressed: { backgroundColor: theme.colors.divider },
  menuText: { flex: 1, gap: 2 },
  menuLabel: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  menuHint: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  menuDanger: { color: theme.colors.dangerStrong },
  sheetNotice: { marginTop: 0 },
  paymentSummary: {
    borderRadius: 14,
    padding: 14,
    gap: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  paymentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  paymentLabel: { color: theme.colors.textSecondary, fontWeight: "800" },
  paymentValue: { color: theme.colors.text, fontWeight: "900", flexShrink: 1, textAlign: "right" },
  paymentPrice: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyReportsScreen);
