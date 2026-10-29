// app/(tabs)/profile.tsx
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { isAnonymousUser } from "../../src/lib/authGate";
import { theme } from "../../src/ui/theme";

export default function ProfileTab() {
  const router = useRouter();
  const { user, session, signOut } = useAuth();
  const { t } = useI18n();

  const isGuest = isAnonymousUser(user as any);
  const email = session?.user?.email;

  const logout = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  const rows = [
    {
      icon: "folder-open-outline" as const,
      title: t("profile.cases"),
      onPress: () => router.push("/my-reports"),
    },
    {
      icon: "notifications-outline" as const,
      title: t("profile.notifications"),
      onPress: () => router.push("/notifications"),
    },
    {
      icon: "map-outline" as const,
      title: t("profile.alertAreas"),
      onPress: () => router.push("/alert-areas"),
    },
    {
      icon: "settings-outline" as const,
      title: t("profile.pushNotifications"),
      onPress: () => router.push("/push-settings"),
    },
    {
      icon: "receipt-outline" as const,
      title: t("profile.purchases"),
      onPress: () => router.push("/premium-status"),
    },
    {
      icon: "language-outline" as const,
      title: t("profile.language"),
      onPress: () => router.push("/language"),
    },
    {
      icon: "help-circle-outline" as const,
      title: t("profile.how"),
      onPress: () => router.push("/how"),
    },
  ];

  // T1.9A: guests only get language and help; everything else needs an account.
  const visibleRows = isGuest
    ? rows.filter((row) => row.title === t("profile.language") || row.title === t("profile.how"))
    : rows;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>{t("profile.title")}</Text>

        <View style={styles.accountCard}>
          <View style={styles.avatar}>
            <Ionicons
              name={isGuest ? "person-outline" : "person"}
              size={32}
              color={theme.colors.primary}
            />
          </View>

          <View style={styles.accountText}>
            <Text style={styles.accountTitle}>
              {isGuest ? t("profile.guest") : t("profile.account")}
            </Text>
            <Text style={styles.accountSub}>
              {email || (isGuest ? t("profile.guestBody") : t("profile.noEmail"))}
            </Text>
          </View>
        </View>

        {isGuest && (
          <>
            <Pressable
              accessibilityRole="button"
              style={styles.primary}
              onPress={() =>
                router.push({
                  pathname: "/(auth)/login",
                  params: { mode: "signup", returnTo: "/(tabs)/profile" },
                })
              }
            >
              <Text style={styles.primaryText}>{t("guest.createAccount")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.secondary}
              onPress={() =>
                router.push({
                  pathname: "/(auth)/login",
                  params: { mode: "login", returnTo: "/(tabs)/profile" },
                })
              }
            >
              <Text style={styles.secondaryText}>{t("guest.haveAccount")}</Text>
            </Pressable>
            <View style={styles.claimNote}>
              <Ionicons name="information-circle-outline" size={20} color="#1D4ED8" />
              <Text style={styles.claimNoteText}>{t("guest.profileClaimNote")}</Text>
            </View>
          </>
        )}

        <View style={styles.menuCard}>
          {visibleRows.map((row, index) => (
            <React.Fragment key={row.title}>
              <Pressable style={styles.row} onPress={row.onPress}>
                <Ionicons name={row.icon} size={23} color={theme.colors.primary} />
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </Pressable>
              {index < visibleRows.length - 1 && <View style={styles.divider} />}
            </React.Fragment>
          ))}
        </View>

        {user ? (
          <Pressable style={styles.logout} onPress={logout}>
            <Text style={styles.logoutText}>{t("profile.logout")}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={() => router.push("/(auth)/login")}>
            <Text style={styles.primaryText}>{t("profile.login")}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    padding: theme.space.lg,
    paddingBottom: 110,
  },
  pageTitle: {
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 28,
    marginBottom: 18,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 20,
    ...theme.shadow.card,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  accountText: {
    flex: 1,
  },
  accountTitle: {
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 18,
  },
  accountSub: {
    marginTop: 4,
    color: theme.colors.muted,
    fontWeight: "600",
    lineHeight: 18,
  },
  menuCard: {
    marginTop: 20,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 20,
    overflow: "hidden",
  },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  rowTitle: {
    flex: 1,
    marginLeft: 13,
    color: theme.colors.text,
    fontWeight: "800",
    fontSize: 15,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 52,
  },
  primary: {
    marginTop: 16,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: theme.colors.primary,
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  secondary: {
    marginTop: 10,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  secondaryText: {
    color: theme.colors.text,
    fontWeight: "900",
  },
  claimNote: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
  },
  claimNoteText: {
    flex: 1,
    color: "#1E40AF",
    fontWeight: "600",
    lineHeight: 20,
  },
  logout: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
  },
  logoutText: {
    color: "#B91C1C",
    fontWeight: "900",
  },
});
