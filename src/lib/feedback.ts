// T1.9V: feedback from the app (ideas, bugs, praise) and the admin list.
import { Platform } from "react-native";
import Constants from "expo-constants";
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError } from "./userError";
import type { TranslationKey } from "../i18n/locales/en";

export const FEEDBACK_KINDS = ["IDEA", "BUG", "PRAISE", "OTHER"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_KEYS: Record<FeedbackKind, TranslationKey> = {
  IDEA: "feedback.kind.idea",
  BUG: "feedback.kind.bug",
  PRAISE: "feedback.kind.praise",
  OTHER: "feedback.kind.other",
};
export const FEEDBACK_MAX_LENGTH = 2000;

export type FeedbackItem = {
  id: string;
  kind: FeedbackKind;
  message: string;
  status: "NEW" | "DONE";
  is_guest: boolean;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  app_version: string | null;
  language: string | null;
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw codedError("AUTH_REQUIRED");
  const r = await fetch(`${API_BASE_URL}/feedback${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(j?.error || `HTTP_${r.status}`)), { status: r.status });
  return j as T;
}

/** App version, platform and OS version that go with the feedback. */
export function feedbackContext(language: string) {
  const version = Constants.expoConfig?.version ?? null;
  return {
    appVersion: version,
    platform: Platform.OS,
    osVersion: String(Platform.Version ?? ""),
    language,
  };
}

export async function sendFeedback(input: { kind: FeedbackKind; message: string; language: string }) {
  return request<{ ok: true; id: string }>("", {
    method: "POST",
    body: JSON.stringify({ kind: input.kind, message: input.message.trim(), ...feedbackContext(input.language) }),
  });
}

export async function fetchAdminFeedback(status: "new" | "done") {
  return (await request<{ items: FeedbackItem[] }>(`/admin?status=${status}`)).items;
}

export async function markFeedbackDone(id: string) {
  return request<{ ok: true }>(`/admin/${encodeURIComponent(id)}/done`, { method: "POST" });
}
