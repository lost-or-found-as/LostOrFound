"use strict";
// T1.9AE: store purchases through RevenueCat (server confirmation, webhook, refunds, sync) and
// the app side (buy, confirm, cancel), plus Stripe removed from the app config.
//   node .\scripts\test-t1-9ae.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};
const eq = (a, b, label) => {
  assert.deepStrictEqual(a, b, `${label}: got ${JSON.stringify(a)}`);
  n++;
};

// A tiny Supabase stand-in: records updates and answers selects from a table map.
function fakeDb(tables, { claimError = null } = {}) {
  const log = [];
  const from = (table) => {
    const state = { table, op: "select", filters: [], patch: null };
    const api = {
      select() { return api; },
      update(patch) { state.op = "update"; state.patch = patch; return api; },
      insert(row) { state.op = "insert"; state.patch = row; return api; },
      eq(col, val) { state.filters.push([col, val]); return api; },
      is(col, val) { state.filters.push([col, val]); return api; },
      in(col, vals) { state.filters.push([col, vals]); return api; },
      not() { return api; },
      order() { return api; },
      limit() { return api; },
      async maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); },
    };
    const match = (row) => state.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(row[c]) : row[c] === v));
    async function run(single) {
      log.push({ table, op: state.op, filters: state.filters, patch: state.patch });
      const rows = (tables[table] || []).filter(match);
      if (state.op === "update") {
        if (table === "report_orders" && claimError && state.patch.provider_transaction_id) return { data: null, error: claimError };
        rows.forEach((r) => Object.assign(r, state.patch));
        return { data: single ? rows[0] || null : rows, error: null };
      }
      return { data: single ? rows[0] || null : rows, error: null };
    }
    return api;
  };
  return { from, log };
}

(async () => {
  // 1. RevenueCat helpers.
  const rc = require(path.join(root, "server/lib/revenueCat.js"));
  const env = { REVENUECAT_WEBHOOK_AUTH: "Bearer s3cret" };
  ok(rc.webhookAuthorized("Bearer s3cret", env), "right webhook header accepted");
  ok(!rc.webhookAuthorized("Bearer wrong!", env) && !rc.webhookAuthorized("", env) && !rc.webhookAuthorized("x", {}), "wrong or missing header refused");
  eq(rc.storeProductIds({ apple_product_id: "lof_a", google_product_id: "lof_a" }), ["lof_a", "lof_a"], "store ids from catalog");
  eq(rc.productForStoreId([{ code: "X", apple_product_id: "lof_x" }], "lof_x").code, "X", "catalog lookup by store id");
  eq([rc.orderPlatformForStore("APP_STORE"), rc.orderPlatformForStore("PLAY_STORE"), rc.orderPlatformForStore("TEST_STORE")], ["IOS", "ANDROID", "TEST"], "platform from store");
  const subscriber = {
    non_subscriptions: {
      lof_extension_30d: [{ id: "rc1", store_transaction_id: "2000001", purchase_date: "2026-11-12T10:00:00Z", store: "app_store", is_sandbox: false }],
      lof_area_alert_1km: [{ id: "rc2", store_transaction_id: "GPA.1", store: "play_store", is_sandbox: true }],
    },
  };
  eq(rc.oneTimeTransactions(subscriber).length, 2, "flattened transactions");
  eq(rc.findPaymentTransaction(subscriber, { productIds: ["lof_extension_30d"], transactionId: "2000001", allowSandbox: false }).transaction.store, "APP_STORE", "valid transaction found");
  eq(rc.findPaymentTransaction(subscriber, { productIds: ["lof_historic_1y"], transactionId: "2000001" }).error, "TRANSACTION_PRODUCT_MISMATCH", "transaction for another product refused");
  eq(rc.findPaymentTransaction(subscriber, { productIds: ["lof_area_alert_1km"], transactionId: "GPA.1", allowSandbox: false }).error, "SANDBOX_PURCHASE_NOT_ALLOWED", "sandbox refused in production");
  ok(!!rc.findPaymentTransaction(subscriber, { productIds: ["lof_area_alert_1km"], transactionId: "GPA.1", allowSandbox: true }).transaction, "sandbox accepted on staging");
  eq(rc.findPaymentTransaction(subscriber, { productIds: ["lof_extension_30d"], transactionId: "nope" }).error, "TRANSACTION_NOT_FOUND", "unknown transaction refused");
  eq(rc.findPaymentTransaction(subscriber, { productIds: ["lof_extension_30d"], transactionId: "" }).error, "TRANSACTION_ID_REQUIRED", "transaction id required");
  let calledUrl = null;
  const sub = await rc.fetchSubscriber("user-1", {
    env: { REVENUECAT_SECRET_API_KEY: "sk_test" },
    fetchImpl: async (url, init) => {
      calledUrl = url;
      assert.strictEqual(init.headers.Authorization, "Bearer sk_test");
      return { ok: true, json: async () => ({ subscriber }) };
    },
  });
  ok(calledUrl === "https://api.revenuecat.com/v1/subscribers/user-1" && !!sub.non_subscriptions, "subscriber fetched with the secret key");
  await assert.rejects(() => rc.fetchSubscriber("u", { env: {} }), (e) => e.code === "REVENUECAT_NOT_CONFIGURED");
  n++;

  // 2. Paying an order with a transaction.
  const { payOrderWithTransaction } = require(path.join(root, "server/lib/storePurchase.js"));
  const freshOrder = (id) => ({ id, user_id: "u1", status: "PENDING", provider: "TEST", provider_transaction_id: null, price_snapshot: {} });
  const order = freshOrder("o1");
  const db = fakeDb({ report_orders: [order] });
  let activated = null;
  const activateOrder = async (args) => {
    activated = args;
    return { status: 200, body: { order: { id: args.order.id, status: "ACTIVE" } } };
  };
  const tx = { transactionId: "2000001", store: "APP_STORE", purchasedAt: "2026-11-12T10:00:00Z", sandbox: false };
  const r1 = await payOrderWithTransaction({ supaAdmin: db, activateOrder }, { order, userId: "u1", transaction: tx, platform: "IOS" });
  eq(r1.status, 200, "order paid and activated");
  ok(activated.provider === "REVENUECAT" && activated.providerTransactionId === "2000001", "activation as REVENUECAT with the store transaction");
  const claim = db.log.find((x) => x.op === "update");
  ok(claim.filters.some(([c, v]) => c === "provider_transaction_id" && v === null), "transaction claimed only on an order without one");
  eq(claim.patch.platform, "IOS", "platform stored");
  const dup = await payOrderWithTransaction(
    { supaAdmin: fakeDb({ report_orders: [freshOrder("o2")] }, { claimError: { code: "23505" } }), activateOrder },
    { order: freshOrder("o2"), userId: "u1", transaction: tx, platform: "IOS" },
  );
  eq(dup.body.error, "TRANSACTION_ALREADY_USED", "one transaction never pays two orders");
  const closed = await payOrderWithTransaction({ supaAdmin: fakeDb({}), activateOrder }, { order: { ...freshOrder("o3"), status: "EXPIRED" }, userId: "u1", transaction: tx, platform: "IOS" });
  eq(closed.status, 409, "closed order is not paid");

  // 3. Refunds end the service.
  const { applyRefund } = require(path.join(root, "server/lib/storeRefund.js"));
  const tables = {
    report_orders: [{ id: "o9", provider: "REVENUECAT", provider_transaction_id: "T9", status: "ACTIVE", entitlement_id: "e9" }],
    report_entitlements: [{ id: "e9", status: "ACTIVE" }],
    long_term_watches: [{ entitlement_id: "e9", status: "ACTIVE" }],
    geo_alert_campaigns: [{ order_id: "o9", status: "ACTIVE" }],
  };
  const refundDb = fakeDb(tables);
  eq((await applyRefund(refundDb, { transactionId: "T9", reason: "CUSTOMER_SUPPORT" })).orderId, "o9", "refund finds the order");
  eq([tables.report_orders[0].status, tables.report_entitlements[0].status, tables.long_term_watches[0].status, tables.geo_alert_campaigns[0].status],
    ["REFUNDED", "REFUNDED", "CANCELLED", "CANCELLED"], "order, entitlement, watch and campaign end");
  ok((await applyRefund(refundDb, { transactionId: "T9" })).alreadyRefunded, "second refund changes nothing");
  eq((await applyRefund(fakeDb({ report_orders: [] }), { transactionId: "X" })).orderId, null, "unknown transaction ignored");

  // 4. Routes and wiring (static).
  const routes = read("server/routes/reportCommerce.js");
  ok(/router\.post\("\/orders\/:id\/confirm-purchase", requireUser/.test(routes), "confirm route needs a user");
  ok(/revenueCat\.fetchSubscriber\(userId\)/.test(routes), "server looks the purchase up itself");
  ok(/router\.post\("\/purchases\/sync", requireUser/.test(routes), "sync route");
  ok(/provider_product_id: storeProductId/.test(routes) && /product\.apple_product_id/.test(routes), "order names the store product");
  ok(/async function activateOrder\(\{ order, userId, provider, providerTransactionId, metadata = \{\} \}\)/.test(routes), "one shared activation path");
  ok((routes.match(/activateOrder\(\{/g) || []).length >= 2, "test activation uses the shared path");
  const hook = read("server/routes/revenueCatWebhook.js");
  ok(/webhookAuthorized\(req\.header\("Authorization"\)\)/.test(hook) && /status\(401\)/.test(hook), "webhook checks the shared secret");
  ok(/"NON_RENEWING_PURCHASE"/.test(hook) && /"CANCELLATION"/.test(hook), "purchase and refund events handled");
  ok(/payment_webhook_events/.test(hook) && /"23505"/.test(hook), "each event stored once");
  ok(/app\.use\("\/revenuecat", revenueCatWebhookRoutes\)/.test(read("server/index.js")), "webhook mounted");
  ok(!/sk_|REVENUECAT_SECRET/.test(read("src/lib/storePurchases.ts")), "no secret in the app");

  // 5. Store product ids for every active paid product.
  const mig = read("supabase/migrations/20261112100000_t1_9ae_store_product_ids.sql");
  const codes = ["REPORT_REACTIVATION", "GEO_ALERT_TIER_1", "GEO_ALERT_TIER_2", "GEO_ALERT_TIER_3"];
  for (const y of [1, 2, 3]) for (const c of ["", "_C1", "_C2"]) codes.push(`LONG_TERM_WATCH_${y}Y${c}`);
  const ids = [...mig.matchAll(/\('([A-Z0-9_]+)',\s+'([a-z0-9_]+)'\)/g)].map((m) => [m[1], m[2]]);
  eq(ids.map((x) => x[0]).sort(), [...codes].sort(), "every active paid product has a store id");
  eq(new Set(ids.map((x) => x[1])).size, ids.length, "store ids are unique");
  ok(ids.every(([, id]) => /^[a-z][a-z0-9_]{2,99}$/.test(id)), "ids valid in both stores");

  // 6. App: buy, confirm, cancel.
  const purchases = {
    PRODUCT_CATEGORY: { NON_SUBSCRIPTION: "NON_SUBSCRIPTION" },
    configured: false,
    user: null,
    async isConfigured() { return this.configured; },
    configure({ apiKey, appUserID }) { this.configured = true; this.user = appUserID; this.key = apiKey; },
    async getAppUserID() { return this.user; },
    async logIn(id) { this.user = id; },
    async getProducts(ids) { return ids.includes("lof_extension_30d") ? [{ identifier: "lof_extension_30d" }] : []; },
    async purchaseStoreProduct(p) {
      if (this.cancel) throw Object.assign(new Error("cancelled"), { code: "1", userCancelled: true });
      return { transaction: { transactionIdentifier: "2000001", productIdentifier: p.identifier } };
    },
  };
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = "test_abc";
  const store = requireTs(path.join(root, "src/lib/storePurchases.ts"), {
    "react-native": { Platform: { OS: "ios" } },
    "expo-constants": { default: {} },
    "react-native-purchases": { default: purchases },
  });
  eq(await store.buyStoreProduct("user-7", "lof_extension_30d"), "2000001", "app returns the store transaction");
  ok(purchases.user === "user-7" && purchases.key === "test_abc", "RevenueCat signed in as the app user");
  await store.buyStoreProduct("user-8", "lof_extension_30d");
  eq(purchases.user, "user-8", "switching account logs RevenueCat in again");
  await assert.rejects(() => store.buyStoreProduct("user-8", "missing"), (e) => e.code === "STORE_PRODUCT_NOT_FOUND");
  purchases.cancel = true;
  await assert.rejects(() => store.buyStoreProduct("user-8", "lof_extension_30d"), (e) => e.code === "PURCHASE_CANCELLED");
  n += 2;
  eq([store.mapStoreError({ code: "20" }), store.mapStoreError({ code: "16" }), store.mapStoreError({ code: "99" })], ["PURCHASE_PENDING", "STORE_NOT_READY", "PURCHASE_FAILED"], "store errors mapped");

  const commerce = read("src/lib/reportCommerce.ts");
  ok(/if \(amount === 0 \|\| !storeProductId\) return activateTestReportOrder\(order\.id\)/.test(commerce), "free and test orders skip the store");
  ok(/PURCHASE_NOT_CONFIRMED/.test(commerce) && /"TRANSACTION_NOT_FOUND"/.test(commerce), "confirmation retried, then left to webhook/sync");
  const lifecycle = read("src/lib/reportLifecycle.ts");
  eq((lifecycle.match(/completeReportOrder\(created\.order\)/g) || []).length, 2, "extension and historic case use the store flow");
  ok(/completeReportOrder\(created\.order\)/.test(read("app/geo-alert-create.tsx")), "area alert uses the store flow");
  ok(/"PURCHASE_CANCELLED"\) return;/.test(read("app/geo-alert-create.tsx")), "cancelling shows no error");
  ok(/syncStorePurchases\(\)/.test(read("app/premium-status.tsx")), "restore syncs purchases with the server");
  ok(/signOutStore\(\)/.test(read("src/contexts/AuthContext.tsx")), "store account signs out with the app");

  // 7. Texts and Stripe removal.
  const no = read("src/i18n/locales/no.ts");
  const en = read("src/i18n/locales/en.ts");
  for (const k of ["purchase.errorTitle", "purchase.pendingBody", "purchase.productMissingBody", "purchase.notConfirmedBody", "purchase.failedBody", "purchases.syncNothing", "purchases.syncActivated", "purchases.syncActivated_one"])
    ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);
  ok(!/stripe-react-native/.test(read("app.json")), "Stripe plugin removed from app config");

  console.log(`OK: T1.9AE store purchase checks passed (${n} assertions).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
