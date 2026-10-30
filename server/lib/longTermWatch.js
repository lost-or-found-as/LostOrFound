// server/lib/longTermWatch.js
// T1.9H: historic cases ("historisk sak"). A LOST case can be kept for 1, 2 or 3 years as a
// one-time purchase per case. The price of 30-day extensions already paid for the case is
// subtracted the first time (at most two). Store prices are fixed per product, so every
// combination is its own catalog product: LONG_TERM_WATCH_<years>Y[_C<credits>].
// Pure helpers, no database access.
"use strict";

const LONG_TERM_YEARS = Object.freeze([1, 2, 3]);
const MAX_EXTENSION_CREDITS = 2;
const LONG_TERM_PRODUCT_PREFIX = "LONG_TERM_WATCH_";
// Product the app asks for; the server picks the exact variant.
const LONG_TERM_REQUEST_CODE = "LONG_TERM_WATCH";
const EXTENSION_PRODUCT_CODE = "REPORT_REACTIVATION";
// A case whose loss date is at least this old is offered as historic from the start.
const HISTORIC_FROM_START_DAYS = 365;
const PAID_ORDER_STATUSES = new Set(["PAID", "ACTIVE", "SUPERSEDED", "EXPIRED"]);
const LIVE_WATCH_STATUSES = new Set(["ACTIVE", "GRACE"]);

function normalizeYears(value) {
  const years = Number(value);
  if (!LONG_TERM_YEARS.includes(years)) {
    const error = new Error("INVALID_LONG_TERM_YEARS");
    error.code = "INVALID_LONG_TERM_YEARS";
    throw error;
  }
  return years;
}

function longTermProductCode(years, credits) {
  const y = normalizeYears(years);
  const c = Math.max(0, Math.min(MAX_EXTENSION_CREDITS, Math.trunc(Number(credits) || 0)));
  return `${LONG_TERM_PRODUCT_PREFIX}${y}Y${c > 0 ? `_C${c}` : ""}`;
}

// Matches the per-years products, not the older auto-renewing LONG_TERM_WATCH_ANNUAL.
function isLongTermProduct(code) {
  return /^LONG_TERM_WATCH_[1-9]Y(_C[0-9])?$/.test(String(code || ""));
}

function yearsOfProduct(code) {
  const m = String(code || "").match(/^LONG_TERM_WATCH_([1-9])Y/);
  return m ? Number(m[1]) : null;
}

function isLiveWatch(watch, now = Date.now()) {
  if (!watch || !LIVE_WATCH_STATUSES.has(String(watch.status || "").toUpperCase())) return false;
  const end = Date.parse(watch.current_period_end || "");
  return !Number.isFinite(end) || end > now;
}

/**
 * Paid extensions that still count as credit. Credit is given once: not when the case has
 * already had a historic period (the earlier purchase used it).
 */
function extensionCredits(orders, hadLongTermBefore) {
  if (hadLongTermBefore) return 0;
  const paid = (orders || []).filter(
    (o) =>
      String(o?.product_code || "") === EXTENSION_PRODUCT_CODE &&
      !!o?.paid_at &&
      !o?.refunded_at &&
      PAID_ORDER_STATUSES.has(String(o?.status || "").toUpperCase()),
  ).length;
  return Math.min(MAX_EXTENSION_CREDITS, paid);
}

/** Whether a historic period can be bought for this case, and whether it renews a live one. */
function longTermEligibility(report, watch, now = Date.now()) {
  if (!report || report.deleted_at) return { ok: false, error: "REPORT_NOT_FOUND" };
  if (String(report.type || "").toUpperCase() !== "LOST") return { ok: false, error: "LONG_TERM_REQUIRES_LOST_REPORT" };
  if (report.closed_at || String(report.status || "").toUpperCase() === "CLOSED") return { ok: false, error: "REPORT_CLOSED" };
  return { ok: true, renew: isLiveWatch(watch, now) };
}

/** A renewal continues from the end of the running period; otherwise it starts now. */
function longTermPeriod(years, watch, now = Date.now()) {
  const y = normalizeYears(years);
  const runningEnd = isLiveWatch(watch, now) ? Date.parse(watch.current_period_end || "") : NaN;
  const start = new Date(Number.isFinite(runningEnd) && runningEnd > now ? runningEnd : now);
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + y);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Price details for the app. `fullYearProduct` and `product` are catalog rows. */
function longTermQuote({ years, credits, product, fullYearProduct, period }) {
  const full = Number(fullYearProduct?.base_price_ore ?? product?.base_price_ore ?? 0);
  const amount = Number(product?.base_price_ore ?? 0);
  return {
    years,
    productCode: product?.code ?? null,
    creditedExtensions: credits,
    baseAmountOre: full,
    creditOre: Math.max(0, full - amount),
    amountOre: amount,
    currency: product?.currency || "NOK",
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  };
}

function isHistoricFromStart(report, now = Date.now()) {
  const when = Date.parse(report?.occurred_at || "");
  return Number.isFinite(when) && now - when >= HISTORIC_FROM_START_DAYS * 24 * 60 * 60 * 1000;
}

module.exports = {
  LONG_TERM_YEARS,
  MAX_EXTENSION_CREDITS,
  LONG_TERM_REQUEST_CODE,
  EXTENSION_PRODUCT_CODE,
  HISTORIC_FROM_START_DAYS,
  normalizeYears,
  longTermProductCode,
  isLongTermProduct,
  yearsOfProduct,
  isLiveWatch,
  extensionCredits,
  longTermEligibility,
  longTermPeriod,
  longTermQuote,
  isHistoricFromStart,
};
