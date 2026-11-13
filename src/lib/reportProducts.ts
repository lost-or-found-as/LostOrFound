export const REPORT_PRODUCT_CODES = {
  REPORT_REACTIVATION: "REPORT_REACTIVATION",
  GEO_ALERT_TIER_1: "GEO_ALERT_TIER_1",
  GEO_ALERT_TIER_2: "GEO_ALERT_TIER_2",
  GEO_ALERT_TIER_3: "GEO_ALERT_TIER_3",
  GEO_ALERT_TIER_4: "GEO_ALERT_TIER_4",
  GEO_ALERT_TIER_5: "GEO_ALERT_TIER_5",
  // T1.9AM: «Synlig i nærheten», tier by how many follow the area.
  AREA_VISIBILITY_TIER_1: "AREA_VISIBILITY_TIER_1",
  AREA_VISIBILITY_TIER_2: "AREA_VISIBILITY_TIER_2",
  AREA_VISIBILITY_TIER_3: "AREA_VISIBILITY_TIER_3",
  LONG_TERM_WATCH_ANNUAL: "LONG_TERM_WATCH_ANNUAL",
} as const;

export type ReportProductCode =
  (typeof REPORT_PRODUCT_CODES)[keyof typeof REPORT_PRODUCT_CODES];

export type ReportOrderStatus =
  | "PENDING" | "AUTHORIZED" | "PAID" | "ACTIVE"
  | "CANCELLED" | "REFUNDED" | "FAILED" | "EXPIRED";

export type ReportEntitlementStatus =
  | "PENDING" | "ACTIVE" | "GRACE" | "PAUSED"
  | "CANCELLED" | "REFUNDED" | "EXPIRED";

export type LossDatePrecision = "EXACT" | "MONTH" | "YEAR" | "UNKNOWN";
export type GeoAlertGeometryType = "CIRCLE" | "ROUTE" | "POLYGON";
export type PopulationDensityBand = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type GeoAlertQuoteInput = {
  areaSqKm: number;
  populationDensityBand: PopulationDensityBand;
  estimatedEligibleUsers: number;
  durationHours: number;
  reminderCount?: number;
};

export type GeoAlertQuote = {
  productCode: ReportProductCode;
  tier: 1 | 2 | 3 | 4 | 5;
  amountOre: number;
  currency: "NOK";
  priceSnapshot: Record<string, unknown>;
};
