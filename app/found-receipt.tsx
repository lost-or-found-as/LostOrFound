// app/found-receipt.tsx
// T1.9A: receipt shown to a guest after a found report is submitted. A guest cannot open
// the report afterwards, so this is the last thing they see about it.
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "../src/i18n/I18nProvider";
import { theme } from "../src/ui/theme";
import { Button } from "../src/ui/kit";

export default function FoundReceiptScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ title?: string; images?: string }>();
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const images = Math.max(0, Number(params.images) || 0);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.check}>
          <Ionicons name="checkmark" size={36} color={theme.tone.success.icon} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {t("guest.receiptTitle")}
        </Text>
        <Text style={styles.body}>{t("guest.receiptBody")}</Text>

        {(!!title || images > 0) && (
          <View style={styles.card}>
            {images > 0 && (
              <View style={styles.summaryIcon}>
                <Ionicons name="image-outline" size={24} color={theme.colors.textSecondary} />
              </View>
            )}
            <View style={styles.summaryText}>
              {!!title && (
                <Text style={styles.summaryTitle} numberOfLines={2}>
                  {title}
                </Text>
              )}
              {images > 0 && <Text style={styles.summaryMeta}>{t("guest.receiptImageCount", { count: images })}</Text>}
            </View>
          </View>
        )}

        <View style={[styles.card, styles.follow]}>
          <Text style={styles.followTitle}>{t("guest.receiptFollowTitle")}</Text>
          <Text style={styles.followBody}>{t("guest.receiptFollowBody")}</Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label={t("guest.createAccount")}
          onPress={() => router.push({ pathname: "/(auth)/login", params: { mode: "signup", returnTo: "/(tabs)" } })}
        />
        <Button label={t("guest.receiptDone")} variant="neutral" onPress={() => router.replace("/(tabs)")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  check: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: theme.tone.success.border,
    backgroundColor: theme.tone.success.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.colors.text, fontSize: 28, lineHeight: 34, fontWeight: "900" },
  body: { color: theme.colors.textSecondary, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  summaryIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryText: { flex: 1, gap: 3 },
  summaryTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  summaryMeta: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  follow: { flexDirection: "column", alignItems: "stretch", gap: 6 },
  followTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  followBody: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  actions: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
});
