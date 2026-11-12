// app/premium-status.tsx
// "Mine kjøp": the services bought on the user's cases, and restore purchases.
// T1.9W: kit header with an explanation, in-screen notices instead of system alerts.
// T1.9X: the list comes from the server orders (/report-commerce/my-purchases), so services given
// free in the pilot are shown too, with AKTIVE and TIDLIGERE. Restore errors from the store are
// shown as plain text ("the store is not connected yet") instead of "Unknown error (16)".
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDate, formatMoney } from "../src/i18n/formatters";
import { Button, EmptyState, InfoButton, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { fetchMyPurchases, syncStorePurchases, type MyPurchase } from "../src/lib/reportCommerce";
import { userErrorMessage } from "../src/lib/userError";
import { historyStatusKey, isFreePurchase, productNameKey, restoreErrorKey, visibleHistory } from "../src/lib/myPurchases";
import { caseTitle } from "../src/lib/caseDisplay";

type RestoreResult = { tone: "success" | "error"; title: string; body: string };

function MyPurchasesScreen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const [active, setActive] = useState<MyPurchase[]>([]);
  const [history, setHistory] = useState<MyPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    setLoadError(false);
    try {
      const data = await fetchMyPurchases();
      setActive(data.activePurchases || []);
      setHistory(visibleHistory(data.purchaseHistory || []));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // T1.9AE: one-time purchases are not restored by the stores; this finds paid purchases whose
  // confirmation was lost and activates them on their orders.
  const restore = async () => {
    setRestoreResult(null);
    try {
      setRestoreLoading(true);
      const result = await syncStorePurchases();
      await load("refresh");
      const count = result.activated?.length || 0;
      setRestoreResult({
        tone: "success",
        title: t("purchases.restoreComplete"),
        body: count > 0 ? t("purchases.syncActivated", { count }) : t("purchases.syncNothing"),
      });
    } catch (err) {
      setRestoreResult({ tone: "error", title: t("purchases.restoreFailed"), body: userErrorMessage(err, t, restoreErrorKey(err), "purchases.restore") });
    } finally {
      setRestoreLoading(false);
    }
  };

  const renderRow = (item: MyPurchase, index: number, kind: "active" | "history") => {
    const title = item.report && !item.report.deleted_at ? caseTitle(item.report as any, language) : t("purchases.caseGone");
    const free = isFreePurchase(item);
    const detail =
      kind === "active"
        ? item.currentPeriodEnd
          ? t("purchases.activeUntil", { value: formatDate(item.currentPeriodEnd, language) })
          : t("purchases.active")
        : `${t(historyStatusKey(item.status))}${item.purchasedAt ? ` · ${formatDate(item.purchasedAt, language)}` : ""}`;
    const canOpen = !!item.reportId && !!item.report && !item.report.deleted_at;
    return (
      <Pressable
        key={item.id}
        accessibilityRole={canOpen ? "button" : undefined}
        disabled={!canOpen}
        onPress={() => canOpen && router.push(`/report-details/${item.reportId}`)}
        style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.rowPressed]}
      >
        <View style={styles.rowText}>
          <Text style={styles.itemTitle}>{t(productNameKey(item.productCode))}</Text>
          <Text style={styles.itemCase} numberOfLines={1}>{title}</Text>
          <Text style={[styles.itemDetail, kind === "active" && styles.activeText]}>{detail}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.price, free && styles.freeBadge]}>
            {free ? t("purchases.freeInPilot") : formatMoney((item.amountOre || 0) / 100, item.currency || "NOK", language)}
          </Text>
          {canOpen && <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <ScreenHeader
          title={t("purchases.title")}
          onBack={() => router.back()}
          right={<InfoButton title={t("purchases.info.title")} body={t("purchases.info.body")} />}
        />
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
        >
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : loadError ? (
            <InlineNotice
              tone="warning"
              title={t("purchases.loadFailed")}
              body={t("purchases.loadFailedBody")}
              actionLabel={t("errors.retry")}
              onAction={() => void load()}
              style={styles.noticeFirst}
            />
          ) : (
            <>
              <Text style={styles.section} accessibilityRole="header">{t("purchases.sectionActive")}</Text>
              {active.length > 0 ? (
                <View style={styles.card}>{active.map((item, i) => renderRow(item, i, "active"))}</View>
              ) : (
                <EmptyState icon="bag-outline" title={t("purchases.noAdditionalServices")} body={t("purchases.emptyBody")} />
              )}
              {history.length > 0 && (
                <>
                  <Text style={styles.section} accessibilityRole="header">{t("purchases.sectionHistory")}</Text>
                  <View style={styles.card}>{history.map((item, i) => renderRow(item, i, "history"))}</View>
                </>
              )}
            </>
          )}

          <Text style={styles.note}>{t("purchases.footnote")}</Text>

          {!!restoreResult && (
            <InlineNotice
              tone={restoreResult.tone === "success" ? "success" : "warning"}
              icon={restoreResult.tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"}
              title={restoreResult.title}
              body={restoreResult.body}
              style={styles.noticeFirst}
            />
          )}

          <Button
            label={restoreLoading ? t("purchases.restoring") : t("purchases.restore")}
            variant="secondary"
            busy={restoreLoading}
            disabled={loading}
            onPress={() => void restore()}
          />
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  center: { paddingVertical: 40, alignItems: "center", justifyContent: "center" },
  noticeFirst: { marginTop: 0 },
  section: { paddingHorizontal: 4, paddingTop: 2, fontSize: 12, fontWeight: "900", letterSpacing: 0.96, color: theme.colors.textSecondary },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    overflow: "hidden",
  },
  row: { padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowPressed: { opacity: 0.7 },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  rowText: { flex: 1, gap: 2 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  itemTitle: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  itemCase: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  itemDetail: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  activeText: { color: theme.tone.success.icon },
  price: { fontSize: 13, fontWeight: "800", color: theme.colors.text },
  freeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#DCFCE7",
    color: "#166534",
    fontSize: 12,
  },
  note: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyPurchasesScreen);
