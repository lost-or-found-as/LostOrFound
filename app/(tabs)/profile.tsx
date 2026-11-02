// app/(tabs)/profile.tsx
// T1.9W: account card, menu rows in two labelled groups, log out and delete account (both
// confirmed in a sheet).
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { isAnonymousUser } from "../../src/lib/authGate";
import { theme } from "../../src/ui/theme";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { sendSentryTestEvent } from "../../src/lib/sentry";
import { fetchIsAdmin } from "../../src/lib/chatSafety";
import { deleteAccountRequest } from "../../src/lib/accountDeletion";
import { openLegal } from "../../src/lib/legal";
import { userErrorMessage } from "../../src/lib/userError";
import { Button, ConfirmSheet } from "../../src/ui/kit";

type MenuRow = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  value?: string;
  onPress: () => void;
  // T1.9A: guests only see rows that work without an account.
  guestOk?: boolean;
};

export default function ProfileTab() {
  const router = useRouter();
  const { user, session, signOut } = useAuth();
  const { language, t } = useI18n();

  const isGuest = isAnonymousUser(user as any);
  const email = session?.user?.email;
  // T1.9M: admins (server list) get the chat report list.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user || isGuest) return;
    let live = true;
    void fetchIsAdmin().then((value) => live && setIsAdmin(value));
    return () => {
      live = false;
    };
  }, [user?.id, isGuest]);
  // T1.9D: test builds (staging) can prove that errors reach Sentry.
  const isTestBuild = process.env.EXPO_PUBLIC_APP_ENV === "staging";
  const [sentryTest, setSentryTest] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const runSentryTest = async () => {
    setSentryTest("sending");
    setSentryTest((await sendSentryTestEvent()) ? "sent" : "failed");
  };

  // T1.9P: delete the account from the app (required by Apple and Google).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountRequest();
      setDeleteOpen(false);
      await signOut().catch(() => {});
      router.replace("/(auth)/login");
    } catch (e) {
      setDeleteError(userErrorMessage(e, t, "profile.deleteAccount.failed", "account.delete"));
    } finally {
      setDeleting(false);
    }
  };

  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      setLogoutOpen(false);
      router.replace("/(auth)/login");
    } finally {
      setLoggingOut(false);
    }
  };

  const caseRows: MenuRow[] = [
    { key: "cases", icon: "folder-open-outline", title: t("profile.cases"), onPress: () => router.push("/my-reports") },
    { key: "alertAreas", icon: "map-outline", title: t("profile.alertAreas"), onPress: () => router.push("/alert-areas") },
    {
      key: "push",
      icon: "notifications-outline",
      title: t("profile.pushNotifications"),
      onPress: () => router.push("/push-settings"),
    },
    { key: "purchases", icon: "receipt-outline", title: t("profile.purchases"), onPress: () => router.push("/premium-status") },
  ];

  const helpRows: MenuRow[] = [
    {
      key: "language",
      icon: "language-outline",
      title: t("profile.language"),
      value: t("language.currentName"),
      onPress: () => router.push("/language"),
      guestOk: true,
    },
    { key: "how", icon: "help-circle-outline", title: t("profile.how"), onPress: () => router.push("/how"), guestOk: true },
    {
      key: "feedback",
      icon: "chatbox-ellipses-outline",
      title: t("profile.feedback"),
      onPress: () => router.push("/feedback"),
      guestOk: true,
    },
    // T1.9R: privacy policy and terms (also for guests).
    {
      key: "privacy",
      icon: "shield-outline",
      title: t("legal.privacy"),
      onPress: () => void openLegal("privacy", language),
      guestOk: true,
    },
    {
      key: "terms",
      icon: "document-text-outline",
      title: t("legal.terms"),
      onPress: () => void openLegal("terms", language),
      guestOk: true,
    },
    ...(isAdmin
      ? [
          {
            key: "admin",
            icon: "shield-checkmark-outline" as const,
            title: t("profile.safetyReports"),
            onPress: () => router.push("/safety-reports"),
          },
          {
            key: "adminFeedback",
            icon: "chatbubbles-outline" as const,
            title: t("profile.adminFeedback"),
            onPress: () => router.push("/feedback-admin"),
          },
        ]
      : []),
  ];

  const visible = (rows: MenuRow[]) => (isGuest ? rows.filter((row) => row.guestOk) : rows);
  const sections = [
    { key: "cases", label: t("profile.section.cases"), rows: visible(caseRows) },
    { key: "help", label: t("profile.section.help"), rows: visible(helpRows) },
  ].filter((section) => section.rows.length > 0);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle} accessibilityRole="header">
          {t("profile.title")}
        </Text>

        <View style={styles.accountCard}>
          <View style={styles.avatar}>
            <Ionicons name={isGuest ? "person-outline" : "person"} size={26} color={theme.colors.primary} />
          </View>
          <View style={styles.accountText}>
            <Text style={styles.accountTitle}>{isGuest ? t("profile.guest") : t("profile.account")}</Text>
            <Text style={styles.accountSub}>{email || (isGuest ? t("profile.guestBody") : t("profile.noEmail"))}</Text>
          </View>
        </View>

        {isGuest && (
          <View style={styles.stack}>
            <Button
              label={t("guest.createAccount")}
              onPress={() =>
                router.push({
                  pathname: "/(auth)/login",
                  params: { mode: "signup", returnTo: "/(tabs)/profile" },
                })
              }
            />
            <Button
              label={t("guest.haveAccount")}
              variant="neutral"
              onPress={() =>
                router.push({
                  pathname: "/(auth)/login",
                  params: { mode: "login", returnTo: "/(tabs)/profile" },
                })
              }
            />
            <InlineNotice tone="info" icon="information-circle-outline" title={t("guest.profileClaimNote")} style={styles.noMargin} />
          </View>
        )}

        {sections.map((section) => (
          <View key={section.key} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            <View style={styles.menuCard}>
              {section.rows.map((row, index) => (
                <React.Fragment key={row.key}>
                  {index > 0 && <View style={styles.divider} />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={row.value ? `${row.title}, ${row.value}` : row.title}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={row.onPress}
                  >
                    <Ionicons name={row.icon} size={22} color={theme.colors.primary} />
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    {!!row.value && <Text style={styles.rowValue}>{row.value}</Text>}
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {isTestBuild && !isGuest && (
          <View style={styles.stack}>
            <Button
              label={t("profile.sentryTest")}
              variant="neutral"
              busy={sentryTest === "sending"}
              onPress={() => void runSentryTest()}
            />
            {sentryTest === "sent" && (
              <InlineNotice tone="info" icon="checkmark-circle-outline" title={t("profile.sentryTestSent")} style={styles.noMargin} />
            )}
            {sentryTest === "failed" && <InlineNotice tone="error" title={t("profile.sentryTestFailed")} style={styles.noMargin} />}
          </View>
        )}

        {isGuest ? null : user ? (
          <Button label={t("profile.logout")} variant="neutral" onPress={() => setLogoutOpen(true)} style={styles.logout} />
        ) : (
          <Button label={t("profile.login")} onPress={() => router.push("/(auth)/login")} style={styles.logout} />
        )}

        {!!user && !isGuest && (
          <Pressable accessibilityRole="button" style={styles.deleteAccount} onPress={() => setDeleteOpen(true)}>
            <Text style={styles.deleteAccountText}>{t("profile.deleteAccount.button")}</Text>
          </Pressable>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={logoutOpen}
        title={t("profile.logoutConfirm.title")}
        body={t("profile.logoutConfirm.body")}
        confirmLabel={t("profile.logout")}
        cancelLabel={t("common.cancel")}
        busy={loggingOut}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => void logout()}
      />

      <ConfirmSheet
        visible={deleteOpen}
        title={t("profile.deleteAccount.title")}
        body={t("profile.deleteAccount.body")}
        confirmLabel={t("profile.deleteAccount.confirm")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={deleting}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => void deleteAccount()}
      >
        {!!deleteError && <InlineNotice tone="error" title={deleteError} style={styles.noMargin} />}
      </ConfirmSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 110, gap: 12 },
  pageTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 26, paddingTop: 6 },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.chipBg,
    alignItems: "center",
    justifyContent: "center",
  },
  accountText: { flex: 1, gap: 2 },
  accountTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 17 },
  accountSub: { color: theme.colors.textSecondary, fontWeight: "600", lineHeight: 18 },
  stack: { gap: 10 },
  noMargin: { marginTop: 0 },
  section: { gap: 8, marginTop: 4 },
  sectionLabel: {
    paddingHorizontal: 4,
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  menuCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    overflow: "hidden",
  },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  rowTitle: { flex: 1, color: theme.colors.text, fontWeight: "800", fontSize: 15 },
  rowValue: { color: theme.colors.textSecondary, fontWeight: "600", fontSize: 14 },
  divider: { height: 1, backgroundColor: theme.colors.divider, marginLeft: 50 },
  logout: { marginTop: 8 },
  deleteAccount: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  deleteAccountText: { fontSize: 15, fontWeight: "800", color: theme.colors.dangerStrong, textDecorationLine: "underline" },
  pressed: { opacity: 0.7 },
});
