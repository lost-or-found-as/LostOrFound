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
 * nearby, so the app gets a band: none, fewer than 10, or rounded to the nearest 10.
 */
function recipientBand(count) {
  const n = Math.max(0, Math.round(finite(count)));
  if (n === 0) return { kind: "NONE", value: 0 };
  if (n < 10) return { kind: "FEW", value: 10 };
  return { kind: "ABOUT", value: Math.round(n / 10) * 10 };
}

function calculateGeoAlertQuote(input, env = process.env) {
  const radiusM = radiusOf(input);
  const tier = tierForRadius(radiusM);
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
      version: 2,
      radius_m: Math.round(radiusM),
      tier,
      list_price_ore: TIER_PRICES_ORE[tier],
      pilot_free: pilotFree,
      push_recipients: pushRecipients,
    },
  };
}

module.exports = { calculateGeoAlertQuote, recipientBand, isPilotFree, tierForRadius, TIER_PRICES_ORE };
