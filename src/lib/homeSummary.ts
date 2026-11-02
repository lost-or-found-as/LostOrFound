// src/lib/homeSummary.ts
// T1.9W: counts for the "Dine saker nå" card on Home. Uses the same call as My cases
// (/reports/mine/with-activity) and the same local "last seen" markers for unread chats.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { getLastSeenMap } from "./unread";
import { isReportClosed, isReportExpired, type LifecycleReport } from "./reportLifecycle";

export type HomeSummary = {
  activeCases: number;
  // Matches between two active cases (the server's matchToReport).
  openMatches: number;
  // Chats whose latest message is from the other person and newer than the last visit.
  unreadChats: number;
  // The case the button should open: the one with an unread chat, else the only case with matches.
  focusReportId: string | null;
};

type ActivityResponse = {
  reports?: LifecycleReport[];
  matchToReport?: Record<string, string>;
  historyMatchToReport?: Record<string, string>;
  lastMessages?: Array<{ conversation_id: string; sender_id: string; created_at: string }>;
  error?: string;
};

export async function fetchHomeSummary(userId: string): Promise<HomeSummary> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("NO_SESSION");

  const [lastSeen, res] = await Promise.all([
    getLastSeenMap().catch(() => ({} as Record<string, string>)),
    fetch(`${API_BASE_URL}/reports/mine/with-activity`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const data: ActivityResponse = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "HOME_SUMMARY_FAILED");

  const reports = data.reports ?? [];
  const now = Date.now();
  const activeCases = reports.filter((r) => !isReportClosed(r) && !isReportExpired(r, now)).length;

  const matchToReport = data.matchToReport ?? {};
  const allMatchToReport = { ...(data.historyMatchToReport ?? {}), ...matchToReport };

  let unreadChats = 0;
  let unreadReportId: string | null = null;
  for (const row of data.lastMessages ?? []) {
    const matchId = String(row.conversation_id);
    if (!allMatchToReport[matchId] || String(row.sender_id) === userId) continue;
    const seen = lastSeen[matchId];
    if (seen && new Date(row.created_at) <= new Date(seen)) continue;
    unreadChats += 1;
    unreadReportId = unreadReportId ?? allMatchToReport[matchId];
  }

  const reportsWithMatches = new Set(Object.values(matchToReport).filter(Boolean));
  const onlyReportWithMatches = reportsWithMatches.size === 1 ? [...reportsWithMatches][0] : null;

  return {
    activeCases,
    openMatches: Object.keys(matchToReport).length,
    unreadChats,
    focusReportId: unreadReportId ?? onlyReportWithMatches,
  };
}
