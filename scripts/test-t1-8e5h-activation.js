"use strict";
// T1.8E.5H behavior test.
// Loads the real server/routes/reportCommerce.js and calls its route handlers directly.
// Express, Supabase, auth and dispatch are replaced by in-memory stand-ins, so the test
// needs no network, no database and no installed server dependencies.
//
// Run from the repository root:
//   node .\scripts\test-t1-8e5h-activation.js

const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = process.cwd();
const USER = "aaaaaaaa-1111-1111-1111-111111111111";
process.env.GEO_ALERT_TEST_MODE = "true";
process.env.GEO_ALERT_TEST_USER_IDS = USER;
process.env.REPORT_COMMERCE_TEST_MODE = "true";
process.env.REPORT_COMMERCE_TEST_USER_IDS = USER;

// ---------------------------------------------------------------- in-memory tables
const REPORT = "rrrrrrrr-0000-0000-0000-000000000001";
const db = {
  reports: [{ id: REPORT, user_id: USER, type: "LOST", lat: 59.9, lng: 10.7, deleted_at: null, title: "Wallet" }],
  product_catalog: ["GEO_ALERT_TIER_1", "GEO_ALERT_TIER_2", "GEO_ALERT_TIER_3", "GEO_ALERT_TIER_4",
    "GEO_ALERT_TIER_5", "GEO_ALERT_TIER_6", "REPORT_REACTIVATION"].map((code) => ({
    code, active: true, base_price_ore: 4900, currency: "NOK",
  })),
  report_orders: [],
  report_entitlements: [],
  geo_alert_campaigns: [],
  long_term_watches: [],
};
const calls = { rpc: [], dispatch: [] };
const behavior = {
  state: { active_until: null, activation_count: 0, max_activations: 2 },
  createEntitlementError: null,
  campaignInsertError: null,
};
let seq = 1;
const newId = (p) => `${p}-${String(seq++).padStart(4, "0")}`;

function likeToRegex(pattern) {
  return new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`);
}

function query(table) {
  const st = { op: "select", filters: [], payload: null };
  const rows = () => db[table] || (db[table] = []);
  const matches = (r) => st.filters.every(([kind, k, v]) => {
    if (kind === "eq") return String(r[k]) === String(v);
    if (kind === "neq") return String(r[k]) !== String(v);
    if (kind === "is") return (r[k] ?? null) === v;
    if (kind === "like") return likeToRegex(v).test(String(r[k] ?? ""));
    return true;
  });
  const run = () => {
    if (st.op === "insert") {
      if (table === "geo_alert_campaigns" && behavior.campaignInsertError)
        return { data: null, error: behavior.campaignInsertError };
      const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({ id: newId(table), ...p }));
      rows().push(...list);
      return { data: list, error: null };
    }
    if (st.op === "update") {
      const hit = rows().filter(matches);
      hit.forEach((r) => Object.assign(r, st.payload));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (st.op === "upsert") { rows().push({ id: newId(table), ...st.payload }); return { data: null, error: null }; }
    return { data: rows().filter(matches).map((r) => ({ ...r })), error: null };
  };
  const one = (strict) => {
    const r = run();
    if (r.error) return Promise.resolve({ data: null, error: r.error });
    const list = Array.isArray(r.data) ? r.data : [];
    if (list.length > 1) return Promise.resolve({ data: null, error: { code: "PGRST116", message: "multiple rows" } });
    if (strict && !list.length) return Promise.resolve({ data: null, error: { code: "PGRST116", message: "no rows" } });
    return Promise.resolve({ data: list[0] || null, error: null });
  };
  const b = {
    select() { return b; },
    insert(p) { st.op = "insert"; st.payload = p; return b; },
    update(p) { st.op = "update"; st.payload = p; return b; },
    upsert(p) { st.op = "upsert"; st.payload = p; return b; },
    eq(k, v) { st.filters.push(["eq", k, v]); return b; },
    neq(k, v) { st.filters.push(["neq", k, v]); return b; },
    is(k, v) { st.filters.push(["is", k, v]); return b; },
    like(k, v) { st.filters.push(["like", k, v]); return b; },
    order() { return b; },
    limit() { return b; },
    maybeSingle: () => one(false),
    single: () => one(true),
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
  };
  return b;
}

const supaAdmin = {
  from: (t) => query(t),
  rpc: async (name, args) => {
    calls.rpc.push(name);
    if (name === "preview_geo_alert_audience")
      return { data: [{ area_sq_km: 7.07, eligible_users: 3, eligible_installations: 2 }], error: null };
    if (name === "geo_alert_activation_state") return { data: [{ ...behavior.state }], error: null };
    if (name === "geo_alert_create_entitlement") {
      if (behavior.createEntitlementError) return { data: null, error: behavior.createEntitlementError };
      const order = db.report_orders.find((o) => o.id === args.p_order_id);
      const row = {
        id: newId("ent"), user_id: args.p_user_id, report_id: order.report_id, product_code: order.product_code,
        order_id: order.id, status: "ACTIVE", starts_at: args.p_starts_at, current_period_end: args.p_period_end,
      };
      db.report_entitlements.push(row);
      return { data: [row], error: null };
    }
    if (name === "refresh_matches_for_report") return { data: null, error: null };
    return { data: null, error: { message: `UNKNOWN_RPC ${name}` } };
  },
  auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
};

// ---------------------------------------------------------------- module stand-ins
const routes = {};
const fakeExpress = () => ({});
fakeExpress.Router = () => {
  const reg = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; };
  return { get: reg("GET"), post: reg("POST"), put: reg("PUT"), patch: reg("PATCH"), delete: reg("DELETE"), use() {} };
};
const stubs = {
  express: fakeExpress,
  [path.join(root, "server", "supabaseClient.js")]: { supaAdmin },
  [path.join(root, "server", "mw", "auth.js")]: { requireUser: (req, res, next) => next() },
  [path.join(root, "server", "lib", "geoAlertDispatch.js")]: {
    dispatchAreaAlertCampaign: async (campaignId) => {
      calls.dispatch.push(campaignId);
      return { ok: true, eligible: 3, sent: 2 };
    },
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "express") return stubs.express;
  if (parent && (request.startsWith("./") || request.startsWith("../"))) {
    const resolved = path.resolve(path.dirname(parent.filename), request);
    for (const candidate of [resolved, `${resolved}.js`]) if (stubs[candidate]) return stubs[candidate];
  }
  return originalLoad.apply(this, arguments);
};

require(path.join(root, "server", "routes", "reportCommerce.js"));
const createOrder = routes["POST /orders"];
const testActivate = routes["POST /orders/:id/test-activate"];
assert.ok(createOrder && testActivate, "routes not registered");

async function call(handler, { body = {}, params = {} } = {}) {
  const res = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler({ body, params, user: { id: USER }, header: () => "" }, res);
  return res;
}

let rid = 0;
const geoOrderBody = (radiusM) => ({
  reportId: REPORT, productCode: "GEO_ALERT", clientRequestId: `t1-8e5h-request-${++rid}-xxxx`,
  geoAlert: { radiusM, populationDensityBand: "LOW" },
});
function addOrder(productCode, status = "PENDING") {
  const o = { id: newId("ord"), user_id: USER, report_id: REPORT, product_code: productCode, status,
    request_payload: { geoAlert: { radiusM: 1500, areaSqKm: 7.07 } }, price_snapshot: {} };
  db.report_orders.push(o);
  return o;
}
function reset() {
  db.report_orders.length = 0; db.report_entitlements.length = 0; db.geo_alert_campaigns.length = 0;
  calls.rpc.length = 0; calls.dispatch.length = 0;
  behavior.state = { active_until: null, activation_count: 0, max_activations: 2 };
  behavior.createEntitlementError = null; behavior.campaignInsertError = null;
}

// ---------------------------------------------------------------- scenarios
const results = [];
async function scenario(name, fn) {
  reset();
  const keep = { info: console.info, error: console.error, warn: console.warn };
  console.info = console.error = console.warn = () => {};
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
  finally { Object.assign(console, keep); }
}

(async () => {
  await scenario("Order while an area alert is live -> 409 GEO_ALERT_ALREADY_ACTIVE, no order row", async () => {
    behavior.state = { active_until: "2026-11-03T12:40:14Z", activation_count: 1, max_activations: 2 };
    const r = await call(createOrder, { body: geoOrderBody(1500) });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.body.error, "GEO_ALERT_ALREADY_ACTIVE");
    assert.strictEqual(r.body.activeUntil, "2026-11-03T12:40:14Z");
    assert.strictEqual(db.report_orders.length, 0);
  });

  await scenario("Order with a different radius while live is also blocked (rule 1 ignores tier)", async () => {
    behavior.state = { active_until: "2026-11-03T12:40:14Z", activation_count: 1, max_activations: 2 };
    const r = await call(createOrder, { body: geoOrderBody(3000) });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.body.error, "GEO_ALERT_ALREADY_ACTIVE");
  });

  await scenario("Order after two activations -> 409 GEO_ALERT_LIMIT_REACHED", async () => {
    behavior.state = { active_until: null, activation_count: 2, max_activations: 2 };
    const r = await call(createOrder, { body: geoOrderBody(1500) });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.body.error, "GEO_ALERT_LIMIT_REACHED");
    assert.strictEqual(db.report_orders.length, 0);
  });

  await scenario("Order allowed when nothing is live and fewer than two activations -> 201", async () => {
    behavior.state = { active_until: null, activation_count: 1, max_activations: 2 };
    const r = await call(createOrder, { body: geoOrderBody(1500) });
    assert.strictEqual(r.statusCode, 201);
    assert.ok(String(r.body.order.product_code).startsWith("GEO_ALERT_TIER_"));
    assert.strictEqual(db.report_orders.length, 1);
  });

  await scenario("Activation rejected by the database -> 409, no campaign, no dispatch", async () => {
    const o = addOrder("GEO_ALERT_TIER_2");
    behavior.createEntitlementError = { code: "P0001", message: "GEO_ALERT_ALREADY_ACTIVE", details: "2026-11-03T12:40:14Z" };
    const r = await call(testActivate, { params: { id: o.id } });
    assert.strictEqual(r.statusCode, 409);
    assert.deepStrictEqual(r.body, { error: "GEO_ALERT_ALREADY_ACTIVE", activeUntil: "2026-11-03T12:40:14Z" });
    assert.strictEqual(db.geo_alert_campaigns.length, 0);
    assert.strictEqual(calls.dispatch.length, 0);
    assert.strictEqual(db.report_orders[0].status, "PENDING");
  });

  await scenario("Limit rejection and exclusion-constraint race both map to 409", async () => {
    const o = addOrder("GEO_ALERT_TIER_2");
    behavior.createEntitlementError = { code: "P0001", message: "GEO_ALERT_LIMIT_REACHED", details: "2" };
    let r = await call(testActivate, { params: { id: o.id } });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.body.error, "GEO_ALERT_LIMIT_REACHED");
    behavior.createEntitlementError = { code: "23P01", message: "conflicting key value violates exclusion constraint" };
    r = await call(testActivate, { params: { id: o.id } });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.body.error, "GEO_ALERT_ALREADY_ACTIVE");
    assert.strictEqual(calls.dispatch.length, 0);
  });

  await scenario("Successful activation: guarded entitlement, NEW campaign, dispatch, cross-tier supersede", async () => {
    const previousGeo = addOrder("GEO_ALERT_TIER_3", "ACTIVE");
    const unrelated = addOrder("REPORT_REACTIVATION", "ACTIVE");
    db.geo_alert_campaigns.push({ id: "old-campaign", report_id: REPORT, status: "COMPLETED" });
    const o = addOrder("GEO_ALERT_TIER_2");
    const r = await call(testActivate, { params: { id: o.id } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.ok(calls.rpc.includes("geo_alert_create_entitlement"));
    const created = db.geo_alert_campaigns.filter((c) => c.order_id === o.id);
    assert.strictEqual(created.length, 1, "expected one new campaign for this order");
    assert.notStrictEqual(created[0].id, "old-campaign");
    assert.strictEqual(db.geo_alert_campaigns.find((c) => c.id === "old-campaign").status, "COMPLETED");
    assert.deepStrictEqual(calls.dispatch, [created[0].id]);
    assert.strictEqual(r.body.campaignId, created[0].id);
    assert.strictEqual(db.report_orders.find((x) => x.id === o.id).status, "ACTIVE");
    assert.strictEqual(db.report_orders.find((x) => x.id === previousGeo.id).status, "SUPERSEDED", "earlier area-alert order (other tier) not superseded");
    assert.strictEqual(db.report_orders.find((x) => x.id === unrelated.id).status, "ACTIVE", "non-geo order superseded");
  });

  await scenario("Campaign insert failure: entitlement cancelled, 400, no dispatch", async () => {
    const o = addOrder("GEO_ALERT_TIER_2");
    behavior.campaignInsertError = { code: "23514", message: "simulated campaign failure" };
    const r = await call(testActivate, { params: { id: o.id } });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.body.error, "GEO_ALERT_CAMPAIGN_CREATE_FAILED");
    assert.strictEqual(db.report_entitlements.length, 1);
    assert.strictEqual(db.report_entitlements[0].status, "CANCELLED");
    assert.strictEqual(calls.dispatch.length, 0);
  });

  await scenario("Non area-alert product keeps the direct entitlement path (no guard rpc)", async () => {
    const o = addOrder("REPORT_REACTIVATION");
    const r = await call(testActivate, { params: { id: o.id } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.ok(!calls.rpc.includes("geo_alert_create_entitlement"));
    assert.strictEqual(db.report_entitlements.length, 1);
    assert.strictEqual(db.geo_alert_campaigns.length, 0);
  });

  Module._load = originalLoad;
  for (const [s, n, m] of results) console.log(`${s}: ${n}${m ? ` -> ${m}` : ""}`);
  const failed = results.filter((r) => r[0] === "FAIL").length;
  if (failed) {
    console.error(`FAILED: ${failed} of ${results.length} T1.8E.5H behavior scenarios.`);
    process.exit(1);
  }
  console.log(`OK: ${results.length} T1.8E.5H behavior scenarios passed.`);
})();
