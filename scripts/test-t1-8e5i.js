"use strict";
// T1.8E.5I behavior test.
//  A. Backend: GET /report-commerce/reports/:reportId/geo-alert-status (real route handler,
//     in-memory Supabase stand-in).
//  B. App helpers: src/lib/areaAlertStatus.ts (status -> card state, error classification,
//     date and radius formatting).
// No network, no database and no installed server dependencies are needed.
//
// Run from the repository root:
//   node .\scripts\test-t1-8e5i.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = process.cwd();
const USER = "aaaaaaaa-1111-1111-1111-111111111111";
const REPORT = "rrrrrrrr-0000-0000-0000-000000000001";

// ---------------------------------------------------------------- load the TypeScript helper
// T1.9E: the helper now formats through src/i18n, so it is loaded with its imports.
const { requireTs, EXPO_LOCALIZATION_STUB_OBJECT } = require("./lib/ts-modules");
const helpers = requireTs(path.join(root, "src", "lib", "areaAlertStatus.ts"), {
  "expo-localization": EXPO_LOCALIZATION_STUB_OBJECT,
});

// ---------------------------------------------------------------- backend stand-ins
const fixture = { state: null, entitlements: [], campaigns: [], reportOwner: USER, failState: false };

function query(table) {
  const st = { filters: [] };
  const run = () => {
    let rows = [];
    if (table === "reports")
      rows = [{ id: REPORT, user_id: fixture.reportOwner, deleted_at: null, type: "LOST" }];
    if (table === "report_entitlements") rows = fixture.entitlements.map((r) => ({ ...r }));
    if (table === "geo_alert_campaigns") rows = fixture.campaigns.map((r) => ({ ...r }));
    rows = rows.filter((r) => st.filters.every(([kind, k, v]) => {
      if (kind === "eq") return String(r[k]) === String(v);
      if (kind === "is") return (r[k] ?? null) === v;
      if (kind === "in") return v.map(String).includes(String(r[k]));
      if (kind === "like") return new RegExp(`^${String(v).replace(/%/g, ".*").replace(/_/g, ".")}$`).test(String(r[k] ?? ""));
      return true;
    }));
    if (st.order) rows.sort((a, b) => String(a[st.order]).localeCompare(String(b[st.order])));
    return { data: rows, error: null };
  };
  const b = {
    select() { return b; },
    eq(k, v) { st.filters.push(["eq", k, v]); return b; },
    is(k, v) { st.filters.push(["is", k, v]); return b; },
    in(k, v) { st.filters.push(["in", k, v]); return b; },
    like(k, v) { st.filters.push(["like", k, v]); return b; },
    order(k) { st.order = k; return b; },
    limit() { return b; },
    maybeSingle: () => { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
  };
  return b;
}
const supaAdmin = {
  from: (t) => query(t),
  rpc: async (name) => {
    if (name === "geo_alert_activation_state") {
      if (fixture.failState) return { data: null, error: { code: "XX000", message: "simulated" } };
      return { data: [fixture.state], error: null };
    }
    return { data: null, error: { message: `UNKNOWN_RPC ${name}` } };
  },
};

const routes = {};
const fakeExpress = () => ({});
fakeExpress.Router = () => {
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  return { get: reg("GET"), post: reg("POST"), put: reg("PUT"), patch: reg("PATCH"), delete: reg("DELETE"), use() {} };
};
const stubs = {
  [path.join(root, "server", "supabaseClient.js")]: { supaAdmin },
  [path.join(root, "server", "mw", "auth.js")]: { requireUser: (req, res, next) => next() },
  [path.join(root, "server", "lib", "geoAlertDispatch.js")]: { dispatchAreaAlertCampaign: async () => ({ ok: true }) },
};
const originalLoad = Module._load;
Module._load = function (request, parent) {
  if (request === "express") return fakeExpress;
  if (parent && (request.startsWith("./") || request.startsWith("../"))) {
    const resolved = path.resolve(path.dirname(parent.filename), request);
    for (const c of [resolved, `${resolved}.js`]) if (stubs[c]) return stubs[c];
  }
  return originalLoad.apply(this, arguments);
};
require(path.join(root, "server", "routes", "reportCommerce.js"));
Module._load = originalLoad;
const statusRoute = routes["GET /reports/:reportId/geo-alert-status"];

async function callStatus(reportId = REPORT) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await statusRoute({ params: { reportId }, user: { id: USER } }, res);
  return res;
}

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();

// ---------------------------------------------------------------- scenarios
const results = [];
async function scenario(name, fn) {
  const keep = { info: console.info, error: console.error };
  console.info = console.error = () => {};
  fixture.failState = false; fixture.reportOwner = USER; fixture.entitlements = []; fixture.campaigns = [];
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
  finally { Object.assign(console, keep); }
}

(async () => {
  await scenario("Status route is registered", async () => {
    assert.ok(statusRoute, "GET /reports/:reportId/geo-alert-status missing");
  });

  await scenario("No activation -> canOrder, card hidden (kind none)", async () => {
    fixture.state = { active_until: null, activation_count: 0, max_activations: 2 };
    const r = await callStatus();
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.canOrder, true);
    assert.strictEqual(r.body.remaining, 2);
    assert.strictEqual(helpers.deriveAreaAlertView(r.body).kind, "none");
  });

  await scenario("Live alert -> canOrder false, radius from campaign, day 2 of 7 with 6 days left", async () => {
    const start = now - 1.5 * DAY, end = start + 7 * DAY;
    fixture.state = { active_until: iso(end), activation_count: 1, max_activations: 2 };
    fixture.entitlements = [{ id: "e1", report_id: REPORT, order_id: "o1", product_code: "GEO_ALERT_TIER_3", status: "ACTIVE", starts_at: iso(start), current_period_end: iso(end) }];
    fixture.campaigns = [{ id: "c1", order_id: "o1", radius_m: 3000 }];
    const r = await callStatus();
    assert.strictEqual(r.body.canOrder, false);
    assert.strictEqual(r.body.activations.length, 1);
    assert.strictEqual(r.body.activations[0].live, true);
    assert.strictEqual(r.body.activations[0].radiusM, 3000);
    const v = helpers.deriveAreaAlertView(r.body, new Date(now));
    assert.strictEqual(v.kind, "live");
    assert.strictEqual(v.totalDays, 7);
    assert.strictEqual(v.dayNumber, 2);
    assert.strictEqual(v.daysLeft, 6);
  });

  await scenario("Expired but still ACTIVE in the database -> not live (time decides), one left", async () => {
    const start = now - 10 * DAY, end = start + 7 * DAY;
    fixture.state = { active_until: null, activation_count: 1, max_activations: 2 };
    fixture.entitlements = [{ id: "e1", report_id: REPORT, order_id: "o1", product_code: "GEO_ALERT_TIER_2", status: "ACTIVE", starts_at: iso(start), current_period_end: iso(end) }];
    const r = await callStatus();
    assert.strictEqual(r.body.activations[0].live, false);
    assert.strictEqual(r.body.canOrder, true);
    assert.strictEqual(helpers.deriveAreaAlertView(r.body).kind, "available");
  });

  await scenario("Two used, none live -> completed, history in order, cancelled rows ignored", async () => {
    fixture.state = { active_until: null, activation_count: 2, max_activations: 2 };
    fixture.entitlements = [
      { id: "e2", report_id: REPORT, order_id: "o2", product_code: "GEO_ALERT_TIER_2", status: "EXPIRED", starts_at: iso(now - 9 * DAY), current_period_end: iso(now - 2 * DAY) },
      { id: "e1", report_id: REPORT, order_id: "o1", product_code: "GEO_ALERT_TIER_3", status: "EXPIRED", starts_at: iso(now - 20 * DAY), current_period_end: iso(now - 13 * DAY) },
      { id: "ex", report_id: REPORT, order_id: "ox", product_code: "GEO_ALERT_TIER_1", status: "CANCELLED", starts_at: iso(now - 9 * DAY), current_period_end: iso(now - 2 * DAY) },
      { id: "rr", report_id: REPORT, order_id: "or", product_code: "REPORT_REACTIVATION", status: "ACTIVE", starts_at: iso(now), current_period_end: iso(now + DAY) },
    ];
    fixture.campaigns = [{ id: "c1", order_id: "o1", radius_m: 3000 }, { id: "c2", order_id: "o2", radius_m: 1500 }];
    const r = await callStatus();
    assert.strictEqual(r.body.activations.length, 2, "cancelled or other products included");
    assert.deepStrictEqual(r.body.activations.map((a) => a.radiusM), [3000, 1500]);
    assert.strictEqual(r.body.canOrder, false);
    assert.strictEqual(helpers.deriveAreaAlertView(r.body).kind, "completed");
  });

  await scenario("Not the owner -> 404 REPORT_NOT_FOUND", async () => {
    fixture.reportOwner = "someone-else";
    fixture.state = { active_until: null, activation_count: 0, max_activations: 2 };
    const r = await callStatus();
    assert.strictEqual(r.statusCode, 404);
    assert.strictEqual(r.body.error, "REPORT_NOT_FOUND");
  });

  await scenario("Database error -> 500 GEO_ALERT_STATUS_FAILED (no internal message leaked)", async () => {
    fixture.failState = true;
    const r = await callStatus();
    assert.strictEqual(r.statusCode, 500);
    assert.deepStrictEqual(r.body, { error: "GEO_ALERT_STATUS_FAILED" });
  });

  await scenario("Error classification: rule codes, network, server, auth, unknown", async () => {
    const c = helpers.classifyAreaAlertError;
    const e = (message, extra) => Object.assign(new Error(message), extra || {});
    assert.deepStrictEqual(c(e("GEO_ALERT_ALREADY_ACTIVE", { code: "GEO_ALERT_ALREADY_ACTIVE", status: 409 })), { kind: "alreadyActive", code: "GEO_ALERT_ALREADY_ACTIVE", retryable: false });
    assert.strictEqual(c(e("GEO_ALERT_LIMIT_REACHED", { status: 409 })).kind, "limitReached");
    assert.strictEqual(c(Object.assign(new TypeError("Network request failed"))).kind, "network");
    assert.strictEqual(c(e("Network request failed")).retryable, true);
    assert.strictEqual(c(e("HTTP_502", { status: 502 })).kind, "service");
    assert.strictEqual(c(e("HTTP_503_INVALID_RESPONSE")).kind, "service");
    assert.strictEqual(c(e("AUTH_REQUIRED")).kind, "auth");
    assert.strictEqual(c(e("Invalid token", { status: 401 })).kind, "auth");
    assert.strictEqual(c(e("PRODUCT_NOT_AVAILABLE")).kind, "notAvailable");
    assert.strictEqual(c(e("GEO_ALERT_REPORT_LOCATION_REQUIRED")).kind, "locationRequired");
    assert.strictEqual(c(e("SOMETHING_NEW")).kind, "unknown");
  });

  await scenario("Formatting: Norwegian and English date and radius labels", async () => {
    const d = new Date(2026, 9, 27, 13, 40).toISOString();
    assert.deepStrictEqual(helpers.areaAlertDateParts(d, "no"), { date: "27. okt.", time: "13:40" });
    assert.deepStrictEqual(helpers.areaAlertDateParts(d, "en"), { date: "27 Oct", time: "13:40" });
    assert.deepStrictEqual(helpers.areaAlertDateParts(null, "no"), { date: "", time: "" });
    assert.strictEqual(helpers.areaAlertRadiusLabel(500, "no"), "500 m");
    assert.strictEqual(helpers.areaAlertRadiusLabel(1500, "no"), "1,5 km");
    assert.strictEqual(helpers.areaAlertRadiusLabel(1500, "en"), "1.5 km");
    assert.strictEqual(helpers.areaAlertRadiusLabel(3000, "no"), "3 km");
  });

  await scenario("Last day shows 1 day left; progress stays within 0..1", async () => {
    const start = now - 6.5 * DAY, end = start + 7 * DAY;
    const v = helpers.deriveAreaAlertView({ activeUntil: iso(end), activationCount: 2, maxActivations: 2, remaining: 0, canOrder: false,
      activations: [{ startsAt: iso(start), endsAt: iso(end), live: true, radiusM: 1000 }] }, new Date(now));
    assert.strictEqual(v.kind, "live");
    assert.strictEqual(v.daysLeft, 1);
    assert.strictEqual(v.dayNumber, 7);
    assert.ok(v.progress > 0.9 && v.progress <= 1);
  });

  for (const [s, n, m] of results) console.log(`${s}: ${n}${m ? ` -> ${m}` : ""}`);
  const failed = results.filter((r) => r[0] === "FAIL").length;
  if (failed) {
    console.error(`FAILED: ${failed} of ${results.length} T1.8E.5I behavior scenarios.`);
    process.exit(1);
  }
  console.log(`OK: ${results.length} T1.8E.5I behavior scenarios passed.`);
})();
