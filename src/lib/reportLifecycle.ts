// src/lib/reportLifecycle.ts
// T1.9G: lifecycle rules and actions for one case (close, delete, extend, reactivate), shared by
// My cases and Saksdetaljer so both offer the same actions on the same conditions.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { activateTestReportOrder, createReportOrder } from "./reportCommerce";
import { REPORT_PRODUCT_CODES } from "./reportProducts";

const DAY_MS = 24 * 60 * 60 * 1000;
// A FOUND case can be extended when this many days or fewer remain (server rule in /extend-found).
export const FOUND_EXTENSION_WINDOW_DAYS = 7;
export const FOUND_MAX_EXTENSIONS = 2;
// Test price shown before a test-mode reactivation, in STORED_MONEY_CURRENCY. Store prices replace it.
export const REACTIVATION_TEST_PRICE = 99;

export type LifecycleReport = {
  id: string;
  type?: string | null;
  status?: string | null;
  visible_until?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  extension_count?: number | null;
};

export function isReportClosed(r: LifecycleReport): boolean {
  const status = String(r.status || "").toUpperCase();
  return status === "CLOSED" || status === "ARCHIVED" || !!r.closed_at || !!r.archived_at;
}

export function isReportExpired(r: LifecycleReport, now = Date.now()): boolean {
  if (String(r.status || "").toUpperCase() === "EXPIRED") return true;
  const until = Date.parse(r.visible_until || "");
  return Number.isFinite(until) && until <= now;
}

/** Whole days left before the case stops being active, or null without an end date. */
export function reportDaysLeft(r: LifecycleReport, now = Date.now()): number | null {
  const until = Date.parse(r.visible_until || "");
  if (!Number.isFinite(until)) return null;
  return Math.max(0, Math.ceil((until - now) / DAY_MS));
}

export function canExtendFound(r: LifecycleReport, now = Date.now()): boolean {
  if (String(r.type || "").toUpperCase() !== "FOUND" || isReportClosed(r)) return false;
  if (Number(r.extension_count || 0) >= FOUND_MAX_EXTENSIONS) return false;
  const until = Date.parse(r.visible_until || "");
  if (!Number.isFinite(until)) return true;
  return until - now <= FOUND_EXTENSION_WINDOW_DAYS * DAY_MS;
}

export function canReactivateLost(r: LifecycleReport, now = Date.now()): boolean {
  return String(r.type || "").toUpperCase() === "LOST" && isReportExpired(r, now) && !isReportClosed(r);
}

async function reportRequest(path: string, method: "POST" | "DELETE") {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  const response = await fetch(`${API_BASE_URL}/reports${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(body?.error || `HTTP_${response.status}`);
    throw Object.assign(new Error(code), { code, status: response.status, body });
  }
  return body;
}

export const closeReportRequest = (id: string) => reportRequest(`/${encodeURIComponent(id)}/close`, "POST");
export const deleteReportRequest = (id: string) => reportRequest(`/${encodeURIComponent(id)}`, "DELETE");
export const extendFoundRequest = (id: string) => reportRequest(`/${encodeURIComponent(id)}/extend-found`, "POST");

/** Test-mode reactivation of an expired LOST case for 30 days (real store payment comes later). */
export async function reactivateLostRequest(id: string) {
  const clientRequestId = `report-reactivation-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const created = await createReportOrder({
    reportId: id,
    productCode: REPORT_PRODUCT_CODES.REPORT_REACTIVATION,
    clientRequestId,
    platform: "TEST",
    provider: "TEST",
  });
  return activateTestReportOrder(created.order.id);
}
