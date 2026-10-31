// T1.9M: report and block in chat (match chat and observation chat), and the admin report list.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError } from "./userError";
import type { TranslationKey } from "../i18n/locales/en";

export type ChatKind = "match" | "observation";
export type ChatSafetyState = { blockedByMe: boolean; selfSuspended: boolean; closed: boolean };
export const OPEN_CHAT: ChatSafetyState = { blockedByMe: false, selfSuspended: false, closed: false };

export const REPORT_REASONS = ["SCAM", "PERSONAL_DATA", "HARASSMENT", "SPAM", "OTHER"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_KEYS: Record<ReportReason, TranslationKey> = {
  SCAM: "safety.reason.scam",
  PERSONAL_DATA: "safety.reason.personalData",
  HARASSMENT: "safety.reason.harassment",
  SPAM: "safety.reason.spam",
  OTHER: "safety.reason.other",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw codedError("AUTH_REQUIRED");
  const r = await fetch(`${API_BASE_URL}/safety${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(j?.error || `HTTP_${r.status}`)), { status: r.status });
  return j as T;
}

const chatPath = (kind: ChatKind, id: string) => `${kind}/${encodeURIComponent(id)}`;

export async function fetchChatState(kind: ChatKind, id: string) {
  return (await request<{ state: ChatSafetyState }>(`/state/${chatPath(kind, id)}`)).state;
}
export async function blockChatPartner(kind: ChatKind, id: string) {
  return (await request<{ state: ChatSafetyState }>(`/block/${chatPath(kind, id)}`, { method: "POST" })).state;
}
export async function unblockChatPartner(kind: ChatKind, id: string) {
  return (await request<{ state: ChatSafetyState }>(`/block/${chatPath(kind, id)}`, { method: "DELETE" })).state;
}
export async function reportChat(kind: ChatKind, id: string, input: { reason: ReportReason; details: string; block: boolean }) {
  return (await request<{ state: ChatSafetyState }>(`/report/${chatPath(kind, id)}`, { method: "POST", body: JSON.stringify(input) })).state;
}

// ---- Admin ----

export type AdminReport = {
  id: string;
  context_type: "MATCH" | "OBSERVATION";
  reported_user_id: string;
  reason: ReportReason;
  details: string | null;
  message_snapshot: { from: "REPORTER" | "REPORTED"; body: string; at: string | null }[];
  status: "OPEN" | "NO_ACTION" | "ACTION_TAKEN";
  created_at: string;
  reporterRole: "OWNER" | "FINDER" | "OBSERVER" | null;
  item: Record<string, any> | null;
  reportedTotals: { reports: number; blockedBy: number; suspended: boolean };
};

export async function fetchIsAdmin() {
  try {
    return !!(await request<{ isAdmin: boolean }>("/admin/me")).isAdmin;
  } catch {
    return false;
  }
}
export async function fetchAdminReports(status: "open" | "handled") {
  return (await request<{ reports: AdminReport[] }>(`/admin/reports?status=${status}`)).reports;
}
export function resolveAdminReport(id: string, action: "NO_ACTION" | "SUSPEND") {
  return request(`/admin/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ action }) });
}
export function restoreAccount(userId: string) {
  return request(`/admin/users/${encodeURIComponent(userId)}/restore`, { method: "POST" });
}

/** Last message by the reported person, shown as a quote in the admin list. */
export function reportedQuote(report: Pick<AdminReport, "message_snapshot">): string | null {
  const list = report.message_snapshot || [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].from === "REPORTED" && list[i].body) return list[i].body;
  return null;
}
