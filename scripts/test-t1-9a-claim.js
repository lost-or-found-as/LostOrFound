"use strict";
// T1.9A behavior test: POST /account/claim-guest-reports.
// Moves a guest's own rows to the signed-in registered account, and nothing else.
//   node .\scripts\test-t1-9a-claim.js

const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const server = path.join(root, "server");

const GUEST = "99999999-0000-0000-0000-000000000000";
const OTHER_GUEST = "88888888-0000-0000-0000-000000000000";
const A = "aaaaaaaa-0000-0000-0000-000000000000";
const C = "cccccccc-0000-0000-0000-000000000000";

const users = {
  "token-guest": { id: GUEST, is_anonymous: true },
  "token-a": { id: A, is_anonymous: false },
  "token-c": { id: C, is_anonymous: false },
};

let tables;
function reset() {
  tables = {
    reports: [{ id: "r-g1", user_id: GUEST }, { id: "r-g2", user_id: GUEST }, { id: "r-og", user_id: OTHER_GUEST }, { id: "r-c", user_id: C }],
    report_images: [{ id: 1, created_by: GUEST }, { id: 2, created_by: C }],
    report_creation_events: [{ id: "e1", user_id: GUEST }],
    report_edits: [],
  };
}

function query(table) {
  const filters = [];
  let patch = null;
  const run = () => {
    const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
    if (patch) rows.forEach((r) => Object.assign(r, patch));
    return { data: rows.map((r) => ({ id: r.id })), error: null };
  };
  const b = {
    update(p) { patch = p; return b; },
    select() { return b; },
    eq(k, v) { filters.push((r) => String(r[k]) === String(v)); return b; },
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
  };
  return b;
}
const supaAdmin = {
  from: (t) => query(t),
  auth: { getUser: async (token) => (users[token] ? { data: { user: users[token] }, error: null } : { data: { user: null }, error: { message: "bad" } }) },
};

const supaPath = path.join(server, "supabaseClient.js");
const routes = {};
const fakeExpress = () => ({});
fakeExpress.Router = () => {
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  return { get: reg("GET"), post: reg("POST"), put: reg("PUT"), patch: reg("PATCH"), delete: reg("DELETE"), use() {} };
};
const originalLoad = Module._load;
Module._load = function (request, parent) {
  if (request === "express") return fakeExpress;
  if (parent && request.startsWith(".")) {
    const r = path.resolve(path.dirname(parent.filename), request);
    if (r === supaPath || `${r}.js` === supaPath) return { supaAdmin };
  }
  return originalLoad.apply(this, arguments);
};
require(path.join(server, "routes", "account.js"));
Module._load = originalLoad;

async function claim(callerToken, guestAccessToken) {
  const handlers = routes["POST /claim-guest-reports"];
  assert(handlers, "ROUTE_MISSING");
  const req = { header: () => `Bearer ${callerToken}`, body: { guestAccessToken } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let i = 0;
  const pending = [];
  const next = () => { const h = handlers[i++]; if (h) pending.push(Promise.resolve(h(req, res, next))); };
  next();
  for (let k = 0; k < pending.length; k++) await pending[k];
  return res;
}

(async () => {
  let n = 0;
  const ok = (c, m) => { assert(c, m); n++; };
  const owner = (t, id) => tables[t].find((r) => r.id === id);

  reset();
  let res = await claim("token-a", "token-guest");
  ok(res.statusCode === 200 && res.body.moved === 2, "both guest reports moved");
  ok(owner("reports", "r-g1").user_id === A && owner("reports", "r-g2").user_id === A, "reports now owned by A");
  ok(owner("report_images", 1).created_by === A, "guest images moved");
  ok(owner("report_creation_events", "e1").user_id === A, "creation events moved");
  ok(owner("reports", "r-og").user_id === OTHER_GUEST, "other guest untouched");
  ok(owner("reports", "r-c").user_id === C && owner("report_images", 2).created_by === C, "other user untouched");

  res = await claim("token-a", "token-guest");
  ok(res.statusCode === 200 && res.body.moved === 0, "replay is harmless");

  reset();
  res = await claim("token-guest", "token-guest");
  ok(res.statusCode === 403 && res.body.error === "GUEST_NOT_ALLOWED", "a guest cannot claim");
  res = await claim("token-a", "token-c");
  ok(res.statusCode === 400 && res.body.error === "NOT_A_GUEST_SESSION", "cannot take a registered user's reports");
  ok(owner("reports", "r-c").user_id === C, "registered user's reports stay");
  res = await claim("token-a", "token-expired");
  ok(res.statusCode === 400 && res.body.error === "GUEST_TOKEN_INVALID", "invalid guest token refused");
  res = await claim("token-a", "");
  ok(res.statusCode === 400 && res.body.error === "GUEST_TOKEN_REQUIRED", "missing guest token refused");
  ok(owner("reports", "r-g1").user_id === GUEST, "refused calls moved nothing");

  console.log(`OK: T1.9A guest claim tests passed (${n} assertions).`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
