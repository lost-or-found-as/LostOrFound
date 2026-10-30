// app/premium-status.tsx
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { useRevenueCatState } from "../src/hooks/useRevenueCatState";
import { userErrorMessage } from "../src/lib/userError";

function loadPurchasesModule(): any | null {
  try {
    const mod = require("react-native-purchases");
    return mod?.default ?? mod?.Purchases ?? mod ?? null;
  } catch {
    return null;
  }
}

function MyPurchasesScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const purchases = useMemo(() => loadPurchasesModule(), []);
  const { loading, summary, reload } = useRevenueCatState({ purchases, autoLoad: true });
  const [restoreLoading, setRestoreLoading] = useState(false);

  const lostPlusActive = summary?.hasLostPlus ?? false;
  const activeServices = [
    summary?.canUseGeoBroadcast ? t("purchases.areaAlert") : null,
    summary?.canUseLegacyCaseListing ? t("purchases.longTermWatch") : null,
  ].filter((value): value is string => Boolean(value));

  const restore = async () => {
    if (!purchases) {
      Alert.alert(t("purchases.restoreFailed"), t("purchases.storeUnavailable"));
      return;
    }
    try {
      setRestoreLoading(true);
      await purchases.restorePurchases?.();
      await reload();
      Alert.alert(t("purchases.restoreComplete"), t("purchases.restoreCompleteBody"));
    } catch (error: any) {
      Alert.alert(t("purchases.restoreFailed"), userErrorMessage(error, t, "common.unknownError", "purchases.restore"));
    } finally {
      setRestoreLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader title={t("purchases.title")} onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.card}>
            <Text style={styles.h2}>{t("purchases.subscriptions")}</Text>
            {lostPlusActive ? (
              <View style={styles.purchaseRow}>
                <View style={styles.rowText}>
                  <Text style={styles.itemTitle}>Lost Plus</Text>
                  <Text style={styles.itemBody}>{t("purchases.subscriptionActive")}</Text>
                </View>
                <Text style={styles.activeBadge}>{t("purchases.active")}</Text>
              </View>
            ) : (
              <Text style={styles.empty}>{t("purchases.noSubscriptions")}</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>{t("purchases.additionalServices")}</Text>
            {activeServices.length > 0 ? activeServices.map((service) => (
              <View key={service} style={styles.purchaseRow}>
                <Text style={styles.itemTitle}>{service}</Text>
                <Text style={styles.activeBadge}>{t("purchases.active")}</Text>
              </View>
            )) : <Text style={styles.empty}>{t("purchases.noAdditionalServices")}</Text>}
            <Text style={styles.note}>{t("purchases.servicesPerCase")}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>{t("purchases.restoreTitle")}</Text>
            <Text style={styles.note}>{t("purchases.restoreBody")}</Text>
            <Pressable style={[styles.button, (loading || restoreLoading) && styles.disabled]} disabled={loading || restoreLoading} onPress={() => void restore()}>
              <Text style={styles.buttonText}>{restoreLoading ? t("purchases.restoring") : t("purchases.restore")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: theme.space.lg, paddingBottom: 40 },
  card: { marginBottom: theme.space.md, padding: theme.space.lg, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, ...theme.shadow.card },
  h2: { fontSize: theme.type.h2, fontWeight: "900", color: theme.colors.text },
  purchaseRow: { marginTop: theme.space.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: theme.space.md, borderTopWidth: 1, borderTopColor: theme.colors.border },
  rowText: { flex: 1 },
  itemTitle: { fontSize: theme.type.body, fontWeight: "900", color: theme.colors.text },
  itemBody: { marginTop: 4, color: theme.colors.muted, fontWeight: "600" },
  activeBadge: { color: "#15803D", backgroundColor: "#ECFDF5", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontWeight: "900" },
  empty: { marginTop: theme.space.md, color: theme.colors.muted, fontWeight: "700", lineHeight: 20 },
  note: { marginTop: theme.space.md, color: theme.colors.muted, fontWeight: "600", lineHeight: 19 },
  button: { marginTop: theme.space.lg, minHeight: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  buttonText: { color: "#fff", fontWeight: "900" },
  disabled: { opacity: 0.55 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyPurchasesScreen);
