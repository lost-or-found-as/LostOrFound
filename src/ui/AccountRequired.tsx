// src/ui/AccountRequired.tsx
// T1.9A: what a guest sees instead of a feature that needs a registered account.
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nProvider";
import { isAnonymousUser } from "../lib/authGate";
import { theme } from "./theme";

export const GUEST_NOT_ALLOWED = "GUEST_NOT_ALLOWED";

export function useIsGuest(): boolean {
  const { user } = useAuth();
  return isAnonymousUser(user as any);
}

// True when an API error (code, Error or JSON body) means "guests may not do this".
export function isGuestNotAllowed(error: unknown): boolean {
  const e = error as any;
  return e === GUEST_NOT_ALLOWED || e?.code === GUEST_NOT_ALLOWED || e?.error === GUEST_NOT_ALLOWED || e?.message === GUEST_NOT_ALLOWED;
}

export function AccountRequiredView({ showBack = true }: { showBack?: boolean }) {
  const router = useRouter();
  const { t } = useI18n();

  const openLogin = (mode: "signup" | "login") =>
    router.push({ pathname: "/(auth)/login", params: { mode, returnTo: "/(tabs)" } });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {showBack && (
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("guest.back")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed-outline" size={34} color={theme.colors.text} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{t("guest.requiredTitle")}</Text>
        <Text style={styles.body}>{t("guest.requiredBody")}</Text>

        <View style={styles.benefits}>
          {(["guest.benefitMatches", "guest.benefitChat", "guest.benefitAlerts"] as const).map((key) => (
            <View key={key} style={styles.benefitRow}>
              <Ionicons name="checkmark" size={20} color="#047857" />
              <Text style={styles.benefitText}>{t(key)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => openLogin("signup")}>
          <Text style={styles.primaryText}>{t("guest.createAccount")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => openLogin("login")}>
          <Text style={styles.secondaryText}>{t("guest.haveAccount")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.link} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.linkText}>{t("guest.backHome")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// Wrap a screen that needs a registered account: guests see AccountRequiredView instead.
export function requireAccount<P extends object>(Screen: React.ComponentType<P>) {
  function AccountGatedScreen(props: P) {
    const isGuest = useIsGuest();
    if (isGuest) return <AccountRequiredView />;
    return <Screen {...props} />;
  }
  AccountGatedScreen.displayName = `requireAccount(${Screen.displayName || Screen.name || "Screen"})`;
  return AccountGatedScreen;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 28, paddingVertical: 24, gap: 14 },
  iconWrap: { width: 72, height: 72, borderRadius: 22, backgroundColor: theme.colors.chipBg, alignItems: "center", justifyContent: "center" },
  title: { color: theme.colors.text, fontSize: 24, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  body: { color: "#475569", fontSize: 16, lineHeight: 23, fontWeight: "600", textAlign: "center" },
  benefits: {
    alignSelf: "stretch",
    marginTop: 6,
    padding: 16,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  benefitText: { flex: 1, color: theme.colors.text, fontSize: 15, lineHeight: 21, fontWeight: "700" },
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
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: "#475569", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.85 },
});
