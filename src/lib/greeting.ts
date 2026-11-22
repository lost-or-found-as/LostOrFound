// T1.9BN: the Home greeting follows the time of day («Hei igjen, god kveld»).
import type { TranslationKey } from "../i18n/locales/en";

export type DayPart = "morning" | "forenoon" | "afternoon" | "evening" | "night";

/** Part of the day for a local hour (0–23). */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 12) return "forenoon";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 23) return "evening";
  return "night";
}

export const GREETING_KEYS: Record<DayPart, TranslationKey> = {
  morning: "home.greetingMorning",
  forenoon: "home.greetingForenoon",
  afternoon: "home.greetingAfternoon",
  evening: "home.greetingEvening",
  night: "home.greetingNight",
};

export function greetingKey(date = new Date()): TranslationKey {
  return GREETING_KEYS[dayPart(date.getHours())];
}
