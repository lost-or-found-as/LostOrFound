"use strict";
// T1.8E.5G.1 behavior test.
// Runs the real server/lib/geoAlertDispatch.js and server/lib/areaAlertAccess.js against an
// in-memory fake of the Supabase client and a fake Expo endpoint. No network, no database.
//
// Run from the repository root:
//   node .\scripts\test-t1-8e5g1-dispatch.js

const path = require("path");
const assert = require("assert");

const root = process.cwd();
const clientPath = require.resolve(path.join(root, "server", "supabaseClient.js"));

// ---------------------------------------------------------------- fake database
const CAMPAIGN = "11111111-1111-1111-1111-111111111111";
const CAMPAIGN_PUSH_DOWN = "22222222-2222-2222-2222-222222222222";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000000"; // push, two installations
const USER_C = "cccccccc-0000-0000-0000-000000000000"; // no installation
const USER_G = "99999999-0000-0000-0000-000000000000"; // installation, but area push disabled
const STRANGER = "eeeeeeee-0000-0000-0000-000000000000";

// What geo_alert_eligible_users returns for each campaign (SQL logic is verified separately).
const eligibleUsers = {
  [CAMPAIGN]: [
    { recipient_user_id: USER_B, push_requested: true, watch_area_id: "wa-b" },
    { recipient_user_id: USER_C, push_requested: true, watch_area_id: "wa-c" },
    { recipient_user_id: USER_G, push_requested: false, watch_area_id: "wa-g" },
  ],
  [CAMPAIGN_PUSH_DOWN]: [
    { recipient_user_id: USER_B, push_requested: true, watch_area_id: "wa-b" },
    { recipient_user_id: USER_C, push_requested: true, watch_area_id: "wa-c" },
  ],
};
const installations = [
  { user_id: USER_B, installation_id: "inst-b1", expo_push_token: "ExponentPushToken[b1]", language: "no" },
  { user_id: USER_B, installation_id: "inst-b2", expo_push_token: "ExponentPushToken[b2]", language: "en" },
  { user_id: USER_G, installation_id: "inst-g", expo_push_token: "ExponentPushToken[g]", language: "no" },
];

const db = {
  notifications: new Map(), // notification_key -> row
  recipients: [], // geo_alert_recipients rows
  pushLog: [],
  rpcCalls: [],
  dispatchable: new Set([CAMPAIGN, CAMPAIGN_PUSH_DOWN]),
  failInApp: false,
};

let nextId = 1;
const newId = () => `row-${nextId++}`;

const rpcHandlers = {
  geo_alert_campaign_is_dispatchable: ({ p_campaign_id }) => db.dispatchable.has(p_campaign_id),
  geo_alert_create_in_app_notifications: ({ p_campaign_id }) => {
    if (db.failInApp) throw { message: "SIMULATED_IN_APP_FAILURE", code: "XX000" };
    const users = eligibleUsers[p_campaign_id] || [];
    let created = 0;
    for (const u of users) {
      const key = `AREA_ALERT:${p_campaign_id}:${u.recipient_user_id}`;
      if (db.notifications.has(key)) continue; // on conflict (notification_key) do nothing
      db.notifications.set(key, {
        id: newId(),
        user_id: u.recipient_user_id,
        type: "AREA_ALERT",
        entity_type: "area_alert_campaign",
        entity_id: p_campaign_id,
        notification_key: key,
      });
      created++;
    }
    return [{ eligible_users: users.length, created_notifications: created }];
  },
  geo_alert_eligible_installations: ({ p_campaign_id }) => {
    const users = (eligibleUsers[p_campaign_id] || []).filter((u) => u.push_requested);
    const rows = [];
    for (const u of users)
      for (const pi of installations.filter((x) => x.user_id === u.recipient_user_id))
        rows.push({
          campaign_id: p_campaign_id,
          recipient_user_id: u.recipient_user_id,
          installation_id: pi.installation_id,
          expo_push_token: pi.expo_push_token,
          language: pi.language,
          watch_area_id: u.watch_area_id,
          report_title: "Wallet",
          category_key: "WALLET",
        });
    return rows;
  },
};

function query(table) {
  const state = { table, op: "select", filters: [], payload: null, options: null, limit: null };
  const run = () => {
    const match = (row) => state.filters.every(([k, v]) => String(row[k]) === String(v));
    if (table === "geo_alert_recipients") {
      if (state.op === "upsert") {
        const p = state.payload;
        const exists = db.recipients.find(
          (r) => r.campaign_id === p.campaign_id && r.installation_id === p.installation_id,
        );
        if (exists) return { data: null, error: null }; // ignoreDuplicates
        const row = { id: newId(), ...p };
        db.recipients.push(row);
        return { data: { id: row.id }, error: null };
      }
      if (state.op === "update") {
        db.recipients.filter(match).forEach((r) => Object.assign(r, state.payload));
        return { data: null, error: null };
      }
      const rows = db.recipients.filter(match);
      return { data: state.limit ? rows.slice(0, state.limit) : rows, error: null };
    }
    if (table === "notifications") {
      if (state.op !== "select") throw new Error("DISPATCH_MUST_NOT_WRITE_NOTIFICATIONS_DIRECTLY");
      const rows = [...db.notifications.values()].filter(match);
      return { data: state.limit ? rows.slice(0, state.limit) : rows, error: null };
    }
    if (table === "push_delivery_log") {
      db.pushLog.push(state.payload);
      return { data: null, error: null };
    }
    throw new Error(`UNEXPECTED_TABLE: ${table}`);
  };
  const builder = {
    select() { return builder; },
    upsert(payload, options) { state.op = "upsert"; state.payload = payload; state.options = options; return builder; },
    update(payload) { state.op = "update"; state.payload = payload; return builder; },
    insert(payload) { state.op = "insert"; state.payload = payload; return builder; },
    eq(k, v) { state.filters.push([k, v]); return builder; },
    order() { return builder; },
    limit(n) { state.limit = n; return builder; },
    maybeSingle() {
      const r = run();
      if (Array.isArray(r.data) && r.data.length > 1)
        return Promise.resolve({ data: null, error: { code: "PGRST116", message: "multiple rows" } });
      return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null });
    },
    then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
  };
  return builder;
}

const fakeSupaAdmin = {
  from: (table) => query(table),
  rpc: async (name, args) => {
    db.rpcCalls.push(name);
    const handler = rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `UNKNOWN_RPC ${name}` } };
    try { return { data: handler(args), error: null }; }
    catch (error) { return { data: null, error }; }
  },
};

require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: { supaAdmin: fakeSupaAdmin },
};

// ---------------------------------------------------------------- fake Expo
let expoCalls = [];
let expoDown = false;
global.fetch = async (url, init) => {
  const messages = JSON.parse(init.body);
  expoCalls.push(messages);
  if (expoDown) return { ok: false, json: async () => ({ errors: [{ code: "SIMULATED" }] }) };
  return { ok: true, json: async () => ({ data: messages.map((_, i) => ({ status: "ok", id: `ticket-${i}` })) }) };
};

const { dispatchAreaAlertCampaign } = require(path.join(root, "server", "lib", "geoAlertDispatch.js"));
const { getAreaAlertAccess } = require(path.join(root, "server", "lib", "areaAlertAccess.js"));

// ---------------------------------------------------------------- scenarios
const results = [];
async function scenario(name, fn) {
  const quiet = { info: console.info, error: console.error };
  console.info = () => {};
  console.error = () => {};
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
  finally { Object.assign(console, quiet); }
}

const tokensSent = () => expoCalls.flat().map((m) => m.to);

(async () => {
  await scenario("First dispatch: Nearby for B, C and G; push only to B's two installations", async () => {
    expoCalls = [];
    const r = await dispatchAreaAlertCampaign(CAMPAIGN);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eligible, 3);
    assert.strictEqual(r.notificationsCreated, 3);
    assert.strictEqual(r.pushEligible, 2);
    assert.strictEqual(r.sent, 2);
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(r.pushError, null);
    assert.deepStrictEqual(tokensSent().sort(), ["ExponentPushToken[b1]", "ExponentPushToken[b2]"]);
    for (const u of [USER_B, USER_C, USER_G])
      assert.ok(db.notifications.has(`AREA_ALERT:${CAMPAIGN}:${u}`), `missing Nearby row for ${u}`);
    assert.ok(!tokensSent().includes("ExponentPushToken[g]"), "push sent to area with push disabled");
    assert.strictEqual(db.recipients.filter((x) => x.user_id === USER_C).length, 0, "recipient row for user without push");
    assert.ok(db.recipients.every((x) => x.status === "TICKET_OK"));
    assert.strictEqual(db.pushLog.length, 2);
  });

  await scenario("Layer order: Nearby notifications are created before push installations are read", async () => {
    const i = db.rpcCalls.indexOf("geo_alert_create_in_app_notifications");
    const j = db.rpcCalls.indexOf("geo_alert_eligible_installations");
    assert.ok(i >= 0 && j > i, `rpc order was ${db.rpcCalls.join(" > ")}`);
  });

  await scenario("Replay: no new Nearby rows, no new push, duplicates reported", async () => {
    expoCalls = [];
    const r = await dispatchAreaAlertCampaign(CAMPAIGN);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eligible, 3);
    assert.strictEqual(r.notificationsCreated, 0);
    assert.strictEqual(r.sent, 0);
    assert.strictEqual(r.skippedAsDuplicate, 2);
    assert.strictEqual(expoCalls.length, 0, "Expo called on replay");
    assert.strictEqual(db.notifications.size, 3);
  });

  await scenario("Access: C (Nearby only) allowed as IN_APP_ONLY; B with two rows allowed; stranger denied", async () => {
    const c = await getAreaAlertAccess(CAMPAIGN, USER_C);
    assert.deepStrictEqual(c, { allowed: true, recipientStatus: "IN_APP_ONLY" });
    const b = await getAreaAlertAccess(CAMPAIGN, USER_B);
    assert.strictEqual(b.allowed, true);
    assert.strictEqual(b.recipientStatus, "TICKET_OK");
    const s = await getAreaAlertAccess(CAMPAIGN, STRANGER);
    assert.deepStrictEqual(s, { allowed: false, recipientStatus: null });
  });

  await scenario("Expo outage: Nearby rows kept, dispatch ok, recipients marked TICKET_ERROR", async () => {
    expoCalls = [];
    expoDown = true;
    const r = await dispatchAreaAlertCampaign(CAMPAIGN_PUSH_DOWN);
    expoDown = false;
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.notificationsCreated, 2);
    assert.strictEqual(r.failed, 2);
    assert.strictEqual(r.pushError, "EXPO_PUSH_SEND_FAILED");
    assert.ok(db.notifications.has(`AREA_ALERT:${CAMPAIGN_PUSH_DOWN}:${USER_C}`));
    const rows = db.recipients.filter((x) => x.campaign_id === CAMPAIGN_PUSH_DOWN);
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((x) => x.status === "TICKET_ERROR"), "recipient rows left QUEUED");
  });

  await scenario("Nearby write failure: dispatch throws and no push is attempted", async () => {
    expoCalls = [];
    db.failInApp = true;
    const fresh = "33333333-3333-3333-3333-333333333333";
    db.dispatchable.add(fresh);
    eligibleUsers[fresh] = [{ recipient_user_id: USER_B, push_requested: true, watch_area_id: "wa-b" }];
    let threw = false;
    try { await dispatchAreaAlertCampaign(fresh); } catch { threw = true; }
    db.failInApp = false;
    assert.ok(threw, "dispatch did not throw");
    assert.strictEqual(expoCalls.length, 0, "push attempted after Nearby failure");
  });

  await scenario("Not dispatchable: returns CAMPAIGN_NOT_DISPATCHABLE without writes", async () => {
    const before = db.rpcCalls.length;
    const r = await dispatchAreaAlertCampaign("44444444-4444-4444-4444-444444444444");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "CAMPAIGN_NOT_DISPATCHABLE");
    assert.deepStrictEqual(db.rpcCalls.slice(before), ["geo_alert_campaign_is_dispatchable"]);
  });

  for (const [status, name, msg] of results) console.log(`${status}: ${name}${msg ? ` -> ${msg}` : ""}`);
  const failed = results.filter((r) => r[0] === "FAIL").length;
  if (failed) {
    console.error(`FAILED: ${failed} of ${results.length} T1.8E.5G.1 behavior scenarios.`);
    process.exit(1);
  }
  console.log(`OK: ${results.length} T1.8E.5G.1 behavior scenarios passed.`);
})();
