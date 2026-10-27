// T1.8E.5I: area-alert status and error handling for the app.
// Pure helpers only (no React Native imports), so they can be tested in Node.

export type GeoAlertActivation = {
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
  radiusM: number | null;
};

export type GeoAlertStatus = {
  ok?: boolean;
  reportId?: string;
  activeUntil: string | null;
  activationCount: number;
  maxActivations: number;
  remaining: number;
  canOrder: boolean;
  activations: GeoAlertActivation[];
};

export type AreaAlertViewKind = "none" | "live" | "available" | "completed";

export type AreaAlertView = {
  kind: AreaAlertViewKind;
  latest: GeoAlertActivation | null;
  activationCount: number;
  maxActivations: number;
  remaining: number;
  totalDays: number;
  dayNumber: number;
  daysLeft: number;
  progress: number;
  activations: GeoAlertActivation[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveAreaAlertView(status: GeoAlertStatus | null, now: Date = new Date()): AreaAlertView {
  const activations = Array.isArray(status?.activations) ? status!.activations : [];
  const activationCount = Number(status?.activationCount || 0);
  const maxActivations = Number(status?.maxActivations || 2);
  const remaining = Math.max(0, Number(status?.remaining ?? maxActivations - activationCount));
  const latest = activations.length ? activations[activations.length - 1] : null;
  const liveActivation = activations.find((a) => a.live) || null;

  let kind: AreaAlertViewKind = "none";
  if (status?.activeUntil || liveActivation) kind = "live";
  else if (activationCount > 0 && remaining > 0) kind = "available";
  else if (activationCount > 0) kind = "completed";

  const current = liveActivation || latest;
  let totalDays = 0;
  let dayNumber = 0;
  let daysLeft = 0;
  let progress = 0;
  if (kind === "live" && current?.startsAt && (current.endsAt || status?.activeUntil)) {
    const start = new Date(current.startsAt).getTime();
    const end = new Date(String(current.endsAt || status?.activeUntil)).getTime();
    const nowMs = now.getTime();
    totalDays = Math.max(1, Math.round((end - start) / DAY_MS));
    daysLeft = Math.max(0, Math.ceil((end - nowMs) / DAY_MS));
    dayNumber = Math.min(totalDays, Math.max(1, Math.floor((nowMs - start) / DAY_MS) + 1));
    progress = Math.min(1, Math.max(0, (nowMs - start) / Math.max(1, end - start)));
  }

  return {
    kind,
    latest: current,
    activationCount,
    maxActivations,
    remaining,
    totalDays,
    dayNumber,
    daysLeft,
    progress,
    activations,
  };
}

export type AreaAlertErrorKind =
  | "alreadyActive"
  | "limitReached"
  | "network"
  | "service"
  | "auth"
  | "notAvailable"
  | "locationRequired"
  | "unknown";

export type AreaAlertErrorInfo = {
  kind: AreaAlertErrorKind;
  code: string;
  retryable: boolean;
};

export function classifyAreaAlertError(error: unknown): AreaAlertErrorInfo {
  const anyError = error as any;
  const code = String(anyError?.code || anyError?.message || anyError || "").trim();
  const status = Number(anyError?.status || 0);
  const upper = code.toUpperCase();

  if (upper.includes("GEO_ALERT_ALREADY_ACTIVE")) return { kind: "alreadyActive", code, retryable: false };
  if (upper.includes("GEO_ALERT_LIMIT_REACHED")) return { kind: "limitReached", code, retryable: false };
  if (upper === "AUTH_REQUIRED" || status === 401 || upper.includes("INVALID TOKEN") || upper.includes("MISSING BEARER"))
    return { kind: "auth", code, retryable: false };
  if (upper.includes("GEO_ALERT_REPORT_LOCATION_REQUIRED") || upper.includes("LOST_REPORT_WITH_LOCATION_NOT_FOUND"))
    return { kind: "locationRequired", code, retryable: false };
  if (
    [
      "PRODUCT_NOT_AVAILABLE",
      "TEST_ACTIVATION_NOT_ALLOWED",
      "GEO_ALERT_TEST_NOT_ALLOWED",
      "REPORT_NOT_FOUND",
      "PAID_PRODUCTS_REQUIRE_LOST_REPORT",
    ].some((c) => upper.includes(c))
  )
    return { kind: "notAvailable", code, retryable: false };
  if (
    anyError?.name === "TypeError" ||
    upper.includes("NETWORK REQUEST FAILED") ||
    upper.includes("NETWORK_REQUEST_FAILED") ||
    upper.includes("FAILED TO FETCH") ||
    upper.includes("TIMEOUT") ||
    upper.includes("ABORT")
  )
    return { kind: "network", code, retryable: true };
  if (status >= 500 || /^HTTP_5\d\d/.test(upper) || upper.includes("INVALID_RESPONSE") || upper === "SERVER ERROR")
    return { kind: "service", code, retryable: true };
  return { kind: "unknown", code, retryable: true };
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Local date and time parts: no "27.10" / "13:40", en "27 Oct" / "13:40". */
export function areaAlertDateParts(iso: string | null | undefined, language: "no" | "en") {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const date = language === "en" ? `${d.getDate()} ${MONTHS_EN[d.getMonth()]}` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return { date, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Radius label: 500 m, 1,5 km (no) / 1.5 km (en), 3 km. */
export function areaAlertRadiusLabel(radiusM: number | null | undefined, language: "no" | "en") {
  const r = Number(radiusM || 0);
  if (!r) return "";
  if (r < 1000) return `${r} m`;
  const km = r / 1000;
  const text = Number.isInteger(km) ? String(km) : km.toFixed(1);
  return `${language === "no" ? text.replace(".", ",") : text} km`;
}
