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
  // T1.9BH: where a tap on each count goes (missing in counts cached by older builds).
  unreadReportId?: string | null;
  matchesReportId?: string | null;
  // T1.9BP: the single case with new tips (sightings or finds from Nearby), opened on tap.
  tipsReportId?: string | null;
};

type ActivityResponse = {
  reports?: LifecycleReport[];
  matchToReport?: Record<string, string>;
  historyMatchToReport?: Record<string, string>;
  // T1.9BP: counted by the same rules as the match list.
  possibleMatchCounts?: Record<string, number>;
  newObservations?: Record<string, number>;
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

  // T1.9BP: matches as the list shows them, plus new tips on the user's cases. Older servers
  // without possibleMatchCounts fall back to the match map.
  const counts: Record<string, number> = data.possibleMatchCounts
    ? data.possibleMatchCounts
    : Object.values(matchToReport).reduce((acc, rid) => ({ ...acc, [rid]: (acc[rid] || 0) + 1 }), {} as Record<string, number>);
  const tips = data.newObservations ?? {};
  const reportsWithMatches = new Set(Object.keys(counts).filter((rid) => counts[rid] > 0));
  const reportsWithTips = new Set(Object.keys(tips).filter((rid) => tips[rid] > 0));
  const onlyReportWithMatches = reportsWithMatches.size === 1 && reportsWithTips.size === 0 ? [...reportsWithMatches][0] : null;
  const onlyReportWithTips = reportsWithTips.size === 1 && reportsWithMatches.size === 0 ? [...reportsWithTips][0] : null;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, n) => a + (Number(n) || 0), 0);

  return {
    activeCases,
    openMatches: sum(counts) + sum(tips),
    tipsReportId: onlyReportWithTips,
    unreadChats,
    focusReportId: unreadReportId ?? onlyReportWithMatches,
    unreadReportId,
    matchesReportId: onlyReportWithMatches,
  };
}

// T1.9AA: the last counts are kept on the phone per user, so the card shows at once when the app
// opens (the server can be slow to wake) and is then updated in place.
const CACHE_PREFIX = "lof.homeSummary.v1.";

export async function readCachedHomeSummary(userId: string): Promise<HomeSummary | null> {
  try {
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + userId);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.activeCases === "number" ? (value as HomeSummary) : null;
  } catch {
    return null;
  }
}

export async function writeCachedHomeSummary(userId: string, value: HomeSummary): Promise<void> {
  try {
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    await AsyncStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(value));
  } catch {
    // A cache that cannot be written only means the card waits for the server next time.
  }
}
