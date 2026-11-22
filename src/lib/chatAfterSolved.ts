// T1.9BM: same rule as server/lib/chatAfterSolved.js: open 7 days after the case is closed,
// then read-only.
export const CHAT_DAYS_AFTER_SOLVED = 7;
const DAY = 24 * 60 * 60 * 1000;

type CaseLike = { status?: string | null; closed_at?: string | null } | null | undefined;

export function solvedChatState(reports: CaseLike[], nowMs = Date.now()): { closesAt: string; closed: boolean } | null {
  const closedTimes = reports
    .filter((r): r is NonNullable<CaseLike> => !!r && (String(r.status || "").toUpperCase() === "CLOSED" || !!r.closed_at))
    .map((r) => Date.parse(r.closed_at || "") || nowMs);
  if (!closedTimes.length) return null;
  const closesAt = Math.min(...closedTimes) + CHAT_DAYS_AFTER_SOLVED * DAY;
  return { closesAt: new Date(closesAt).toISOString(), closed: nowMs >= closesAt };
}
