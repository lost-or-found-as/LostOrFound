// src/lib/contentAdmin.ts
// T1.9BB: admin lists for reported cases and bonus checks (server: /safety/admin/content and
// /safety/admin/bonus-flags). Only admins get answers; others get NOT_ADMIN.
import { safetyRequest } from "./chatSafety";

export type ContentReason = "PERSON" | "HARASSMENT" | "PERSONAL_INFO" | "SPAM" | "OTHER";
export type ReportedCase = {
  reportId: string;
  report: {
    id: string;
    type: string;
    title?: string | null;
    category?: string | null;
    subcategory_key?: string | null;
    subcategory_custom?: string | null;
    color?: string | null;
    description?: string | null;
    location_label?: string | null;
    hidden_at?: string | null;
    hidden_reason?: string | null;
  } | null;
  reports: { reason: ContentReason; source: "APP" | "SHARE_PAGE"; comment: string | null; at: string }[];
};
export type BonusFlagReason = "RECIPROCAL" | "CLUSTER" | "MANY_RETURNS";
export type BonusFlag = {
  userId: string;
  reasons: BonusFlagReason[];
  points: number;
  partners: number;
  rows: { id: string; event: string; points: number; status: string; at: string; counterpart: string }[];
};

export async function fetchReportedCases(): Promise<ReportedCase[]> {
  return (await safetyRequest<{ items: ReportedCase[] }>("/admin/content")).items || [];
}
export function restoreCase(reportId: string) {
  return safetyRequest(`/admin/content/${encodeURIComponent(reportId)}/restore`, { method: "POST" });
}
export function hideCase(reportId: string) {
  return safetyRequest(`/admin/content/${encodeURIComponent(reportId)}/hide`, { method: "POST" });
}
export function closeCaseReports(reportId: string) {
  return safetyRequest(`/admin/content/${encodeURIComponent(reportId)}/close`, { method: "POST" });
}
export async function fetchBonusFlags(): Promise<BonusFlag[]> {
  return (await safetyRequest<{ flags: BonusFlag[] }>("/admin/bonus-flags")).flags || [];
}
export function revokeBonusRow(ledgerId: string) {
  return safetyRequest(`/admin/bonus/${encodeURIComponent(ledgerId)}/revoke`, { method: "POST" });
}

/** A short, stable label for an account without showing the id in full. */
export function shortId(id: string): string {
  return `…${String(id || "").replace(/-/g, "").slice(-4)}`;
}
