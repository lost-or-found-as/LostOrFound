// src/lib/reportLifecycle.ts
// T1.9G: lifecycle rules and actions for one case (close, delete, extend, reactivate), shared by
// My cases and Saksdetaljer so both offer the same actions on the same conditions.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { activateTestReportOrder, createReportOrder, fetchReportProductCatalog } from "./reportCommerce";
import { REPORT_PRODUCT_CODES } from "./reportProducts";

const DAY_MS = 24 * 60 * 60 * 1000;
// A FOUND case can be extended when this many days or fewer remain (server rule in /extend-found).
export const FOUND_EXTENSION_WINDOW_DAYS = 7;
export const FOUND_MAX_EXTENSIONS = 2;
// T1.9H: a LOST case gets 30 days twice; after that it can become a historic case.
export const LOST_MAX_EXTENSIONS = 2;
// T1.9I: a LOST case can be extended from this many days before it ends (same rule on the server).
export const LOST_EXTENSION_WINDOW_DAYS = 3;
// A loss at least this old is offered as historic from the start (same rule on the server).
export const HISTORIC_FROM_START_DAYS = 365;
export const LONG_TERM_YEAR_OPTIONS = [1, 2, 3] as const;

export type LifecycleReport = {
  id: string;
  type?: string | null;
  status?: string | null;
  visible_until?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  extension_count?: number | null;
  occurred_at?: string | null;
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

export type LostExtensionFacts = { paidExtensions?: number | null; longTermUntil?: string | null };

function hasLiveLongTerm(facts: LostExtensionFacts, now: number): boolean {
  const end = Date.parse(facts.longTermUntil || "");
  return Number.isFinite(end) && end > now;
}

/** T1.9I: 30 more days for a LOST case, twice, from three days before the end or after it. */
export function canExtendLost(r: LifecycleReport, facts: LostExtensionFacts, now = Date.now()): boolean {
  if (String(r.type || "").toUpperCase() !== "LOST" || isReportClosed(r)) return false;
  if (hasLiveLongTerm(facts, now)) return false;
  if (Number(facts.paidExtensions || 0) >= LOST_MAX_EXTENSIONS) return false;
  return isInLostExtensionWindow(r, now);
}

/** The case has ended or ends within the extension window. */
export function isInLostExtensionWindow(r: LifecycleReport, now = Date.now()): boolean {
  if (isReportExpired(r, now)) return true;
  const until = Date.parse(r.visible_until || "");
  return Number.isFinite(until) && until - now <= LOST_EXTENSION_WINDOW_DAYS * DAY_MS;
}

/** A historic period can be bought (or renewed) for any LOST case that is not closed. */
export function canBuyLongTerm(r: LifecycleReport): boolean {
  return String(r.type || "").toUpperCase() === "LOST" && !isReportClosed(r);
}

export function isHistoricFromStart(r: LifecycleReport, now = Date.now()): boolean {
  const when = Date.parse(r.occurred_at || "");
  return Number.isFinite(when) && now - when >= HISTORIC_FROM_START_DAYS * DAY_MS;
}

/** Test-mode purchase of a historic period (real store payment comes later). */
export async function buyLongTermRequest(id: string, years: number) {
  const clientRequestId = `long-term-${id}-${years}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const created = await createReportOrder({
    reportId: id,
    productCode: "LONG_TERM_WATCH",
    longTerm: { years },
    clientRequestId,
    platform: "TEST",
    provider: "TEST",
  });
  return activateTestReportOrder(created.order.id);
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

/** Test-mode 30-day extension of a LOST case (real store payment comes later). */
export async function extendLostRequest(id: string) {
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

/**
 * T1.9M: the 30-day extension price from the product catalog, in kroner (null when unknown).
 * The server charges the catalog price, so the app shows the same number instead of a fixed one.
 */
export async function fetchReactivationPrice(): Promise<number | null> {
  try {
    const { products } = await fetchReportProductCatalog();
    const row = (products as { code?: string; base_price_ore?: number }[]).find(
      (p) => p.code === REPORT_PRODUCT_CODES.REPORT_REACTIVATION,
    );
    const ore = Number(row?.base_price_ore);
    return Number.isFinite(ore) && ore > 0 ? ore / 100 : null;
  } catch {
    return null;
  }
}
