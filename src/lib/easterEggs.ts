// T1.9BO: small hidden things for fun. No money value, nothing that changes how the app works.
export type Season = "halloween" | "christmas" | null;

/** 31 October gives a pumpkin, December a Santa hat; other days the plain pin. */
export function seasonFor(date = new Date()): Season {
  const m = date.getMonth();
  if (m === 9 && date.getDate() === 31) return "halloween";
  if (m === 11) return "christmas";
  return null;
}

export const LOGO_TAPS_FOR_PIN = 7;
export const LOGO_TAP_WINDOW_MS = 2500;

/** Counts quick taps on the Home logo; returns the new tap list and whether the pin drops. */
export function registerLogoTap(taps: number[], now = Date.now()): { taps: number[]; drop: boolean } {
  const recent = [...taps.filter((t) => now - t <= LOGO_TAP_WINDOW_MS), now];
  if (recent.length >= LOGO_TAPS_FOR_PIN) return { taps: [], drop: true };
  return { taps: recent, drop: false };
}

/** Lost-item search for keys gets a friendly nudge before the results. */
export function keysNudge(query: string): boolean {
  const q = String(query || "").trim().toLowerCase();
  return /^(nøkl|nokl|nøkkel|nokkel|keys?\b|key)/.test(q);
}

export type HiddenBadge = "NIGHT_WATCH" | "DOG_WHISPERER" | "UMBRELLA_HUNTER";
export const HIDDEN_BADGES: HiddenBadge[] = ["NIGHT_WATCH", "DOG_WHISPERER", "UMBRELLA_HUNTER"];
export const BADGE_ICONS: Record<HiddenBadge, string> = {
  NIGHT_WATCH: "moon-outline",
  DOG_WHISPERER: "paw-outline",
  UMBRELLA_HUNTER: "umbrella-outline",
};
