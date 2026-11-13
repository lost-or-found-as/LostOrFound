"use strict";
// T1.9AM: «Synlig i nærheten». The case is listed for 7 days in «I nærheten» for people whose
// alert area covers the place, without push. The price depends on how many people follow the
// area: under 500 · 500–2000 · over 2000 (tiers 1–3; prices live in product_catalog).
// An area alert always includes the same visibility, so visibility cannot be bought while an
// area alert or another visibility period is live. GEO_ALERT_PILOT_FREE makes it free too.
const { isPilotFree, recipientBand } = require("./geoAlertPricing");

const VISIBILITY_PRODUCT_PREFIX = "AREA_VISIBILITY_TIER_";
const VISIBILITY_REQUEST_CODE = "AREA_VISIBILITY";
const VISIBILITY_DURATION_HOURS = 168;
const VISIBILITY_TIER_MAX_FOLLOWERS = Object.freeze({ 1: 499, 2: 2000 });
const VISIBILITY_MAX_TIER = 3;
const AREA_VISIBILITY_ALREADY_ACTIVE = "AREA_VISIBILITY_ALREADY_ACTIVE";
const AREA_VISIBILITY_NO_FOLLOWERS = "AREA_VISIBILITY_NO_FOLLOWERS";

function isVisibilityProduct(productCode) {
  return String(productCode || "").startsWith(VISIBILITY_PRODUCT_PREFIX);
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function visibilityTier(followers) {
  const n = Math.max(0, Math.round(finite(followers)));
  if (n <= VISIBILITY_TIER_MAX_FOLLOWERS[1]) return 1;
  if (n <= VISIBILITY_TIER_MAX_FOLLOWERS[2]) return 2;
  return VISIBILITY_MAX_TIER;
}

/** Product, tier and follower band for the people who follow the area (users, not phones). */
function calculateVisibilityQuote({ followers, radiusM }, env = process.env) {
  const count = Math.max(0, Math.round(finite(followers)));
  const tier = visibilityTier(count);
  const pilotFree = isPilotFree(env);
  return {
    kind: "VISIBILITY",
    productCode: `${VISIBILITY_PRODUCT_PREFIX}${tier}`,
    tier,
    pilotFree,
    currency: "NOK",
    validForMinutes: 15,
    durationHours: VISIBILITY_DURATION_HOURS,
    // Same privacy band as area alerts: never an exact small number.
    recipients: recipientBand(count),
    priceSnapshot: {
      version: 1,
      kind: "VISIBILITY",
      radius_m: Math.round(finite(radiusM)),
      tier,
      followers: count,
      pilot_free: pilotFree,
    },
  };
}

/**
 * Why visibility cannot be ordered now, or null. Live = an ACTIVE campaign (either kind) for the
 * case that has not ended: an area alert already makes the case visible.
 */
function visibilityBlockReason(campaigns, now = Date.now()) {
  const live = (campaigns || []).filter(
    (c) => String(c?.status || "").toUpperCase() === "ACTIVE" && Date.parse(c?.ends_at || "") > now,
  );
  if (!live.length) return null;
  const until = live.map((c) => c.ends_at).sort().pop();
  return { error: AREA_VISIBILITY_ALREADY_ACTIVE, activeUntil: until };
}

/** The case's visibility for the app: until when, and whether it comes from an area alert. */
function visibilityStatus(campaigns, now = Date.now()) {
  const live = (campaigns || [])
    .filter((c) => String(c?.status || "").toUpperCase() === "ACTIVE" && Date.parse(c?.ends_at || "") > now)
    .sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at));
  if (!live.length) return { activeUntil: null, viaAreaAlert: false };
  return {
    activeUntil: live[0].ends_at,
    viaAreaAlert: live.some((c) => String(c.kind || "ALERT").toUpperCase() === "ALERT"),
  };
}

module.exports = {
  VISIBILITY_PRODUCT_PREFIX,
  VISIBILITY_REQUEST_CODE,
  VISIBILITY_DURATION_HOURS,
  AREA_VISIBILITY_ALREADY_ACTIVE,
  AREA_VISIBILITY_NO_FOLLOWERS,
  isVisibilityProduct,
  visibilityTier,
  calculateVisibilityQuote,
  visibilityBlockReason,
  visibilityStatus,
};
