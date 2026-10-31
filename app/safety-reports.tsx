// app/safety-reports.tsx
// T1.9M: chat reports for admins (user ids in ADMIN_USER_IDS on the server). Others get NOT_ADMIN.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { requireAccount } from "../src/ui/AccountRequired";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDateTimeCustom } from "../src/i18n/formatters";
import { userErrorMessage } from "../src/lib/userError";
import { caseTitle } from "../src/lib/caseDisplay";
import {
  REPORT_REASON_KEYS,
  fetchAdminReports,
  reportedQuote,
  resolveAdminReport,
  restoreAccount,
  type AdminReport,
} from "../src/lib/chatSafety";
import { Button, ConfirmSheet, EmptyState, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";

type Tab = "open" | "handled";
type Pending = { kind: "suspend" | "restore" | "noAction"; report: AdminReport } | null;

function Screen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [tab, setTab] = useState<Tab>("open");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (mode === "refresh") setRefreshing(true);
      try {
        setReports(await fetchAdminReports(tab));
        setError(null);
      } catch (e) {
        setError(userErrorMessage(e, t, "admin.reports.loadError", "admin.reports"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab, t],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // "Ingen tiltak" runs at once; suspending and reopening are confirmed first.
  const act = async (next: Pending = pending) => {
    if (!next) return;
    setBusy(true);
    try {
      if (next.kind === "restore") await restoreAccount(next.report.reported_user_id);
      else await resolveAdminReport(next.report.id, next.kind === "suspend" ? "SUSPEND" : "NO_ACTION");
      setPending(null);
      await load();
    } catch (e) {
      setPending(null);
      setError(userErrorMessage(e, t, "errors.generic", "admin.reports"));
    } finally {
      setBusy(false);
    }
  };

  const confirm =
    pending?.kind === "suspend"
      ? { title: t("admin.reports.suspendTitle"), body: t("admin.reports.suspendBody"), label: t("admin.reports.suspend"), destructive: true }
      : pending?.kind === "restore"
        ? { title: t("admin.reports.restoreTitle"), body: t("admin.reports.restoreBody"), label: t("admin.reports.restore"), destructive: false }
        : null;

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("admin.reports.title")} subtitle={t("admin.reports.subtitle")} onBack={() => router.back()} raised>
        <View style={s.tabs} accessibilityRole="tablist">
          {(["open", "handled"] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[s.tab, tab === key && s.tabOn]}
            >
              <Text style={[s.tabText, tab === key && s.tabTextOn]}>
                {t(key === "open" ? "admin.reports.open" : "admin.reports.handled")}
                {key === "open" && tab === "open" && !loading ? ` (${reports.length})` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScreenHeader>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
        >
          {!!error && <InlineNotice tone="error" title={error} style={s.noMargin} actionLabel={t("errors.retry")} onAction={() => void load()} />}
          {!error && reports.length === 0 && <EmptyState icon="shield-checkmark-outline" title={t("admin.reports.empty")} />}
          {reports.map((r) => {
            const quote = reportedQuote(r);
            const item = r.item ? caseTitle(r.item, language) : null;
            const by = t(r.reporterRole ? (`admin.reports.by.${r.reporterRole}` as const) : "admin.reports.by.unknown");
            const open = expanded === r.id;
            return (
              <View key={r.id} style={s.card}>
                <View style={s.cardTop}>
                  <Text style={s.reason}>{t(REPORT_REASON_KEYS[r.reason])}</Text>
                  <Text style={s.time}>
                    {formatDateTimeCustom(new Date(r.created_at), language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
                <Text style={s.cardTitle}>{[item, by].filter(Boolean).join(" · ")}</Text>
                {!!r.details && <Text style={s.details}>{r.details}</Text>}
                {!!quote && <Text style={s.quote}>«{quote}»</Text>}
                <Text style={s.totals}>
                  {t("admin.reports.totals", { count: r.reportedTotals.reports, reports: r.reportedTotals.reports, blocked: r.reportedTotals.blockedBy })}
                </Text>
                {r.reportedTotals.suspended && <Text style={s.suspended}>{t("admin.reports.suspended")}</Text>}
                {r.status !== "OPEN" && <Text style={s.totals}>{t(`admin.reports.status.${r.status}` as const)}</Text>}

                {r.message_snapshot.length > 0 && (
                  <Pressable accessibilityRole="button" onPress={() => setExpanded(open ? null : r.id)} style={s.link}>
                    <Text style={s.linkText}>
                      {open ? t("admin.reports.hideMessages") : t("admin.reports.showMessages", { count: r.message_snapshot.length })}
                    </Text>
                  </Pressable>
                )}
                {open && (
                  <View style={s.messages}>
                    {r.message_snapshot.map((m, i) => (
                      <View key={i} style={s.message}>
                        <Text style={s.messageFrom}>{t(`admin.reports.from.${m.from}` as const)}</Text>
                        <Text style={s.messageBody}>{m.body}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {r.status === "OPEN" && (
                  <View style={s.actions}>
                    <Button label={t("admin.reports.noAction")} variant="neutral" style={s.flex1} busy={busy && !pending} onPress={() => void act({ kind: "noAction", report: r })} />
                    {r.reportedTotals.suspended ? (
                      <Button label={t("admin.reports.restore")} variant="secondary" style={s.flex1} onPress={() => setPending({ kind: "restore", report: r })} />
                    ) : (
                      <Button label={t("admin.reports.suspend")} variant="danger" style={s.flex1} onPress={() => setPending({ kind: "suspend", report: r })} />
                    )}
                  </View>
                )}
                {r.status !== "OPEN" && r.reportedTotals.suspended && (
                  <Button label={t("admin.reports.restore")} variant="secondary" onPress={() => setPending({ kind: "restore", report: r })} />
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.title ?? ""}
        body={confirm?.body}
        confirmLabel={confirm?.label ?? ""}
        cancelLabel={t("common.cancel")}
        destructive={confirm?.destructive}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void act()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  noMargin: { marginTop: 0, marginBottom: 0 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  tabOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tabText: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  tabTextOn: { color: "#FFFFFF", fontWeight: "800" },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  reason: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
    color: theme.tone.warning.fg,
    backgroundColor: theme.tone.warning.bg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  time: { fontSize: 12, fontWeight: "700", color: theme.colors.textSecondary },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  details: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.text },
  quote: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#334155", backgroundColor: "#F8FAFC", borderRadius: 12, padding: 10 },
  totals: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  suspended: { fontSize: 13, fontWeight: "800", color: theme.colors.dangerStrong },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontSize: 14, fontWeight: "800", color: theme.colors.text, textDecorationLine: "underline" },
  messages: { gap: 8 },
  message: { gap: 2, borderLeftWidth: 0, backgroundColor: "#F8FAFC", borderRadius: 10, padding: 10 },
  messageFrom: { fontSize: 12, fontWeight: "800", color: theme.colors.textSecondary },
  messageBody: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.text },
  actions: { flexDirection: "row", gap: 8 },
  flex1: { flex: 1 },
});

export default requireAccount(Screen);
