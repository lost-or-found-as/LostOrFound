// src/lib/reportActivity.ts
// T1.9G: activity for one case (GET /reports/:id/activity) and the "Neste steg" decision for
// Saksdetaljer. nextStep() and activityText() are pure so the rules can be tested without the app.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import {
  canExtendFound,
  canReactivateLost,
  isReportClosed,
  isReportExpired,
  reportDaysLeft,
  type LifecycleReport,
} from "./reportLifecycle";
import type { TranslationKey } from "../i18n/locales/en";

export type ActivitySummary = {
  possibleMatches: number;
  strongMatches: number;
  bestScore: number | null;
  confirmedMatches: number;
  unreadMessages: number;
  chatMatchId: string | null;
  newObservations: number;
};

export type ActivityEvent =
  | { type: "CREATED"; at: string }
  | { type: "MATCHES_FOUND"; at: string; count: number; strong: number }
  | { type: "MATCH_CONFIRMED"; at: string; matchId: string }
  | { type: "MESSAGE"; at: string; matchId: string; fromMe: boolean; unread: number }
  | { type: "OBSERVATION"; at: string; observationId: string; kind: "SEEN" | "FOUND"; isNew: boolean }
  | { type: "AREA_ALERT_SENT"; at: string; radiusM: number | null }
  | { type: "REACTIVATED"; at: string }
  | { type: "EXTENDED"; at: string }
  | { type: "CLOSED"; at: string };

export type ReportActivity = { summary: ActivitySummary; events: ActivityEvent[] };

export const EMPTY_ACTIVITY: ReportActivity = {
  summary: {
    possibleMatches: 0,
    strongMatches: 0,
    bestScore: null,
    confirmedMatches: 0,
    unreadMessages: 0,
    chatMatchId: null,
    newObservations: 0,
  },
  events: [],
};

export async function fetchReportActivity(reportId: string): Promise<ReportActivity> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  const response = await fetch(`${API_BASE_URL}/reports/${encodeURIComponent(reportId)}/activity`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(body?.error || `HTTP_${response.status}`);
    throw Object.assign(new Error(code), { code, status: response.status });
  }
  return { summary: { ...EMPTY_ACTIVITY.summary, ...(body?.summary || {}) }, events: Array.isArray(body?.events) ? body.events : [] };
}

export type NextStepAction = "openChat" | "openMatches" | "reactivateLost" | "extendFound" | null;
export type NextStepTone = "dark" | "plain";

export type NextStep = {
  kind: "closed" | "unreadChat" | "chat" | "matches" | "expired" | "expiring" | "searching";
  tone: NextStepTone;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  params: Record<string, number>;
  action: NextStepAction;
  actionKey: TranslationKey | null;
};

/** What the owner should do next with the case, most important first. */
export function nextStep(report: LifecycleReport, summary: ActivitySummary, now = Date.now()): NextStep {
  const lost = String(report.type || "").toUpperCase() === "LOST";
  const step = (
    kind: NextStep["kind"],
    tone: NextStepTone,
    titleKey: TranslationKey,
    bodyKey: TranslationKey,
    action: NextStepAction = null,
    actionKey: TranslationKey | null = null,
    params: Record<string, number> = {},
  ): NextStep => ({ kind, tone, titleKey, bodyKey, action, actionKey, params });

  if (isReportClosed(report)) return step("closed", "plain", "caseDetail.next.closedTitle", "caseDetail.next.closedBody");

  if (summary.confirmedMatches > 0 && summary.chatMatchId && summary.unreadMessages > 0)
    return step("unreadChat", "dark", "caseDetail.next.unreadTitle", "caseDetail.next.unreadBody", "openChat", "caseDetail.next.openChat", {
      count: summary.unreadMessages,
    });

  if (summary.confirmedMatches > 0 && summary.chatMatchId)
    return step(
      "chat",
      "dark",
      "caseDetail.next.chatTitle",
      lost ? "caseDetail.next.chatBodyLost" : "caseDetail.next.chatBodyFound",
      "openChat",
      "caseDetail.next.openChat",
    );

  if (summary.possibleMatches > 0)
    return step(
      "matches",
      "dark",
      "caseDetail.next.matchesTitle",
      lost
        ? summary.strongMatches > 0
          ? "caseDetail.next.matchesBodyLostStrong"
          : "caseDetail.next.matchesBodyLost"
        : "caseDetail.next.matchesBodyFound",
      "openMatches",
      "caseDetail.next.openMatches",
      { count: summary.possibleMatches },
    );

  if (isReportExpired(report, now)) {
    if (canReactivateLost(report, now))
      return step("expired", "plain", "caseDetail.next.expiredTitle", "caseDetail.next.expiredBodyLost", "reactivateLost", "caseDetail.next.reactivate");
    if (canExtendFound(report, now))
      return step("expired", "plain", "caseDetail.next.expiredTitle", "caseDetail.next.expiredBodyFound", "extendFound", "caseDetail.next.extendFound");
    return step("expired", "plain", "caseDetail.next.expiredTitle", "caseDetail.next.expiredBodyFinal");
  }

  if (canExtendFound(report, now))
    return step("expiring", "plain", "caseDetail.next.expiringTitle", "caseDetail.next.expiringBodyFound", "extendFound", "caseDetail.next.extendFound", {
      count: reportDaysLeft(report, now) ?? 0,
    });

  return step(
    "searching",
    "plain",
    lost ? "caseDetail.next.searchingTitleLost" : "caseDetail.next.searchingTitleFound",
    lost ? "caseDetail.next.searchingBodyLost" : "caseDetail.next.searchingBodyFound",
  );
}

export type ActivityTone = "new" | "plain";

/** Text key, parameters and dot colour for one timeline row. */
export function activityText(event: ActivityEvent, reportType: string | null | undefined): {
  key: TranslationKey;
  params: Record<string, number>;
  tone: ActivityTone;
} {
  const lost = String(reportType || "").toUpperCase() === "LOST";
  switch (event.type) {
    case "CREATED":
      return { key: "caseDetail.activity.created", params: {}, tone: "plain" };
    case "MATCHES_FOUND":
      return { key: "caseDetail.activity.matches", params: { count: event.count }, tone: "plain" };
    case "MATCH_CONFIRMED":
      return { key: lost ? "caseDetail.activity.confirmedLost" : "caseDetail.activity.confirmedFound", params: {}, tone: "plain" };
    case "MESSAGE":
      if (event.fromMe) return { key: "caseDetail.activity.messageSent", params: {}, tone: "plain" };
      return {
        key: lost ? "caseDetail.activity.messageFromFinder" : "caseDetail.activity.messageFromOwner",
        params: {},
        tone: event.unread > 0 ? "new" : "plain",
      };
    case "OBSERVATION":
      return {
        key: event.kind === "FOUND" ? "caseDetail.activity.observationFound" : "caseDetail.activity.observationSeen",
        params: {},
        tone: event.isNew ? "new" : "plain",
      };
    case "AREA_ALERT_SENT":
      return { key: "caseDetail.activity.areaAlert", params: {}, tone: "plain" };
    case "REACTIVATED":
      return { key: "caseDetail.activity.reactivated", params: {}, tone: "plain" };
    case "EXTENDED":
      return { key: "caseDetail.activity.extended", params: {}, tone: "plain" };
    case "CLOSED":
      return { key: "caseDetail.activity.closed", params: {}, tone: "plain" };
  }
}

/** Where tapping a timeline row leads, or null when it is informational only. */
export function activityTarget(event: ActivityEvent):
  | { kind: "chat"; id: string }
  | { kind: "observation"; id: string }
  | { kind: "matches" }
  | null {
  if (event.type === "MESSAGE" || event.type === "MATCH_CONFIRMED") return { kind: "chat", id: event.matchId };
  if (event.type === "OBSERVATION") return { kind: "observation", id: event.observationId };
  if (event.type === "MATCHES_FOUND") return { kind: "matches" };
  return null;
}
