// src/lib/helperBonus.ts
// T1.9AX: the user's own bonus (GET /bonus/me) and how a helper level reads. Everything stays
// hidden while the server says the bonus is off (enabled: false) or the request fails.
import { supabase } from "./supabase";
import { API_BASE_URL } from "./config";
import type { TranslationKey } from "../i18n/locales/en";
import { HIDDEN_BADGES, type HiddenBadge } from "./easterEggs";

// T1.9BO: Legende (100), Mytisk finner (250) and Guddommelig finner (500) on top.
export type HelperLevel = "HELPER" | "SUPER_HELPER" | "MASTER_HELPER" | "LEGEND" | "MYTHIC_FINDER" | "DIVINE_FINDER";
export type BonusEvent = "FOUND_REGISTERED" | "SIGHTING_USEFUL" | "MATCH_CONFIRMED" | "SIGHTING_RESOLVED" | "RETURN_CONFIRMED";
export type BonusNext = { kind: "LEVEL"; level: HelperLevel; at: number } | { kind: "STAR"; stars: number; at: number } | null;
export type MyBonus = {
  enabled: boolean;
  balance: number;
  pending: number;
  // T1.9BK: when waiting bonus can first be used, and returns that are waiting.
  nextPendingAt?: string | null;
  pendingReturns?: number;
  returns: number;
  level: HelperLevel | null;
  stars: number;
  next: BonusNext;
  nextExpiry: { points: number; at: string } | null;
  history: { event: BonusEvent; points: number; status: string; at: string; validFrom: string }[];
  // T1.9BO: hidden badges the user has earned (for fun only).
  badges: HiddenBadge[];
};
export type HelperStatus = { level: HelperLevel; stars: number; returns: number };

const LEVELS: HelperLevel[] = ["HELPER", "SUPER_HELPER", "MASTER_HELPER", "LEGEND", "MYTHIC_FINDER", "DIVINE_FINDER"];
/** Where the progress bar starts for each next level (the level or star before it). */
export const LEVEL_PROGRESS_FROM: Record<HelperLevel, number> = {
  HELPER: 0,
  SUPER_HELPER: 1,
  MASTER_HELPER: 5,
  LEGEND: 90,
  MYTHIC_FINDER: 100,
  DIVINE_FINDER: 250,
};
/** T1.9BO: the top levels get their own icon in the badge. */
export const LEVEL_ICONS: Record<HelperLevel, string> = {
  HELPER: "ribbon-outline",
  SUPER_HELPER: "ribbon-outline",
  MASTER_HELPER: "ribbon-outline",
  LEGEND: "shield-checkmark-outline",
  MYTHIC_FINDER: "sparkles-outline",
  DIVINE_FINDER: "trophy-outline",
};
export const BONUS_EVENTS: BonusEvent[] = ["RETURN_CONFIRMED", "SIGHTING_RESOLVED", "MATCH_CONFIRMED", "SIGHTING_USEFUL", "FOUND_REGISTERED"];
export const BONUS_POINTS: Record<BonusEvent, number> = {
  RETURN_CONFIRMED: 15,
  SIGHTING_RESOLVED: 5,
  MATCH_CONFIRMED: 3,
  SIGHTING_USEFUL: 1,
  FOUND_REGISTERED: 1,
};

const isLevel = (v: unknown): v is HelperLevel => typeof v === "string" && (LEVELS as string[]).includes(v);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

export function levelKey(level: HelperLevel): TranslationKey {
  return `bonus.level.${level}` as TranslationKey;
}

/** "★★" for stars after Mesterhjelper (at most five). */
export function starText(stars: number): string {
  return "★".repeat(Math.max(0, Math.min(5, num(stars))));
}

/** Shapes the server answer; null when it is missing or broken. */
export function toMyBonus(data: any): MyBonus | null {
  const b = data?.bonus;
  if (!b || typeof b !== "object") return null;
  const next = b.next;
  return {
    enabled: b.enabled === true,
    balance: num(b.balance),
    pending: num(b.pending),
    returns: num(b.returns),
    level: isLevel(b.level) ? b.level : null,
    stars: num(b.stars),
    next:
      next?.kind === "LEVEL" && isLevel(next.level)
        ? { kind: "LEVEL", level: next.level, at: num(next.at) }
        : next?.kind === "STAR"
          ? { kind: "STAR", stars: num(next.stars), at: num(next.at) }
          : null,
    badges: Array.isArray(b.badges) ? (b.badges.filter((x: any) => (HIDDEN_BADGES as string[]).includes(x)) as HiddenBadge[]) : [],
    nextExpiry: b.nextExpiry && typeof b.nextExpiry.at === "string" ? { points: num(b.nextExpiry.points), at: b.nextExpiry.at } : null,
    history: Array.isArray(b.history)
      ? b.history
          .filter((h: any) => typeof h?.event === "string" && BONUS_EVENTS.includes(h.event))
          .map((h: any) => ({ event: h.event, points: num(h.points), status: String(h.status || ""), at: String(h.at || ""), validFrom: String(h.validFrom || "") }))
      : [],
  };
}

/** The other party's level from a match answer, or null. */
export function toHelperStatus(value: any): HelperStatus | null {
  if (!value || !isLevel(value.level)) return null;
  return { level: value.level, stars: num(value.stars), returns: num(value.returns) };
}

/** GET /bonus/me, or null (logged out, guest, error). */
export async function fetchMyBonus(): Promise<MyBonus | null> {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return null;
    const r = await fetch(`${API_BASE_URL}/bonus/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return toMyBonus(await r.json().catch(() => null));
  } catch {
    return null;
  }
}
