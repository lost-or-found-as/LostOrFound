// src/lib/supabase.ts
import { AppState, Platform } from "react-native";
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabaseKey = supabaseAnonKey || supabasePublishableKey;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "[supabase] Missing EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

// T1.9BY: a sign-in request that never answers (a stalled network, a blocked host) held the
// auth lock, so every later sign-in, password reset and Apple sign-in waited for ever. Auth
// requests now give up after AUTH_REQUEST_TIMEOUT_MS; the lock is released and the user sees a
// timeout or network message. Storage uploads and database calls keep the normal fetch.
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export function fetchWithAuthTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (!String(url).includes("/auth/v1/")) return fetch(input as any, init);
  const controller = new AbortController();
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true } as any);
  }
  const timer = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  return fetch(input as any, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fetchWithAuthTimeout },
  auth: {
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

const GLOBAL_APPSTATE_LISTENER_KEY = "__lostOrFoundSupabaseAppStateListenerRegistered";

type GlobalWithSupabaseListener = typeof globalThis & {
  [GLOBAL_APPSTATE_LISTENER_KEY]?: boolean;
};

const globalState = globalThis as GlobalWithSupabaseListener;

if (Platform.OS !== "web" && !globalState[GLOBAL_APPSTATE_LISTENER_KEY]) {
  globalState[GLOBAL_APPSTATE_LISTENER_KEY] = true;

  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });

  if (AppState.currentState === "active") {
    void supabase.auth.startAutoRefresh();
  }
}
