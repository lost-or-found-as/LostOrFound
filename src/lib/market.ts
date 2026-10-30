// src/lib/market.ts
import { translate } from "../i18n/translate";
import { formatDistance } from "../i18n/formatters";

// Rewards and prices are stored in Norwegian kroner (reward_ore, amountOre) until the database
// stores a currency per amount.
export const STORED_MONEY_CURRENCY = "NOK";
export type SupportedLanguage = "no" | "en";
export type RegionCode = "NO" | "US" | "GB" | "EU" | "OTHER";
export type CurrencyCode = "NOK" | "USD" | "GBP" | "EUR";
export type DistanceUnit = "metric" | "imperial";

export type MarketFeatureFlags = {
  rewardEnabled: boolean;
  leaderboardEnabled: boolean;
  geoBroadcastEnabled: boolean;
  legacyCaseListingEnabled: boolean;
  vippsPreferred: boolean;
};

export type RadiusOption = {
  key: string;
  meters: number;
};

export type MarketConfig = {
  locale: string;
  language: SupportedLanguage;
  regionCode: RegionCode;
  currencyCode: CurrencyCode;
  distanceUnit: DistanceUnit;
  featureFlags: MarketFeatureFlags;
  geoRadiusOptions: RadiusOption[];
};

const EU_REGION_CODES = [
  "SE", "DK", "FI", "DE", "FR", "ES", "IT", "NL", "BE", "PT", "IE", "AT", "CH", "PL", "CZ",
] as const;

const METRIC_RADIUS_OPTIONS: RadiusOption[] = [
  { key: "r1", meters: 1000 },
  { key: "r3", meters: 3000 },
  { key: "r5", meters: 5000 },
  { key: "r10", meters: 10000 },
];

const IMPERIAL_RADIUS_OPTIONS: RadiusOption[] = [
  { key: "mi1", meters: 1609 },
  { key: "mi3", meters: 4828 },
  { key: "mi5", meters: 8047 },
  { key: "mi10", meters: 16093 },
];

export function inferRegionCodeFromLocale(locale?: string): RegionCode {
  const region = String(locale || "").split("-").pop()?.toUpperCase() || "";
  if (region === "NO") return "NO";
  if (region === "US") return "US";
  if (region === "GB") return "GB";
  if (EU_REGION_CODES.includes(region as (typeof EU_REGION_CODES)[number])) return "EU";
  return "OTHER";
}

export function inferLanguageFromLocale(locale?: string): SupportedLanguage {
  const normalized = String(locale || "").toLowerCase();
  return normalized.startsWith("no") || normalized.startsWith("nb") || normalized.startsWith("nn") ? "no" : "en";
}

export function rewardCurrencyCode(region: RegionCode): CurrencyCode {
  if (region === "NO") return "NOK";
  if (region === "US") return "USD";
  if (region === "GB") return "GBP";
  return "EUR";
}

export function getDistanceUnit(region: RegionCode): DistanceUnit {
  return region === "US" ? "imperial" : "metric";
}

export function getGeoRadiusOptions(region: RegionCode): RadiusOption[] {
  return region === "US" ? IMPERIAL_RADIUS_OPTIONS : METRIC_RADIUS_OPTIONS;
}

export function getMarketFeatureFlags(region: RegionCode): MarketFeatureFlags {
  return {
    rewardEnabled: region === "NO",
    leaderboardEnabled: region === "NO",
    geoBroadcastEnabled: false,
    legacyCaseListingEnabled: false,
    vippsPreferred: region === "NO",
  };
}

export function getMarketConfig(input?: { locale?: string; language?: SupportedLanguage }): MarketConfig {
  const locale = input?.locale || "";
  const regionCode = inferRegionCodeFromLocale(locale);
  const language = input?.language || inferLanguageFromLocale(locale);
  return {
    locale,
    language,
    regionCode,
    currencyCode: rewardCurrencyCode(regionCode),
    distanceUnit: getDistanceUnit(regionCode),
    featureFlags: getMarketFeatureFlags(regionCode),
    geoRadiusOptions: getGeoRadiusOptions(regionCode),
  };
}

// Kept for older callers; new code uses formatDistance from src/i18n/formatters.
export function formatDistanceDisplay(meters: number | undefined, region: RegionCode, language: SupportedLanguage) {
  if (meters == null) return "—";
  return formatDistance(meters, language, (k, p) => translate(language, k, p), region === "US" || region === "GB" ? "imperial" : "metric");
}

export function formatCurrencyDisplay(amount: number | undefined, currency: CurrencyCode, locale?: string) {
  if (amount == null || Number.isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
