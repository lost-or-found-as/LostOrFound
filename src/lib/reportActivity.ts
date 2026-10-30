// src/lib/reportActivity.ts
// T1.9G: activity for one case (GET /reports/:id/activity) and the "Neste steg" decision for
// Saksdetaljer. nextStep() and activityText() are pure so the rules can be tested without the app.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import {
  canBuyLongTerm,
  canExtendFound,
  canExtendLost,
  isInLostExtensionWindow,
  isHistoricFromStart,
  isReportClosed,
  isReportExpired,
  reportDaysLeft,
  type LifecycleReport,
} from "./reportLifecycle";
import type { TranslationKey } from "../i18n/locales/en";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivitySummary = {
  possibleMatches: number;
  strongMatches: number;
  bestScore: number | null;
  confirmedMatches: number;
  unreadMessages: number;
  chatMatchId: string | null;
  newObservations: number;
  // T1.9H
  paidExtensions: number;
  longTermUntil: string | null;
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
  | { type: "LONG_TERM"; at: string; years: number | null }
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
    paidExtensions: 0,
    longTermUntil: null,
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

export type NextStepAction = "openChat" | "openMatches" | "extendLost" | "extendFound" | "longTerm" | null;
// A historic case can be renewed from this many days before it ends.
export const LONG_TERM_RENEW_WINDOW_DAYS = 30;
export type NextStepTone = "dark" | "plain";

export type NextStep = {
  kind: "closed" | "unreadChat" | "chat" | "matches" | "historic" | "expired" | "historicOffer" | "expiring" | "searching";
  tone: NextStepTone;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  params: Record<string, number>;
  action: NextStepAction;
  actionKey: TranslationKey | null;
  // Date the screen formats into the {{date}} parameter (end of a historic period).
  dateIso?: string;
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

  // T1.9H: a running historic period.
  const longTermEnd = Date.parse(summary.longTermUntil || "");
  if (lost && Number.isFinite(longTermEnd) && longTermEnd > now) {
    const renewSoon = longTermEnd - now <= LONG_TERM_RENEW_WINDOW_DAYS * DAY_MS;
    return {
      ...step(
        "historic",
        "plain",
        "caseDetail.next.historicTitle",
        renewSoon ? "caseDetail.next.historicBodyEnding" : "caseDetail.next.historicBody",
        renewSoon ? "longTerm" : null,
        renewSoon ? "caseDetail.next.renewLongTerm" : null,
      ),
      dateIso: summary.longTermUntil as string,
    };
  }

  if (isReportExpired(report, now)) {
    // A lost case gets 30 days twice; after that the next step is a historic case.
    if (canExtendLost(report, summary, now) && !isHistoricFromStart(report, now))
      return step("expired", "plain", "caseDetail.next.expiredTitle", "caseDetail.next.expiredBodyLost", "extendLost", "caseDetail.next.reactivate");
    if (lost && canBuyLongTerm(report))
      return step(
        "expired",
        "plain",
        "caseDetail.next.expiredTitle",
        isHistoricFromStart(report, now) ? "caseDetail.next.historicOfferBody" : "caseDetail.next.expiredBodyLostFinal",
        "longTerm",
        "caseDetail.next.makeHistoric",
      );
    if (canExtendFound(report, now))
      return step("expired", "plain", "caseDetail.next.expiredTitle", "caseDetail.next.expiredBodyFound", "extendFound", "caseDetail.next.extendFound");
    return step("expired", "plain", "caseDetail.next.expiredTitle", "caseDetail.next.expiredBodyFinal");
  }

  if (lost && canBuyLongTerm(report) && isHistoricFromStart(report, now))
    return step("historicOffer", "plain", "caseDetail.next.historicOfferTitle", "caseDetail.next.historicOfferBody", "longTerm", "caseDetail.next.makeHistoric");

  // T1.9I: the last days of a LOST case: extend it, or make it historic when both extensions are used.
  if (lost && isInLostExtensionWindow(report, now)) {
    const days = { count: reportDaysLeft(report, now) ?? 0 };
    if (canExtendLost(report, summary, now))
      return step("expiring", "plain", "caseDetail.next.expiringTitle", "caseDetail.next.expiringBodyLost", "extendLost", "caseDetail.next.extendLost", days);
    if (canBuyLongTerm(report))
      return step("expiring", "plain", "caseDetail.next.expiringTitle", "caseDetail.next.expiringBodyLostFinal", "longTerm", "caseDetail.next.makeHistoric", days);
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
    case "LONG_TERM":
      return { key: "caseDetail.activity.longTerm", params: { count: event.years ?? 1 }, tone: "plain" };
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
