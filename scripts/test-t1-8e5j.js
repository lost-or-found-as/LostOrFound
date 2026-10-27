"use strict";
// T1.8E.5J behavior test.
//  A. Backend message catalog: parity, placeholders, every key used in server code exists.
//  B. Area-alert push text comes from the catalog in the recipient's language.
//  C. Closed orders (EXPIRED, SUPERSEDED, FAILED) cannot be activated.
// No network, no database and no installed server dependencies are needed.
//
// Run from the repository root:
//   node .\scripts\test-t1-8e5j.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = process.cwd();
const serverDir = path.join(root, "server");
const results = [];
async function scenario(name, fn) {
  const keep = { info: console.info, error: console.error, warn: console.warn };
  console.info = console.error = console.warn = () => {};
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
  finally { Object.assign(console, keep); }
}

function serverJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...serverJsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- module stand-ins
let supaAdmin = null;
const routes = {};
const fakeExpress = () => ({});
fakeExpress.Router = () => {
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  return { get: reg("GET"), post: reg("POST"), put: reg("PUT"), patch: reg("PATCH"), delete: reg("DELETE"), use() {} };
};
const proxyClient = new Proxy({}, { get: (_, k) => supaAdmin[k] });
const stubs = {
  [path.join(serverDir, "supabaseClient.js")]: { supaAdmin: proxyClient },
  [path.join(serverDir, "mw", "auth.js")]: { requireUser: (req, res, next) => next() },
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

function builder(resolveRows) {
  const st = { op: "select", filters: [], payload: null };
  const run = () => resolveRows(st);
  const b = {
    select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, neq() { return b; }, like() { return b; },
    in() { return b; }, is() { return b; }, order() { return b; }, limit() { return b; },
    insert(p) { st.op = "insert"; st.payload = p; return b; }, update(p) { st.op = "update"; st.payload = p; return b; },
    upsert(p) { st.op = "upsert"; st.payload = p; return b; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error || null }); },
    single() { return b.maybeSingle(); },
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
  };
  return b;
}

(async () => {
  const messages = require(path.join(serverDir, "lib", "messages.js"));
  const no = JSON.parse(fs.readFileSync(path.join(serverDir, "locales", "no.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(serverDir, "locales", "en.json"), "utf8"));

  await scenario("Catalog: same keys and same {{placeholders}} in Norwegian and English", async () => {
    assert.deepStrictEqual(Object.keys(no).sort(), Object.keys(en).sort());
    const ph = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of Object.keys(no)) assert.strictEqual(ph(no[k]), ph(en[k]), `placeholders differ for ${k}`);
    for (const k of Object.keys(no)) assert.ok(String(no[k]).trim() && String(en[k]).trim(), `empty text for ${k}`);
  });

  await scenario("Catalog: every key used in server code exists", async () => {
    const used = new Set();
    for (const file of serverJsFiles(serverDir)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b(?:message\([^,()]+,\s*|localizedPair\()\s*"([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/localizedPair\([^)]*?\?\s*"([a-zA-Z0-9_.]+)"\s*:\s*"([a-zA-Z0-9_.]+)"/g)) { used.add(m[1]); used.add(m[2]); }
    }
    assert.ok(used.size >= 15, `only ${used.size} keys found in code`);
    for (const k of used) assert.ok(k in no && k in en, `key used but missing: ${k}`);
  });

  await scenario("message(): interpolation, unknown language falls back to Norwegian, missing key throws", async () => {
    assert.strictEqual(messages.message("en", "push.areaAlert.body", { item: "Wallet" }), "Wallet was reported lost near an area you follow.");
    assert.strictEqual(messages.message("de", "push.test.title"), no["push.test.title"]);
    assert.deepStrictEqual(messages.localizedPair("push.newMessage.title"), { no: no["push.newMessage.title"], en: en["push.newMessage.title"] });
    assert.throws(() => messages.message("no", "push.does.not.exist"), /MESSAGE_KEY_MISSING/);
  });

  await scenario("No inline { no, en } text pairs or language switches remain in server code", async () => {
    for (const file of serverJsFiles(serverDir)) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      assert.ok(!/\b(?:no|en)\s*:\s*"[^"]*"\s*,\s*(?:en|no)\s*:\s*"/.test(src), `inline text pair in ${rel}`);
      assert.ok(!/language\s*===\s*"en"\s*\?\s*["`][^"`\n]*\s[^"`\n]*["`]/.test(src), `inline language switch in ${rel}`);
    }
  });

  await scenario("Area-alert push uses the catalog per recipient language, with item fallback", async () => {
    const sent = [];
    global.fetch = async (url, init) => {
      const msgs = JSON.parse(init.body); sent.push(...msgs);
      return { ok: true, json: async () => ({ data: msgs.map(() => ({ status: "ok", id: "t" })) }) };
    };
    supaAdmin = {
      rpc: async (name) => {
        if (name === "geo_alert_campaign_is_dispatchable") return { data: true, error: null };
        if (name === "geo_alert_create_in_app_notifications") return { data: [{ eligible_users: 2, created_notifications: 2 }], error: null };
        if (name === "geo_alert_eligible_installations")
          return { data: [
            { recipient_user_id: "u1", installation_id: "i1", expo_push_token: "t1", language: "en", report_title: "Wallet" },
            { recipient_user_id: "u2", installation_id: "i2", expo_push_token: "t2", language: "no", report_title: null },
          ], error: null };
        return { data: null, error: { message: name } };
      },
      from: () => builder((st) => (st.op === "upsert" ? { data: [{ id: "r" }] } : { data: null })),
    };
    delete require.cache[path.join(serverDir, "lib", "geoAlertDispatch.js")];
    const { dispatchAreaAlertCampaign } = require(path.join(serverDir, "lib", "geoAlertDispatch.js"));
    const r = await dispatchAreaAlertCampaign("campaign-1");
    assert.strictEqual(r.ok, true);
    const byToken = Object.fromEntries(sent.map((m) => [m.to, m]));
    assert.strictEqual(byToken.t1.title, en["push.areaAlert.title"]);
    assert.strictEqual(byToken.t1.body, "Wallet was reported lost near an area you follow.");
    assert.strictEqual(byToken.t2.title, no["push.areaAlert.title"]);
    assert.strictEqual(byToken.t2.body, `${no["push.areaAlert.itemFallback"]} er meldt mistet nær et område du følger.`);
  });

  await scenario("Closed orders cannot be activated; open orders proceed to the guarded rpc", async () => {
    process.env.GEO_ALERT_TEST_MODE = "true";
    process.env.GEO_ALERT_TEST_USER_IDS = "user-1";
    const orders = {};
    const rpcCalls = [];
    supaAdmin = {
      rpc: async (name) => { rpcCalls.push(name); return { data: null, error: { code: "P0001", message: "GEO_ALERT_ALREADY_ACTIVE", details: "x" } }; },
      from: (table) => builder((st) => {
        if (table === "report_orders") {
          const id = (st.filters.find(([k]) => k === "id") || [])[1];
          return { data: orders[id] ? [orders[id]] : [] };
        }
        if (table === "reports") return { data: [{ id: "rep-1", user_id: "user-1", lat: 1, lng: 1, deleted_at: null }] };
        if (table === "report_entitlements") return { data: [] };
        if (table === "geo_alert_campaigns") return { data: [] };
        return { data: [] };
      }),
    };
    stubs[path.join(serverDir, "lib", "geoAlertDispatch.js")] = { dispatchAreaAlertCampaign: async () => ({ ok: true }) };
    delete require.cache[path.join(serverDir, "routes", "reportCommerce.js")];
    delete require.cache[path.join(serverDir, "lib", "geoAlertActivationGuard.js")];
    require(path.join(serverDir, "routes", "reportCommerce.js"));
    const activate = routes["POST /orders/:id/test-activate"];
    const call = async (id) => {
      const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await activate({ params: { id }, user: { id: "user-1" }, body: {} }, res);
      return res;
    };
    for (const status of ["EXPIRED", "SUPERSEDED", "FAILED"]) {
      orders[`o-${status}`] = { id: `o-${status}`, user_id: "user-1", report_id: "rep-1", product_code: "GEO_ALERT_TIER_2", status };
      const r = await call(`o-${status}`);
      assert.strictEqual(r.statusCode, 409, `${status} -> ${r.statusCode}`);
      assert.deepStrictEqual(r.body, { error: "ORDER_NOT_ACTIVATABLE", orderStatus: status });
    }
    assert.strictEqual(rpcCalls.length, 0, "guarded rpc called for a closed order");
    orders["o-PENDING"] = { id: "o-PENDING", user_id: "user-1", report_id: "rep-1", product_code: "GEO_ALERT_TIER_2", status: "PENDING", request_payload: {} };
    const r = await call("o-PENDING");
    assert.ok(rpcCalls.includes("geo_alert_create_entitlement"), "open order did not reach the guarded rpc");
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.body.error, "GEO_ALERT_ALREADY_ACTIVE");
  });

  Module._load = originalLoad;
  for (const [s, n, m] of results) console.log(`${s}: ${n}${m ? ` -> ${m}` : ""}`);
  const failed = results.filter((r) => r[0] === "FAIL").length;
  if (failed) {
    console.error(`FAILED: ${failed} of ${results.length} T1.8E.5J behavior scenarios.`);
    process.exit(1);
  }
  console.log(`OK: ${results.length} T1.8E.5J behavior scenarios passed.`);
})();
