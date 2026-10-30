// src/lib/userError.ts
// T1.9E: the only way an error becomes text for the user.
// Known error codes (server codes, Supabase Auth codes, app codes, network failures) map to
// translated text. Anything unknown gets the screen's own friendly fallback text and is sent to
// Sentry, so raw technical messages never reach the user.
import type { TranslationKey } from "../i18n/locales/en";
import { reportHandledError } from "./sentry";

type Translate = (key: TranslationKey) => string;

// Exact codes. Server codes are UPPER_SNAKE; Supabase Auth codes are lower_snake.
const EXACT: Record<string, TranslationKey> = {
  // Session and access
  UNAUTHORIZED: "errors.authBody",
  LOGIN_REQUIRED: "errors.authBody",
  MISSING_BEARER_TOKEN: "errors.authBody",
  INVALID_TOKEN: "errors.authBody",
  GUEST_NOT_ALLOWED: "errors.guestNotAllowed",
  ACCOUNT_REQUIRED_FOR_LOST: "errors.guestNotAllowed",
  NOT_ALLOWED: "errors.notAllowed",
  AREA_ALERT_ACCESS_DENIED: "errors.notAllowed",
  // Network
  NETWORK_ERROR: "errors.networkBody",
  NETWORK_TIMEOUT: "errors.timeout",
  TIMEOUT: "errors.timeout",
  // Rules
  REPORT_CLOSED: "errors.reportClosed",
  LOST_EXTENSION_LIMIT: "errors.lostExtensionLimit",
  LOST_EXTENSION_TOO_EARLY: "errors.lostExtensionTooEarly",
  LONG_TERM_ACTIVE: "errors.longTermActive",
  RESOLUTION_ALREADY_PENDING: "errors.resolutionAlreadyPending",
  OWNER_CANNOT_OBSERVE_OWN_REPORT: "errors.ownReport",
  WATCH_AREA_LIMIT_REACHED: "errors.watchAreaLimit",
  QUERY_TOO_SHORT: "errors.queryTooShort",
  IMAGE_UPLOAD_FAILED: "errors.imageUpload",
  // App validation (AuthContext)
  EMAIL_PASSWORD_REQUIRED: "errors.auth.emailPasswordRequired",
  PASSWORD_TOO_SHORT: "errors.auth.weakPassword",
  // Supabase Auth
  invalid_credentials: "errors.auth.invalidCredentials",
  email_not_confirmed: "errors.auth.emailNotConfirmed",
  user_already_exists: "errors.auth.userExists",
  email_exists: "errors.auth.userExists",
  weak_password: "errors.auth.weakPassword",
  email_address_invalid: "errors.auth.invalidEmail",
  validation_failed: "errors.invalidInput",
  over_email_send_rate_limit: "errors.rateLimited",
  over_request_rate_limit: "errors.rateLimited",
  over_sms_send_rate_limit: "errors.rateLimited",
  anonymous_provider_disabled: "errors.serviceBody",
};

// Patterns for messages from libraries and older server routes that send plain English text.
const PATTERNS: [RegExp, TranslationKey][] = [
  [/invalid login credentials/i, "errors.auth.invalidCredentials"],
  [/email not confirmed/i, "errors.auth.emailNotConfirmed"],
  [/user already registered/i, "errors.auth.userExists"],
  [/password should be/i, "errors.auth.weakPassword"],
  [/rate limit/i, "errors.rateLimited"],
  [/network request failed|failed to fetch|network ?error/i, "errors.networkBody"],
  [/timeout|timed out|aborterror/i, "errors.timeout"],
  [/^(missing bearer token|invalid token|unauthorized|jwt expired)$/i, "errors.authBody"],
  [/not allowed|access_denied|forbidden/i, "errors.notAllowed"],
  [/not[ _]found|not_available/i, "errors.notFound"],
  [/^(invalid_|missing_)|_required$| required$/i, "errors.invalidInput"],
];

function candidates(error: any): string[] {
  if (error == null) return [];
  if (typeof error === "string") return [error];
  const out: string[] = [];
  for (const v of [error.code, error.error, error.serverMessage, error.message, error.name]) {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

function statusOf(error: any): number {
  const s = Number(error?.status ?? error?.statusCode ?? 0);
  return Number.isFinite(s) ? s : 0;
}

// Returns the translation key for a known error, or null.
export function knownErrorKey(error: unknown): TranslationKey | null {
  const list = candidates(error);
  for (const c of list) {
    const exact = EXACT[c] ?? EXACT[c.toUpperCase().replace(/[\s-]+/g, "_")];
    if (exact) return exact;
  }
  for (const c of list) {
    for (const [re, key] of PATTERNS) if (re.test(c)) return key;
  }
  const status = statusOf(error);
  if (status === 401) return "errors.authBody";
  if (status === 403) return "errors.notAllowed";
  if (status === 404) return "errors.notFound";
  if (status === 429) return "errors.rateLimited";
  if (status >= 500) return "errors.serviceBody";
  return null;
}

// Text to show the user for an error. `fallbackKey` is the screen's own message for this action.
// `area` tags the Sentry report for unknown errors; pass null when the caller already reported it.
export function userErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: TranslationKey,
  area: string | null = "ui",
): string {
  const key = knownErrorKey(error);
  if (key) return t(key);
  const code = candidates(error)[0];
  if (area) reportHandledError(error, area, code && /^[A-Za-z_]+$/.test(code) ? code : undefined);
  return t(fallbackKey);
}

// Error with a stable English code, for throwing inside the app.
export function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
