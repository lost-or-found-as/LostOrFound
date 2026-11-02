// app/premium-status.tsx
// "Mine kjøp": the services the store account has active, and restore purchases.
// T1.9W: kit header with an explanation, AKTIVE section, in-screen notices instead of system
// alerts. The app sells no subscription, so the old subscription block is gone. The screen only
// knows the store entitlements (no history), so TIDLIGERE is not shown.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { useRevenueCatState } from "../src/hooks/useRevenueCatState";
import { userErrorMessage } from "../src/lib/userError";
import { Button, EmptyState, InfoButton, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";

function loadPurchasesModule(): any | null {
  try {
    const mod = require("react-native-purchases");
    return mod?.default ?? mod?.Purchases ?? mod ?? null;
  } catch {
    return null;
  }
}

type RestoreResult = { tone: "success" | "error"; title: string; body: string };

function MyPurchasesScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const purchases = useMemo(() => loadPurchasesModule(), []);
  const { loading, initialized, error, summary, reload } = useRevenueCatState({ purchases, autoLoad: true });
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const activeServices = [
    summary?.canUseGeoBroadcast ? { key: "geo", label: t("purchases.areaAlert") } : null,
    summary?.canUseLegacyCaseListing ? { key: "historic", label: t("purchases.historicCase") } : null,
  ].filter((value): value is { key: string; label: string } => Boolean(value));

  const restore = async () => {
    setRestoreResult(null);
    if (!purchases) {
      setRestoreResult({ tone: "error", title: t("purchases.restoreFailed"), body: t("purchases.storeUnavailable") });
      return;
    }
    try {
      setRestoreLoading(true);
      await purchases.restorePurchases?.();
      await reload();
      setRestoreResult({ tone: "success", title: t("purchases.restoreComplete"), body: t("purchases.restoreCompleteBody") });
    } catch (err: any) {
      setRestoreResult({
        tone: "error",
        title: t("purchases.restoreFailed"),
        body: userErrorMessage(err, t, "common.unknownError", "purchases.restore"),
      });
    } finally {
      setRestoreLoading(false);
    }
  };

  const firstLoad = loading && !initialized;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <ScreenHeader
          title={t("purchases.title")}
          onBack={() => router.back()}
          right={<InfoButton title={t("purchases.info.title")} body={t("purchases.info.body")} />}
        />
        <ScrollView contentContainerStyle={styles.container}>
          {firstLoad ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : error ? (
            <InlineNotice
              tone="warning"
              title={t("purchases.loadFailed")}
              body={t("purchases.loadFailedBody")}
              actionLabel={t("errors.retry")}
              onAction={() => void reload()}
              busy={loading}
              style={styles.noticeFirst}
            />
          ) : (
            <>
              <Text style={styles.section} accessibilityRole="header">{t("purchases.sectionActive")}</Text>
              {activeServices.length > 0 ? (
                <View style={styles.card}>
                  {activeServices.map((service, index) => (
                    <View key={service.key} style={[styles.row, index > 0 && styles.rowDivider]}>
                      <Text style={styles.itemTitle}>{service.label}</Text>
                      <Text style={styles.activeText}>{t("purchases.active")}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState
                  icon="bag-outline"
                  title={t("purchases.noAdditionalServices")}
                  body={t("purchases.emptyBody")}
                />
              )}
            </>
          )}

          <Text style={styles.note}>{t("purchases.footnote")}</Text>

          {!!restoreResult && (
            <InlineNotice
              tone={restoreResult.tone}
              icon={restoreResult.tone === "success" ? "checkmark-circle-outline" : "alert-circle-outline"}
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
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: "900", color: theme.colors.text },
  activeText: { fontSize: 13, fontWeight: "800", color: theme.tone.success.icon },
  note: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyPurchasesScreen);
