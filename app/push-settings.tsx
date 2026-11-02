// app/push-settings.tsx
// Push notifications for this device: status, enable, test and disable.
// T1.9W: kit header, one status card with an icon per state (on / off / blocked), in-screen
// notices for success and errors, and a confirmation before turning notifications off.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import {
  getCurrentPushInstallationState,
  getPushPermissionState,
  openPushNotificationSettings,
  registerPushInstallation,
  sendPushTest,
  unregisterPushInstallation,
  type PushPermissionState,
} from "../src/lib/pushNotifications";
import { Button, ConfirmSheet, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";

type Feedback = { tone: "success" | "error"; body: string };
type VisualState = "on" | "off" | "blocked";

const STATE_LOOK: Record<VisualState, { icon: React.ComponentProps<typeof Ionicons>["name"]; fg: string; bg: string }> = {
  on: { icon: "notifications-outline", fg: theme.tone.success.icon, bg: "#DCFCE7" },
  off: { icon: "notifications-off-outline", fg: theme.colors.textSecondary, bg: theme.colors.chipBg },
  blocked: { icon: "notifications-off-outline", fg: theme.tone.warning.icon, bg: theme.tone.warning.bg },
};

function PushSettingsScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] =
    useState<PushPermissionState>("undetermined");
  const [installationActive, setInstallationActive] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [permissionState, installationState] = await Promise.all([
        getPushPermissionState(),
        getCurrentPushInstallationState(),
      ]);
      setPermission(permissionState);
      setInstallationActive(installationState.active);
    } catch {
      setPermission(
        await getPushPermissionState().catch(
          (): PushPermissionState => "undetermined",
        ),
      );
      setInstallationActive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => listener.remove();
  }, [refresh]);

  const messageForError = (error: any) => {
    const code = String(error?.message ?? error ?? "");
    if (code === "NO_ACTIVE_PUSH_INSTALLATION")
      return t("pushSettings.noActiveInstallation");
    if (code === "PUSH_PERMISSION_NOT_GRANTED")
      return t("pushSettings.permissionNotGranted");
    if (code === "LOGIN_REQUIRED") return t("pushSettings.loginRequired");
    return t("pushSettings.genericError");
  };

  const enable = async () => {
    setFeedback(null);
    try {
      setBusy(true);
      await registerPushInstallation(language);
      await refresh();
      setFeedback({ tone: "success", body: t("pushSettings.enabledSuccessBody") });
    } catch (error: any) {
      await refresh();
      setFeedback({ tone: "error", body: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setFeedback(null);
    try {
      setBusy(true);
      await unregisterPushInstallation();
      await refresh();
      setFeedback({ tone: "success", body: t("pushSettings.disabledSuccessBody") });
    } catch (error: any) {
      setFeedback({ tone: "error", body: messageForError(error) });
    } finally {
      setBusy(false);
      setConfirmDisable(false);
    }
  };

  const test = async () => {
    setFeedback(null);
    try {
      setBusy(true);
      await sendPushTest();
      setFeedback({ tone: "success", body: t("pushSettings.testSuccessBody") });
    } catch (error: any) {
      await refresh();
      setFeedback({ tone: "error", body: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  // One device status: on only when the system allows it and this installation is registered.
  const visual: VisualState =
    permission === "denied" ? "blocked" : installationActive && permission === "granted" ? "on" : "off";
  const look = STATE_LOOK[visual];
  const stateTitle =
    visual === "on"
      ? t("pushSettings.stateOn")
      : visual === "blocked"
        ? t("pushSettings.permissionDeniedTitle")
        : t("pushSettings.stateOff");
  const stateBody =
    visual === "on"
      ? t("pushSettings.stateOnBody")
      : visual === "blocked"
        ? t("pushSettings.permissionDeniedBody")
        : t("pushSettings.permissionIntro");

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <ScreenHeader
          title={t("pushSettings.push.notifications")}
          onBack={() => router.back()}
        />
        <View style={styles.container}>
          <View style={styles.card}>
            {loading ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
            ) : (
              <>
                <View
                  style={styles.statusRow}
                  accessible
                  accessibilityLabel={`${t("pushSettings.deviceStatus")}: ${stateTitle}`}
                >
                  <View style={[styles.statusIcon, { backgroundColor: look.bg }]}>
                    <Ionicons name={look.icon} size={22} color={look.fg} />
                  </View>
                  <View style={styles.statusText}>
                    <Text style={styles.statusTitle}>{stateTitle}</Text>
                    <Text style={styles.statusSubtitle}>{t("pushSettings.onThisDevice")}</Text>
                  </View>
                </View>
                <Text style={styles.body}>{stateBody}</Text>
                {permission === "denied" ? (
                  <Button
                    label={t("pushSettings.openSettings")}
                    disabled={busy}
                    onPress={() => void openPushNotificationSettings()}
                  />
                ) : !installationActive ? (
                  <Button
                    label={t("pushSettings.enableOnDevice")}
                    busy={busy}
                    onPress={() => void enable()}
                  />
                ) : (
                  <Button
                    label={t("pushSettings.send.test.notification")}
                    variant="neutral"
                    busy={busy}
                    onPress={() => void test()}
                  />
                )}
              </>
            )}
          </View>

          {!!feedback && (
            <InlineNotice
              tone={feedback.tone}
              icon={feedback.tone === "success" ? "checkmark-circle-outline" : "alert-circle-outline"}
              title={feedback.tone === "success" ? t("pushSettings.successTitle") : t("pushSettings.could.not.complete")}
              body={feedback.body}
              style={styles.notice}
            />
          )}

          {!loading && permission !== "denied" && installationActive && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={[styles.textButton, busy && styles.disabled]}
              onPress={() => setConfirmDisable(true)}
            >
              <Text style={styles.textButtonText}>{t("pushSettings.disableFromApp")}</Text>
            </Pressable>
          )}

          <Text style={styles.note}>{t("pushSettings.simplePermissionNote")}</Text>
        </View>
      </View>

      <ConfirmSheet
        visible={confirmDisable}
        title={t("pushSettings.disableConfirmTitle")}
        body={t("pushSettings.disableConfirmBody")}
        confirmLabel={t("pushSettings.disableConfirm")}
        cancelLabel={t("pushSettings.cancel")}
        destructive
        busy={busy}
        onConfirm={() => void disable()}
        onCancel={() => setConfirmDisable(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  loader: { marginVertical: 22 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusText: { flex: 1 },
  statusTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  statusSubtitle: { marginTop: 1, fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  notice: { marginTop: 0 },
  textButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  textButtonText: { fontSize: 15, fontWeight: "800", color: theme.colors.dangerStrong },
  disabled: { opacity: 0.5 },
  note: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(PushSettingsScreen);
