import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import type { GeoAlertQuoteInput, ReportProductCode } from "./reportProducts";
import type { GeoAlertStatus } from "./areaAlertStatus";

async function token() {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("AUTH_REQUIRED");
  return value;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await token();
  const response = await fetch(`${API_BASE_URL}/report-commerce${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // T1.8E.5I: keep the message (callers read it) and add the code, status and body.
    const error = new Error(data?.error || `HTTP_${response.status}`) as Error & {
      code?: string;
      status?: number;
      body?: unknown;
    };
    error.code = String(data?.error || `HTTP_${response.status}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data as T;
}
export function fetchReportProductCatalog() {
  return request<{ products: unknown[] }>("/catalog");
}
export function quoteGeoAlert(reportId: string, input: GeoAlertQuoteInput) {
  return request<{ quote: unknown }>("/geo-alert/quote", { method: "POST", body: JSON.stringify({ reportId, ...input }) });
}
export function createReportOrder(input: {
  reportId: string;
  // T1.9H: "LONG_TERM_WATCH" with longTerm.years; the server picks the product variant.
  productCode: ReportProductCode | "GEO_ALERT" | "LONG_TERM_WATCH";
  clientRequestId: string;
  platform: "IOS" | "ANDROID" | "WEB" | "TEST";
  provider: "APPLE" | "GOOGLE" | "REVENUECAT" | "STRIPE" | "TEST";
  occurredPrecision?: "EXACT" | "MONTH" | "YEAR" | "UNKNOWN";
  occurredYear?: number | null;
  occurredMonth?: number | null;
  geoAlert?: Record<string, unknown>;
  longTerm?: { years: number };
}) {
  return request<{ order: any; idempotentReplay: boolean }>("/orders", { method: "POST", body: JSON.stringify(input) });
}
// T1.9H: price for keeping a LOST case as a historic case.
export type LongTermQuote = {
  reportId: string;
  renew: boolean;
  years: number;
  productCode: string;
  creditedExtensions: number;
  baseAmountOre: number;
  creditOre: number;
  amountOre: number;
  currency: string;
  startsAt: string;
  endsAt: string;
};
export function quoteLongTermWatch(reportId: string, years: number) {
  return request<{ quote: LongTermQuote }>("/long-term/quote", { method: "POST", body: JSON.stringify({ reportId, years }) });
}
export function fetchGeoAlertStatus(reportId: string) {
  return request<GeoAlertStatus>(`/reports/${encodeURIComponent(reportId)}/geo-alert-status`);
}
export function fetchReportOrder(orderId: string) {
  return request<{ order: any }>(`/orders/${encodeURIComponent(orderId)}`);
}
export type TestOrderActivationResult = {
  order: any;
  entitlement: any;
  campaignId?: string | null;
  areaAlertDispatch?: {
    ok?: boolean;
    eligible?: number;
    sent?: number;
    skippedAsDuplicate?: number;
    error?: string;
    tickets?: unknown[];
  } | null;
  testActivation: true;
};

function activeEntitlementFromOrder(order: any) {
  const rows = Array.isArray(order?.report_entitlements)
    ? order.report_entitlements
    : [];
  return rows.find((item: any) => String(item?.status || "").toUpperCase() === "ACTIVE") || rows[0] || null;
}

async function reconcileSuccessfulAreaAlertActivation(orderId: string, originalError: unknown) {
  try {
    const current = await fetchReportOrder(orderId);
    const order = current?.order;
    const status = String(order?.status || "").toUpperCase();
    const entitlement = activeEntitlementFromOrder(order);
    if (status === "ACTIVE" && entitlement?.current_period_end) {
      return {
        order,
        entitlement,
        campaignId: null,
        areaAlertDispatch: null,
        testActivation: true as const,
        reconciledAfterError: true,
      };
    }
  } catch {
    // Preserve the original activation error if reconciliation is unavailable.
  }
  throw originalError;
}

export async function activateTestReportOrder(orderId: string) {
  try {
    const result = await request<TestOrderActivationResult>(
      `/orders/${encodeURIComponent(orderId)}/test-activate`,
      { method: "POST" },
    );
    if (
      String(result?.order?.status || "").toUpperCase() === "ACTIVE" &&
      result?.entitlement?.current_period_end
    ) {
      return result;
    }
    return reconcileSuccessfulAreaAlertActivation(
      orderId,
      new Error("AREA_ALERT_ACTIVATION_RESPONSE_INCOMPLETE"),
    );
  } catch (error) {
    return reconcileSuccessfulAreaAlertActivation(orderId, error);
  }
}

// T1.9X: the account's orders, pilot-free ones included (Mine kjøp).
export type MyPurchase = {
  id: string;
  reportId: string | null;
  productCode: string;
  status: string;
  amountOre: number | null;
  currency: string | null;
  provider: string | null;
  purchasedAt: string | null;
  startsAt: string | null;
  currentPeriodEnd: string | null;
  autoRenews: boolean;
  report: {
    id: string;
    title?: string | null;
    type?: string | null;
    category?: string | null;
    subcategory_key?: string | null;
    subcategory_custom?: string | null;
    color?: string | null;
    brand?: string | null;
    deleted_at?: string | null;
  } | null;
};
export function fetchMyPurchases() {
  return request<{ activePurchases: MyPurchase[]; purchaseHistory: MyPurchase[] }>("/my-purchases");
}
