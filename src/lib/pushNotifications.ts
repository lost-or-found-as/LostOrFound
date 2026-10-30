
import { useEffect } from "react";
import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./config";

const INSTALLATION_KEY = "@lostfound:pushInstallationId:v1";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const makeId = () => `install-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export async function getPushInstallationId() {
  const current = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (current) return current;
  const next = makeId();
  await AsyncStorage.setItem(INSTALLATION_KEY, next);
  return next;
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("LOGIN_REQUIRED");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}


export type PushPermissionState = "granted" | "denied" | "undetermined";

export async function getPushPermissionState(): Promise<PushPermissionState> {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === "granted") return "granted";
  if (permission.status === "denied") return "denied";
  return "undetermined";
}

export async function openPushNotificationSettings() {
  await Linking.openSettings();
}

export type PushInstallationState = {
  installationId: string;
  active: boolean;
  permissionStatus: string | null;
};

export async function getCurrentPushInstallationState(): Promise<PushInstallationState> {
  const installationId = await getPushInstallationId();
  const headers = await authHeaders();
  const response = await fetch(`${API_BASE_URL}/push/status`, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? "PUSH_STATUS_FAILED");
  const installation = Array.isArray(data?.installations)
    ? data.installations.find((item: any) => item?.installation_id === installationId)
    : null;
  return {
    installationId,
    active: installation?.active === true,
    permissionStatus: installation?.permission_status ?? null,
  };
}

export async function registerPushInstallation(language: "no" | "en") {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") throw new Error("PUSH_PERMISSION_NOT_GRANTED");
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("EAS_PROJECT_ID_MISSING");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const installationId = await getPushInstallationId();
  const headers = await authHeaders();
  const response = await fetch(`${API_BASE_URL}/push/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      installationId,
      expoPushToken: token,
      platform: Platform.OS,
      language,
      permissionStatus: status,
      appVersion: Constants.expoConfig?.version ?? null,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? "PUSH_REGISTER_FAILED");
  return { token, installationId, installation: data.installation };
}

// T1.9F: tell the server which language this phone uses, so push texts follow the app language.
// Quiet and best effort: only for registered users on a phone that has turned on push.
export async function syncPushLanguage(language: "no" | "en") {
  try {
    const installationId = await AsyncStorage.getItem(INSTALLATION_KEY);
    if (!installationId) return;
    const headers = await authHeaders();
    await fetch(`${API_BASE_URL}/push/language`, {
      method: "POST",
      headers,
      body: JSON.stringify({ installationId, language }),
    });
  } catch {
    // Not signed in, offline or push never turned on: nothing to update.
  }
}

export function usePushLanguageSync(language: "no" | "en", userId: string | null | undefined, isGuest: boolean) {
  useEffect(() => {
    if (!userId || isGuest) return;
    void syncPushLanguage(language);
  }, [language, userId, isGuest]);
}

export async function unregisterPushInstallation() {
  const installationId = await getPushInstallationId();
  const headers = await authHeaders();
  const response = await fetch(`${API_BASE_URL}/push/unregister`, {
    method: "POST", headers, body: JSON.stringify({ installationId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? "PUSH_UNREGISTER_FAILED");
  return data;
}

export async function sendPushTest() {
  const headers = await authHeaders();
  const response = await fetch(`${API_BASE_URL}/push/test`, { method: "POST", headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? "PUSH_TEST_FAILED");
  return data;
}

function navigateFromData(router: ReturnType<typeof useRouter>, data: any) {
  const kind = String(data?.targetKind ?? "");
  const id = String(data?.targetId ?? "");
  if (kind === "chat" && id) return router.push(`/chat/${id}`);
  if (kind === "match" && id) return router.push(`/matches/${id}`);
  if (kind === "observation" && id) return router.push(`/observation/${id}`);
  if (kind === "report" && id) return router.push({ pathname: "/my-reports", params: { section: data?.section ?? "active", reportId: id } });
  if ((kind === "area_alert_campaign" || kind === "areaAlert") && id) return router.push(`/area-alert/${id}`);
  if (String(data?.type || "").toUpperCase() === "GEO_ALERT" || String(data?.type || "").toUpperCase() === "AREA_ALERT") {
    return router.push({ pathname: "/notifications", params: { tab: "nearby" } });
  }
  router.push("/notifications");
}

export function usePushNotificationNavigation() {
  const router = useRouter();
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      navigateFromData(router, response.notification.request.content.data);
    });
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) navigateFromData(router, response.notification.request.content.data);
    }).catch(() => {});
    return () => subscription.remove();
  }, [router]);
}
