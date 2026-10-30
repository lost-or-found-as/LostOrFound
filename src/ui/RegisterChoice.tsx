// src/ui/RegisterChoice.tsx
// T1.9K: "Hva har skjedd?" for the new registration: two cards, tap to start. A lost report
// needs an account; guests are sent to log in first.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nProvider";
import { isAnonymousUser } from "../lib/authGate";
import { theme } from "./theme";
import { ScreenHeader } from "./kit";

export function RegisterChoice() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const isGuest = isAnonymousUser(user as any);

  const open = (type: "LOST" | "FOUND", longAgo = false) => {
    if (type === "LOST" && (!user || isGuest)) {
      router.push({ pathname: "/(auth)/login", params: { returnTo: "/start", reason: "lost" } });
      return;
    }
    router.push({ pathname: "/(report)/register", params: longAgo ? { type, longAgo: "1" } : { type } });
  };

  const card = (
    type: "LOST" | "FOUND",
    icon: React.ComponentProps<typeof Ionicons>["name"],
    tint: { bg: string; fg: string },
    title: string,
    body: string,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={() => open(type)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: tint.bg }]}>
        <Ionicons name={icon} size={26} color={tint.fg} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
    </Pressable>
  );

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("register.choice.title")} subtitle={t("register.choice.subtitle")} onBack={() => router.back()} />
      <View style={styles.content}>
        {card("LOST", "search", { bg: "#FFF1F2", fg: "#BE123C" }, t("register.choice.lost"), t("register.choice.lostBody"))}
        {card("FOUND", "gift-outline", { bg: "#EFF6FF", fg: "#1E3A8A" }, t("register.choice.found"), t("register.choice.foundBody"))}
        {!isGuest && (
          <Pressable accessibilityRole="button" onPress={() => open("LOST", true)} style={styles.link}>
            <Text style={styles.linkText}>{t("register.choice.longAgo")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, gap: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  pressed: { opacity: 0.9 },
  icon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  body: { fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary },
  link: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: 8 },
  linkText: { fontSize: 15, fontWeight: "800", color: theme.colors.text, textDecorationLine: "underline" },
});
