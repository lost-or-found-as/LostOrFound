// src/lib/liveActivity.tsx
// T1.9BT: follow a lost case on the lock screen and in the Dynamic Island (iOS 16.2+).
// The server makes every text in the user's language and keeps the activity current with APNs
// pushes; the app only starts and stops it. Everything is guarded: on Android, older iPhones,
// with Live Activities turned off in Settings, or with the server switch off, nothing happens.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLiveActivity, type LiveActivity, type LiveActivityFactory } from "expo-widgets";
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, monospacedDigit, padding } from "@expo/ui/swift-ui/modifiers";
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError } from "./userError";
import type { Lang } from "../i18n/translate";

/** What the lock screen shows; every text comes ready from the server (server/lib/liveActivities.js). */
export type CaseActivityProps = {
  kicker: string;
  title: string;
  detail: string;
  badge: string;
  sinceLabel: string;
  sinceMs: number;
  ended: boolean;
  url: string;
};

// Runs inside the widget runtime: only Expo UI components and modifiers, no app state or imports
// of our own. The babel plugin turns this function into a string for the widget extension.
const CaseActivity = (props: CaseActivityProps) => {
  "widget";
  const since = new Date(props.sinceMs);
  const muted = "#6B7280";
  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 16 })]}>
        <VStack alignment="leading" spacing={3}>
          <Text modifiers={[font({ size: 12, weight: "heavy" }), foregroundStyle("#B91C1C")]}>{props.kicker.toUpperCase()}</Text>
          <Text modifiers={[font({ size: 19, weight: "bold" }), lineLimit(1)]}>{props.title}</Text>
          <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(muted), lineLimit(1)]}>{props.detail}</Text>
        </VStack>
        <Spacer />
        {props.ended ? null : (
          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(muted)]}>{props.sinceLabel}</Text>
            <Text date={since} dateStyle="relative" modifiers={[font({ size: 15, weight: "bold" }), monospacedDigit()]} />
          </VStack>
        )}
      </HStack>
    ),
    compactLeading: <Image systemName="magnifyingglass" color="#F87171" />,
    compactTrailing: <Text modifiers={[font({ size: 14, weight: "bold" }), monospacedDigit()]}>{props.badge}</Text>,
    minimal: <Image systemName="magnifyingglass" color="#F87171" />,
    expandedLeading: (
      <Text modifiers={[font({ size: 12, weight: "heavy" }), foregroundStyle("#F87171")]}>{props.kicker.toUpperCase()}</Text>
    ),
    expandedTrailing: props.ended ? null : <Text date={since} dateStyle="relative" modifiers={[font({ size: 13, weight: "semibold" }), monospacedDigit()]} />,
    expandedCenter: <Text modifiers={[font({ size: 17, weight: "bold" }), lineLimit(1)]}>{props.title}</Text>,
    expandedBottom: <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(muted), lineLimit(1)]}>{props.detail}</Text>,
  };
};

const ACTIVITY_NAME = "CaseActivity";
const STORAGE_KEY = "lof.liveActivities.v1"; // { [reportId]: activityId }

let factory: LiveActivityFactory<CaseActivityProps> | null | undefined;
function getFactory(): LiveActivityFactory<CaseActivityProps> | null {
  if (Platform.OS !== "ios") return null;
  if (factory !== undefined) return factory;
  try {
    factory = createLiveActivity<CaseActivityProps>(ACTIVITY_NAME, CaseActivity);
  } catch (e) {
    console.warn("[live] not available", e);
    factory = null;
  }
  return factory;
}

async function authHeaders() {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw codedError("AUTH_REQUIRED");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE_URL}/live-activities${path}`, { ...init, headers: { ...(await authHeaders()), ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw codedError(String(j?.error || `HTTP_${r.status}`));
  return j as T;
}

let config: { enabled: boolean; at: number } | null = null;
/** True when this phone can show Live Activities and the server switch is on. */
export async function liveActivitiesAvailable(): Promise<boolean> {
  if (!getFactory()) return false;
  if (config && Date.now() - config.at < 5 * 60 * 1000) return config.enabled;
  try {
    const r = await call<{ enabled: boolean }>("/config");
    config = { enabled: !!r.enabled, at: Date.now() };
  } catch {
    config = { enabled: false, at: Date.now() };
  }
  return config.enabled;
}

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(map: Record<string, string>) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // A lost map only means the button may show «start» for a running activity.
  }
}

function running(): LiveActivity<CaseActivityProps>[] {
  try {
    return getFactory()?.getInstances() ?? [];
  } catch {
    return [];
  }
}

/** The running activity for this case, if any. */
export async function findCaseActivity(reportId: string): Promise<LiveActivity<CaseActivityProps> | null> {
  const map = await readMap();
  const id = map[reportId];
  if (!id) return null;
  const hit = running().find((a) => a.getId() === id) ?? null;
  if (!hit) {
    delete map[reportId];
    await writeMap(map);
  }
  return hit;
}

async function register(reportId: string, activity: LiveActivity<CaseActivityProps>, language: Lang, pushToken: string | null) {
  await call("/register", {
    method: "POST",
    body: JSON.stringify({ reportId, activityId: activity.getId(), pushToken, language }),
  });
}

function watchToken(reportId: string, activity: LiveActivity<CaseActivityProps>, language: Lang) {
  try {
    // iOS may hand out a new token at any time; the server must always have the latest.
    activity.addPushTokenListener((e) => {
      void register(reportId, activity, language, e.pushToken).catch((err) => console.warn("[live] token update failed", err));
    });
  } catch (e) {
    console.warn("[live] token listener failed", e);
  }
}

/** Starts following the case on the lock screen. Throws a coded error the screen can show. */
export async function startCaseActivity(reportId: string, language: Lang): Promise<void> {
  const f = getFactory();
  if (!f) throw codedError("LIVE_NOT_SUPPORTED");
  const existing = await findCaseActivity(reportId);
  if (existing) return;
  const { props } = await call<{ props: CaseActivityProps }>(`/case/${encodeURIComponent(reportId)}?lang=${language}`);
  let activity: LiveActivity<CaseActivityProps>;
  try {
    activity = f.start(props, props.url);
  } catch (e) {
    // Turned off in Settings → Lost or Found → Live Activities, or too many running.
    console.warn("[live] start failed", e);
    throw codedError("LIVE_START_FAILED");
  }
  const map = await readMap();
  map[reportId] = activity.getId();
  await writeMap(map);
  watchToken(reportId, activity, language);
  const token = await activity.getPushToken().catch(() => null);
  await register(reportId, activity, language, token);
}

/** Stops following the case. */
export async function stopCaseActivity(reportId: string): Promise<void> {
  const activity = await findCaseActivity(reportId);
  const map = await readMap();
  delete map[reportId];
  await writeMap(map);
  if (!activity) return;
  const id = activity.getId();
  try {
    await activity.end("immediate");
  } catch (e) {
    console.warn("[live] end failed", e);
  }
  await call("/end", { method: "POST", body: JSON.stringify({ activityId: id }) }).catch(() => undefined);
}

/** After a restart: listen for new tokens again and forget activities iOS has removed. */
export async function resumeCaseActivities(language: Lang): Promise<void> {
  if (!(await liveActivitiesAvailable())) return;
  const map = await readMap();
  const alive = running();
  let changed = false;
  for (const [reportId, activityId] of Object.entries(map)) {
    const activity = alive.find((a) => a.getId() === activityId);
    if (!activity) {
      delete map[reportId];
      changed = true;
      continue;
    }
    watchToken(reportId, activity, language);
    const token = await activity.getPushToken().catch(() => null);
    await register(reportId, activity, language, token).catch(() => undefined);
  }
  if (changed) await writeMap(map);
}
