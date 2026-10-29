// app/found-receipt.tsx
// T1.9A: receipt shown to a guest after a found report is submitted. A guest cannot open
// the report afterwards, so this is the last thing they see about it.
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "../src/i18n/I18nProvider";
import { theme } from "../src/ui/theme";

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
          <Ionicons name="checkmark" size={38} color="#047857" />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{t("guest.receiptTitle")}</Text>
        <Text style={styles.body}>{t("guest.receiptBody")}</Text>

        {(!!title || images > 0) && (
          <View style={styles.summary}>
            <View style={styles.summaryIcon}>
              <Ionicons name="image-outline" size={26} color="#6D28D9" />
            </View>
            <View style={styles.summaryText}>
              {!!title && <Text style={styles.summaryTitle} numberOfLines={2}>{title}</Text>}
              {images > 0 && <Text style={styles.summaryMeta}>{t("guest.receiptImages", { count: images })}</Text>}
            </View>
          </View>
        )}

        <View style={styles.follow}>
          <Text style={styles.followTitle}>{t("guest.receiptFollowTitle")}</Text>
          <Text style={styles.followBody}>{t("guest.receiptFollowBody")}</Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={() => router.replace("/(tabs)")}
        >
          <Text style={styles.primaryText}>{t("guest.receiptDone")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={() => router.push({ pathname: "/(auth)/login", params: { mode: "signup", returnTo: "/(tabs)" } })}
        >
          <Text style={styles.secondaryText}>{t("guest.createAccount")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 22, paddingVertical: 24, gap: 14 },
  check: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: "#A7F3D0",
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.colors.text, fontSize: 26, lineHeight: 32, fontWeight: "900", textAlign: "center" },
  body: { color: "#475569", fontSize: 16, lineHeight: 23, fontWeight: "600", textAlign: "center" },
  summary: {
    alignSelf: "stretch",
    marginTop: 8,
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  summaryIcon: { width: 56, height: 56, borderRadius: 12, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  summaryText: { flex: 1, justifyContent: "center", gap: 3 },
  summaryTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
  summaryMeta: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
  follow: {
    alignSelf: "stretch",
    gap: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
  },
  followTitle: { color: "#1E3A8A", fontSize: 15, fontWeight: "800" },
  followBody: { color: "#1E40AF", fontSize: 14, lineHeight: 20, fontWeight: "600" },
  actions: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  primary: { minHeight: 52, borderRadius: 14, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondary: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.85 },
});
