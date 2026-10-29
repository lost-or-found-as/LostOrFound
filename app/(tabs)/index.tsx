// app/(tabs)/index.tsx
import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/contexts/AuthContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { isAnonymousUser } from "../../src/lib/authGate";
import { AuthHeaderAction } from "../../src/ui/AuthHeaderAction";
import { theme } from "../../src/ui/theme";

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const isGuest = isAnonymousUser(user as any);

  const openLost = () => {
    if (!user || isGuest) {
      router.push({
        pathname: "/(auth)/login",
        params: { returnTo: "/start", reason: "lost" },
      });
      return;
    }

    router.push({
      pathname: "/(report)/create-report",
      params: { type: "LOST" },
    });
  };

  const openFound = () => {
    router.push({
      pathname: "/(report)/create-report",
      params: { type: "FOUND" },
    });
  };

  // T1.9A: guests see the found report first; lost reports need an account.
  const lostCard = (
    <Pressable
      style={({ pressed }) => [styles.actionCard, styles.lostCard, pressed && styles.pressed]}
      onPress={openLost}
      accessibilityRole="button"
      accessibilityLabel={t("dashboard.lostCta")}
    >
      <View style={[styles.iconCircle, styles.lostIcon]}>
        <Ionicons name="search-outline" size={28} color="#B45309" />
      </View>
      <View style={styles.actionText}>
        <View style={styles.titleRow}>
          <Text style={styles.actionTitle}>{t("dashboard.lostTitle")}</Text>
          {isGuest && (
            <View style={styles.lockPill}>
              <Ionicons name="lock-closed" size={12} color="#475569" />
              <Text style={styles.lockPillText}>{t("guest.locked")}</Text>
            </View>
          )}
        </View>
        <Text style={styles.actionBody}>{isGuest ? t("guest.homeLostBody") : t("dashboard.lostBody")}</Text>
        <Text style={styles.actionLink}>{isGuest ? t("guest.homeLostCta") : t("dashboard.lostCta")}</Text>
      </View>
      <Ionicons name="chevron-forward" size={23} color="#B45309" />
    </Pressable>
  );

  const foundCard = (
    <Pressable
      style={({ pressed }) => [styles.actionCard, styles.foundCard, isGuest && styles.guestPrimaryCard, pressed && styles.pressed]}
      onPress={openFound}
      accessibilityRole="button"
      accessibilityLabel={t("dashboard.foundCta")}
    >
      <View style={[styles.iconCircle, styles.foundIcon]}>
        <Ionicons name="checkmark-circle-outline" size={28} color="#15803D" />
      </View>
      <View style={styles.actionText}>
        <Text style={styles.actionTitle}>{t("dashboard.foundTitle")}</Text>
        <Text style={styles.actionBody}>{isGuest ? t("guest.homeFoundBody") : t("dashboard.foundBody")}</Text>
        <Text style={styles.actionLink}>{isGuest ? t("guest.homeFoundCta") : t("dashboard.foundCta")}</Text>
      </View>
      <Ionicons name="chevron-forward" size={23} color="#15803D" />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image
              source={require("../../assets/images/icon.png")}
              style={styles.logo}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.headerText}>
              <Text style={styles.brand}>Lost or Found</Text>
              <Text style={styles.greeting}>{t("dashboard.greeting")}</Text>
            </View>
          </View>
          <AuthHeaderAction />
        </View>

        <Text style={styles.sectionTitle}>{t("dashboard.whatToDo")}</Text>

        {isGuest ? (
          <>
            {foundCard}
            {lostCard}
          </>
        ) : (
          <>
            {lostCard}
            {foundCard}
          </>
        )}

        {isGuest && <Text style={styles.guestFootnote}>{t("guest.homeFootnote")}</Text>}

        <Text style={styles.safety}>{t("dashboard.safety")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  lockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.chipBg,
  },
  lockPillText: { color: "#475569", fontSize: 12, fontWeight: "800" },
  guestPrimaryCard: { borderWidth: 2, borderColor: theme.colors.primary },
  guestFootnote: { marginTop: 4, color: theme.colors.muted, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  safe: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    padding: theme.space.lg,
    paddingBottom: 110,
  },
  header: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  brandRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 17,
    marginRight: 14,
  },
  headerText: {
    flex: 1,
  },
  brand: {
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 24,
    lineHeight: 29,
  },
  greeting: {
    marginTop: 4,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 15,
    lineHeight: 19,
  },
  guestCard: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 13,
    borderRadius: 14,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
  },
  guestText: {
    flex: 1,
    marginLeft: 9,
    color: "#9A3412",
    fontWeight: "700",
    lineHeight: 19,
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 12,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 18,
  },
  actionCard: {
    minHeight: 132,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  lostCard: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  foundCard: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  lostIcon: {
    backgroundColor: "#FEF3C7",
  },
  foundIcon: {
    backgroundColor: "#DCFCE7",
  },
  actionText: {
    flex: 1,
  },
  actionTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  actionBody: {
    marginTop: 5,
    color: theme.colors.muted,
    lineHeight: 19,
    fontWeight: "600",
  },
  actionLink: {
    marginTop: 9,
    color: theme.colors.primary,
    fontWeight: "900",
  },
  safety: {
    marginTop: 18,
    paddingHorizontal: 12,
    color: theme.colors.muted,
    textAlign: "center",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
});
