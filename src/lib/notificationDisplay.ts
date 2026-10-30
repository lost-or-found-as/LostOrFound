// src/lib/notificationDisplay.ts
// T1.9G: how a notification looks in Varsler (icon and colour per type) and the I dag /
// Tidligere grouping. Pure, so the rules are tested without the app.

export type NotificationTone = "match" | "success" | "info" | "warning" | "neutral";
export type NotificationIcon =
  | "search-outline"
  | "checkmark"
  | "chatbubble-outline"
  | "flag-outline"
  | "time-outline"
  | "megaphone-outline"
  | "eye-outline"
  | "notifications-outline";

export function notificationIcon(type: string | null | undefined): { icon: NotificationIcon; tone: NotificationTone } {
  switch (String(type || "").toUpperCase()) {
    case "NEW_MATCH":
      return { icon: "search-outline", tone: "match" };
    case "MATCH_CONFIRMED":
      return { icon: "checkmark", tone: "success" };
    case "NEW_MESSAGE":
    case "OBSERVATION_MESSAGE":
      return { icon: "chatbubble-outline", tone: "info" };
    case "RESOLUTION_PROPOSED":
    case "RESOLUTION_CONFIRMED":
    case "RESOLUTION_REJECTED":
      return { icon: "flag-outline", tone: "success" };
    case "REPORT_EXPIRING":
    case "REPORT_EXPIRED":
    case "REPORT_ARCHIVED":
      return { icon: "time-outline", tone: "warning" };
    case "AREA_ALERT":
    case "GEO_ALERT":
      return { icon: "megaphone-outline", tone: "info" };
    case "AREA_ALERT_OBSERVATION":
    case "OBSERVATION_STATUS":
      return { icon: "eye-outline", tone: "info" };
    default:
      return { icon: "notifications-outline", tone: "neutral" };
  }
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Splits newest-first items into today (local time) and earlier, keeping their order. */
export function groupByDay<T extends { created_at: string }>(items: T[], now = Date.now()): { today: T[]; earlier: T[] } {
  const todayKey = localDayKey(now);
  const today: T[] = [];
  const earlier: T[] = [];
  for (const item of items) {
    const ms = Date.parse(item.created_at || "");
    if (Number.isFinite(ms) && localDayKey(ms) === todayKey) today.push(item);
    else earlier.push(item);
  }
  return { today, earlier };
}
