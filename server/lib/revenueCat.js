"use strict";
// T1.9AE: RevenueCat on the server.
// - The app buys a store product through RevenueCat; the server never trusts the app's word for
//   it and looks the transaction up with the secret REST key before a service is activated.
// - RevenueCat also calls our webhook for every purchase and refund, so a purchase is activated
//   even if the app is closed before it can confirm.
// Settings (Render only, never in the app):
//   REVENUECAT_SECRET_API_KEY   secret v1 key (sk_...) for GET /v1/subscribers/{app_user_id}
//   REVENUECAT_WEBHOOK_AUTH     the Authorization header value set on the webhook in RevenueCat
//   REVENUECAT_ALLOW_SANDBOX    "true" on staging: accept sandbox and Test Store purchases
const crypto = require("crypto");

const API_BASE = "https://api.revenuecat.com/v1";

function secretKey(env = process.env) {
  return String(env.REVENUECAT_SECRET_API_KEY || "").trim();
}

function sandboxAllowed(env = process.env) {
  return String(env.REVENUECAT_ALLOW_SANDBOX || "").toLowerCase() === "true";
}

/** Constant-time check of the webhook Authorization header. */
function webhookAuthorized(header, env = process.env) {
  const expected = String(env.REVENUECAT_WEBHOOK_AUTH || "").trim();
  const given = String(header || "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Store product ids a catalog product can be bought as (App Store and Google Play). */
function storeProductIds(product) {
  return [product?.apple_product_id, product?.google_product_id].map((x) => String(x || "").trim()).filter(Boolean);
}

/** The catalog product for a store product id, or null. */
function productForStoreId(products, storeProductId) {
  const id = String(storeProductId || "").trim();
  if (!id) return null;
  return (products || []).find((p) => storeProductIds(p).includes(id)) || null;
}

/** GET /v1/subscribers/{appUserId}; throws with code REVENUECAT_NOT_CONFIGURED or REVENUECAT_LOOKUP_FAILED. */
async function fetchSubscriber(appUserId, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const key = secretKey(env);
  if (!key) throw Object.assign(new Error("REVENUECAT_NOT_CONFIGURED"), { code: "REVENUECAT_NOT_CONFIGURED" });
  const response = await fetchImpl(`${API_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw Object.assign(new Error("REVENUECAT_LOOKUP_FAILED"), { code: "REVENUECAT_LOOKUP_FAILED", status: response.status });
  }
  const body = await response.json();
  return body?.subscriber || null;
}

/**
 * One-time store transactions of a subscriber, flattened:
 * [{ productId, transactionId, revenueCatId, purchasedAt, store, sandbox }]
 */
function oneTimeTransactions(subscriber) {
  const out = [];
  const groups = subscriber?.non_subscriptions || {};
  for (const [productId, list] of Object.entries(groups)) {
    for (const t of Array.isArray(list) ? list : []) {
      out.push({
        productId,
        transactionId: String(t.store_transaction_id || t.id || ""),
        revenueCatId: String(t.id || ""),
        purchasedAt: t.purchase_date || null,
        store: String(t.store || "").toUpperCase() || null,
        sandbox: t.is_sandbox === true,
      });
    }
  }
  return out;
}

/**
 * The transaction that pays for an order: same store product, the given transaction id, and
 * (unless sandbox is allowed) not a sandbox purchase. Returns { transaction } or { error }.
 */
function findPaymentTransaction(subscriber, { productIds, transactionId, allowSandbox }) {
  const wanted = String(transactionId || "").trim();
  if (!wanted) return { error: "TRANSACTION_ID_REQUIRED" };
  const all = oneTimeTransactions(subscriber);
  const match = all.find((t) => t.transactionId === wanted || t.revenueCatId === wanted);
  if (!match) return { error: "TRANSACTION_NOT_FOUND" };
  if (!productIds.includes(match.productId)) return { error: "TRANSACTION_PRODUCT_MISMATCH" };
  if (match.sandbox && !allowSandbox) return { error: "SANDBOX_PURCHASE_NOT_ALLOWED" };
  return { transaction: match };
}

/** Platform and provider values for report_orders from a RevenueCat store name. */
function orderPlatformForStore(store) {
  const s = String(store || "").toUpperCase();
  if (s === "APP_STORE" || s === "MAC_APP_STORE") return "IOS";
  if (s === "PLAY_STORE") return "ANDROID";
  return "TEST";
}

module.exports = {
  API_BASE,
  sandboxAllowed,
  webhookAuthorized,
  storeProductIds,
  productForStoreId,
  fetchSubscriber,
  oneTimeTransactions,
  findPaymentTransaction,
  orderPlatformForStore,
};
