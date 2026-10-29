import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { PremiumHeader } from "../src/ui/PremiumHeader";
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

function PushSettingsScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] =
    useState<PushPermissionState>("undetermined");
  const [installationActive, setInstallationActive] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    if (permission === "denied") {
      Alert.alert(
        t("pushSettings.permissionDeniedTitle"),
        t("pushSettings.permissionDeniedBody"),
        [
          { text: t("pushSettings.cancel"), style: "cancel" },
          {
            text: t("pushSettings.openSettings"),
            onPress: () => void openPushNotificationSettings(),
          },
        ],
      );
      return;
    }
    try {
      setBusy(true);
      await registerPushInstallation(language);
      await refresh();
      setSuccessMessage(t("pushSettings.enabledSuccessBody"));
    } catch (error: any) {
      await refresh();
      Alert.alert(t("pushSettings.could.not.complete"), messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    try {
      setBusy(true);
      await unregisterPushInstallation();
      await refresh();
      setSuccessMessage(t("pushSettings.disabledSuccessBody"));
    } catch (error: any) {
      Alert.alert(t("pushSettings.could.not.complete"), messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      setBusy(true);
      await sendPushTest();
      setSuccessMessage(t("pushSettings.testSuccessBody"));
    } catch (error: any) {
      await refresh();
      Alert.alert(t("pushSettings.could.not.complete"), messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const permissionKey =
    permission === "granted"
      ? "pushSettings.statusEnabled"
      : permission === "denied"
        ? "pushSettings.statusBlocked"
        : "pushSettings.statusNotEnabled";
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={t("pushSettings.push.notifications")}
          onBack={() => router.back()}
        />
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>
              {t("pushSettings.receive.important.updates")}
            </Text>
            <Text style={styles.body}>{t("pushSettings.permissionIntro")}</Text>
            {loading ? (
              <ActivityIndicator style={styles.loader} />
            ) : (
              <>
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>
                    {t("pushSettings.deviceStatus")}
                  </Text>
                  <Text
                    style={[
                      styles.statusValue,
                      installationActive &&
                        permission === "granted" &&
                        styles.statusEnabled,
                    ]}
                  >
                    {t(
                      installationActive && permission === "granted"
                        ? "pushSettings.registrationEnabled"
                        : "pushSettings.registrationDisabled",
                    )}
                  </Text>
                </View>
                {permission === "denied" ? (
                  <Pressable
                    disabled={busy}
                    style={[styles.primary, busy && styles.disabled]}
                    onPress={() => void openPushNotificationSettings()}
                  >
                    <Text style={styles.primaryText}>
                      {t("pushSettings.openSettings")}
                    </Text>
                  </Pressable>
                ) : !installationActive ? (
                  <Pressable
                    disabled={busy}
                    style={[styles.primary, busy && styles.disabled]}
                    onPress={() => void enable()}
                  >
                    {busy ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryText}>
                        {t("pushSettings.enableOnDevice")}
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      disabled={busy}
                      style={[styles.secondary, busy && styles.disabled]}
                      onPress={() => void test()}
                    >
                      <Text style={styles.secondaryText}>
                        {t("pushSettings.send.test.notification")}
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      style={styles.textButton}
                      onPress={() => void disable()}
                    >
                      <Text style={styles.textButtonText}>
                        {t("pushSettings.disableFromApp")}
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
            {successMessage && (
              <View style={styles.successCard}>
                <View style={styles.successIcon}>
                  <Text style={styles.successIconText}>✓</Text>
                </View>
                <View style={styles.successContent}>
                  <Text style={styles.successTitle}>
                    {t("pushSettings.successTitle")}
                  </Text>
                  <Text style={styles.successBody}>{successMessage}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("pushSettings.closeSuccess")}
                  onPress={() => setSuccessMessage(null)}
                  style={styles.successClose}
                >
                  <Text style={styles.successCloseText}>×</Text>
                </Pressable>
              </View>
            )}
          </View>
          <Text style={styles.note}>
            {t("pushSettings.simplePermissionNote")}
          </Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 18 },
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 18,
    ...theme.shadow.card,
  },
  title: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  body: {
    marginTop: 8,
    color: theme.colors.muted,
    fontWeight: "700",
    lineHeight: 20,
  },
  loader: { marginTop: 22 },
  statusRow: {
    marginTop: 12,
    padding: 13,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  statusLabel: { flex: 1, color: theme.colors.muted, fontWeight: "800" },
  statusValue: {
    color: theme.colors.danger,
    fontWeight: "900",
    textAlign: "right",
  },
  statusEnabled: { color: "#15803D" },
  primary: {
    marginTop: 18,
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "900" },
  secondary: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  secondaryText: { color: theme.colors.text, fontWeight: "900" },
  textButton: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  textButtonText: { color: theme.colors.danger, fontWeight: "900" },
  settingsButton: { marginTop: 10, paddingVertical: 10, alignItems: "center" },
  settingsButtonText: { color: theme.colors.primary, fontWeight: "900" },
  successCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#86EFAC",
    backgroundColor: "#F0FDF4",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  successIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#15803D",
    alignItems: "center",
    justifyContent: "center",
  },
  successIconText: { color: "#fff", fontWeight: "900", fontSize: 18 },
  successContent: { flex: 1 },
  successTitle: { color: "#166534", fontWeight: "900", fontSize: 15 },
  successBody: {
    marginTop: 3,
    color: "#166534",
    fontWeight: "700",
    lineHeight: 18,
  },
  successClose: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  successCloseText: {
    color: "#166534",
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "700",
  },
  disabled: { opacity: 0.45 },
  note: {
    marginTop: 14,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
  },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(PushSettingsScreen);
