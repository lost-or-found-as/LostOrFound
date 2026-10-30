// src/i18n/formatters.ts
// T1.9E: every date, time, distance, area and money value shown to the user is formatted here.
// Language decides the words and number style. The device's measurement system decides km or
// miles, so a phone set to the US or UK shows miles whatever the app language is.
// To add a language: add it to Lang, the locale files and LOCALE_BY_LANGUAGE below.
import * as Localization from "expo-localization";
import type { Lang } from "./translate";
import type { TranslationKey } from "./locales/en";

type Params = Record<string, string | number | null | undefined>;
export type Translate = (key: TranslationKey, params?: Params) => string;
export type DistanceSystem = "metric" | "imperial";

const LOCALE_BY_LANGUAGE: Record<Lang, string> = { no: "nb-NO", en: "en-GB" };

export function localeForLanguage(language: Lang): string {
  return LOCALE_BY_LANGUAGE[language] ?? LOCALE_BY_LANGUAGE.en;
}

function asDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(language: Lang, value: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions) {
  const d = asDate(value);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat(localeForLanguage(language), options).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function formatLocalizedDateTime(value: string | Date, language: Lang) {
  return fmt(language, value, { dateStyle: "medium", timeStyle: "short" });
}
export function formatDate(value: string | number | Date | null | undefined, language: Lang) {
  return fmt(language, value, { day: "numeric", month: "short", year: "numeric" });
}
export function formatTime(value: string | number | Date | null | undefined, language: Lang) {
  return fmt(language, value, { hour: "2-digit", minute: "2-digit" });
}
export function formatDayMonth(value: string | number | Date | null | undefined, language: Lang) {
  return fmt(language, value, { day: "numeric", month: "long" });
}
export function formatDateTimeCustom(
  value: string | number | Date | null | undefined,
  language: Lang,
  options: Intl.DateTimeFormatOptions,
) {
  return fmt(language, value, options);
}

export function formatNumber(value: number, language: Lang, maximumFractionDigits = 0) {
  try {
    return new Intl.NumberFormat(localeForLanguage(language), { maximumFractionDigits }).format(value);
  } catch {
    return String(Number(value.toFixed(maximumFractionDigits)));
  }
}

// "I dag" / "I går" / "12. mars" — for chat day separators.
export function formatDayLabel(value: string | Date, language: Lang, t: Translate) {
  const d = asDate(value);
  if (!d) return "";
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (key(d) === key(today)) return t("time.today");
  if (key(d) === key(yesterday)) return t("time.yesterday");
  return formatDayMonth(d, language);
}

// "nå" / "5 min" / "3 t" / "2 d" (short) or "5 min siden" / "2 uker siden" (long).
export function formatTimeAgo(value: string | Date | null | undefined, t: Translate, style: "short" | "long" = "short") {
  const d = asDate(value);
  if (!d) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (!Number.isFinite(min)) return "";
  if (min < 1) return t("time.now");
  if (min < 60) return t(style === "short" ? "time.short.minutes" : "time.ago.minutes", { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t(style === "short" ? "time.short.hours" : "time.ago.hours", { count: h });
  const days = Math.floor(h / 24);
  if (style === "short") return t("time.short.days", { count: days });
  if (days < 7) return t("time.ago.days", { count: days });
  if (days < 35) return t("time.ago.weeks", { count: Math.floor(days / 7) });
  if (days < 365) return t("time.ago.months", { count: Math.floor(days / 30) });
  return t("time.ago.years", { count: Math.floor(days / 365) });
}

// km or miles from the device settings (US and UK use miles).
export function deviceDistanceSystem(): DistanceSystem {
  try {
    const system = Localization.getLocales()?.[0]?.measurementSystem;
    return system === "us" || system === "uk" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

// "350 m" / "1,5 km" / "800 ft" / "2.3 mi"
export function formatDistance(
  meters: number | null | undefined,
  language: Lang,
  t: Translate,
  system: DistanceSystem = deviceDistanceSystem(),
) {
  const n = Number(meters);
  if (meters == null || !Number.isFinite(n)) return "";
  if (system === "imperial") {
    const feet = n * 3.28084;
    if (feet < 1000) return t("units.feet", { value: formatNumber(Math.round(feet), language) });
    const miles = n / 1609.344;
    return t("units.miles", { value: formatNumber(miles, language, miles >= 10 ? 0 : 1) });
  }
  if (n < 1000) return t("units.meters", { value: formatNumber(Math.round(n), language) });
  const km = n / 1000;
  return t("units.kilometers", { value: formatNumber(km, language, km >= 10 ? 0 : 1) });
}

// "7,1 km²" / "2.7 sq mi"
export function formatArea(
  squareMeters: number | null | undefined,
  language: Lang,
  t: Translate,
  system: DistanceSystem = deviceDistanceSystem(),
) {
  const n = Number(squareMeters);
  if (squareMeters == null || !Number.isFinite(n)) return "";
  if (system === "imperial") {
    return t("units.squareMiles", { value: formatNumber(n / 2589988.11, language, 2) });
  }
  return t("units.squareKilometers", { value: formatNumber(n / 1_000_000, language, 2) });
}

// Money in the currency it is stored in. `amount` is in whole units (kroner, dollars).
// Whole amounts are shown without decimals, other amounts with two.
export function formatMoney(amount: number | null | undefined, currency: string, language: Lang, fractionDigits?: number) {
  const n = Number(amount);
  if (amount == null || !Number.isFinite(n)) return "";
  if (fractionDigits == null) fractionDigits = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat(localeForLanguage(language), {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(n);
  } catch {
    return `${formatNumber(n, language, fractionDigits)} ${currency}`;
  }
}
