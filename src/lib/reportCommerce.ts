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
  productCode: ReportProductCode | "GEO_ALERT";
  clientRequestId: string;
  platform: "IOS" | "ANDROID" | "WEB" | "TEST";
  provider: "APPLE" | "GOOGLE" | "REVENUECAT" | "STRIPE" | "TEST";
  occurredPrecision?: "EXACT" | "MONTH" | "YEAR" | "UNKNOWN";
  occurredYear?: number | null;
  occurredMonth?: number | null;
  geoAlert?: Record<string, unknown>;
}) {
  return request<{ order: any; idempotentReplay: boolean }>("/orders", { method: "POST", body: JSON.stringify(input) });
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
