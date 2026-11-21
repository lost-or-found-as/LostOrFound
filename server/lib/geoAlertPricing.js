"use strict";
// T1.9T: an area alert is one push to everyone who follows the area, and it stays in
// "I nærheten" for 7 days. The price depends only on the size of the area:
//   up to 1 km radius: 149 kr · up to 3 km: 249 kr · larger: 399 kr.
// GEO_ALERT_PILOT_FREE=true on the server makes it free during the pilot (no new app needed).

const TIER_PRICES_ORE = Object.freeze({
  1: 14900,
  2: 24900,
  3: 39900,
});
const TIER_MAX_RADIUS_M = Object.freeze({ 1: 1000, 2: 3000 });
const MAX_TIER = 3;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isPilotFree(env = process.env) {
  return String(env.GEO_ALERT_PILOT_FREE || "").toLowerCase() === "true";
}

/** Radius from the request, or from the circle's area when only that is known. */
function radiusOf(input) {
  const r = finite(input?.radiusM, 0);
  if (r > 0) return r;
  const areaSqKm = Math.max(0, finite(input?.areaSqKm, 0));
  return Math.sqrt((areaSqKm * 1_000_000) / Math.PI);
}

function tierForRadius(radiusM) {
  if (radiusM <= TIER_MAX_RADIUS_M[1] + 0.5) return 1;
  if (radiusM <= TIER_MAX_RADIUS_M[2] + 0.5) return 2;
  return MAX_TIER;
}

/**
 * Push recipients as shown before purchase. Exact small numbers could reveal who lives
 * nearby, so the app gets a band: none, fewer than 10, or a range.
 * T1.9BF: wide ranges (10–50, 50–100, 100–250, 250–500, over 500) instead of "about 40".
 * `value` (rounded to 10) stays for builds from before T1.9BF; newer builds show min/max.
 */
const RECIPIENT_RANGES = Object.freeze([
  [10, 50],
  [50, 100],
  [100, 250],
  [250, 500],
]);

function recipientBand(count) {
  const n = Math.max(0, Math.round(finite(count)));
  if (n === 0) return { kind: "NONE", value: 0 };
  if (n < 10) return { kind: "FEW", value: 10 };
  const range = RECIPIENT_RANGES.find(([, max]) => n < max);
  const [min, max] = range || [500, null];
  return { kind: "ABOUT", value: Math.round(n / 10) * 10, min, max };
}

// T1.9BG: with places (place, route or area, up to three) the tier follows the joined area,
// with the same limits as the circles: up to 1 km radius (about 3.1 km²) and up to 3 km
// (about 28.3 km²). One store product per tier, so one purchase covers all places.
const TIER_MAX_AREA_SQ_KM = Object.freeze({
  1: (Math.PI * TIER_MAX_RADIUS_M[1] * TIER_MAX_RADIUS_M[1]) / 1_000_000,
  2: (Math.PI * TIER_MAX_RADIUS_M[2] * TIER_MAX_RADIUS_M[2]) / 1_000_000,
});

function tierForArea(areaSqKm) {
  const a = Math.max(0, finite(areaSqKm, 0));
  if (a <= TIER_MAX_AREA_SQ_KM[1] + 0.0001) return 1;
  if (a <= TIER_MAX_AREA_SQ_KM[2] + 0.0001) return 2;
  return MAX_TIER;
}

function calculateGeoAlertQuote(input, env = process.env) {
  const byPlaces = Array.isArray(input?.places) && input.places.length > 0;
  const radiusM = byPlaces ? null : radiusOf(input);
  const areaSqKm = Math.max(0, finite(input?.areaSqKm, 0));
  const tier = byPlaces ? tierForArea(areaSqKm) : tierForRadius(radiusM);
  const pilotFree = isPilotFree(env);
  const pushRecipients = Math.max(0, Math.round(finite(input?.estimatedEligibleInstallations ?? input?.pushRecipients)));
  return {
    productCode: `GEO_ALERT_TIER_${tier}`,
    tier,
    amountOre: pilotFree ? 0 : TIER_PRICES_ORE[tier],
    listPriceOre: TIER_PRICES_ORE[tier],
    pilotFree,
    currency: "NOK",
    validForMinutes: 15,
    recipients: recipientBand(pushRecipients),
    priceSnapshot: {
      version: byPlaces ? 3 : 2,
      radius_m: byPlaces ? null : Math.round(radiusM),
      ...(byPlaces ? { area_sq_km: Math.round(areaSqKm * 100) / 100, places: input.places.length } : {}),
      tier,
      list_price_ore: TIER_PRICES_ORE[tier],
      pilot_free: pilotFree,
      push_recipients: pushRecipients,
    },
  };
}

module.exports = { calculateGeoAlertQuote, recipientBand, isPilotFree, tierForRadius, tierForArea, TIER_PRICES_ORE };
