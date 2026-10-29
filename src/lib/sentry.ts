import * as Sentry from "@sentry/react-native";

const SENSITIVE_KEYS = [
  "authorization",
  "access_token",
  "refresh_token",
  "token",
  "password",
  "email",
  "address",
  "location_label",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "description",
  "message",
  "body",
];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(source)) {
    const normalized = key.toLowerCase();
    result[key] = SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive))
      ? "[Filtered]"
      : redact(child);
  }

  return result;
}

let sentryEnabled = false;

export function isSentryEnabled() {
  return sentryEnabled;
}

export function initializeSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    // T1.9D: visible in device logs for every build, not only in development.
    console.warn("[Sentry] disabled: EXPO_PUBLIC_SENTRY_DSN is not configured for this build.");
    return;
  }
  sentryEnabled = true;

  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? "development" : "preview"),
    sendDefaultPii: false,
    enableLogs: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request = redact(event.request) as typeof event.request;
      }
      if (event.contexts) {
        event.contexts = redact(event.contexts) as typeof event.contexts;
      }
      if (event.extra) {
        event.extra = redact(event.extra) as typeof event.extra;
      }
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      return event;
    },
  });
}

// T1.9D: report an error that the app handled itself (shown as a message, so it did not crash).
// `area` names the feature in English (e.g. "report.create"); `code` is the technical error code.
// The error message is sent, but never the request body or user data.
export function reportHandledError(error: unknown, area: string, code?: string) {
  if (!sentryEnabled) return;
  const err = error instanceof Error ? error : new Error(String((error as any)?.message ?? error ?? "UNKNOWN"));
  Sentry.withScope((scope) => {
    scope.setTag("handled", "true");
    scope.setTag("area", area);
    if (code) scope.setTag("error.code", code);
    scope.setLevel("warning");
    Sentry.captureException(err);
  });
}

// T1.9D: a deliberate test event to prove that this build reaches Sentry.
export async function sendSentryTestEvent(): Promise<boolean> {
  if (!sentryEnabled) return false;
  Sentry.captureException(new Error(`SENTRY_TEST_EVENT ${new Date().toISOString()}`));
  try {
    return await Sentry.flush();
  } catch {
    return false;
  }
}

export { Sentry };
