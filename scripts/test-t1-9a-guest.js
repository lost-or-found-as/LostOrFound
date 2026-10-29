"use strict";
// T1.9A behavior test: backend access for guests and image signing.
//  A. Auth middleware: registered users pass, guests get GUEST_NOT_ALLOWED except on
//     requireUserOrGuest routes.
//  B. Route inventory: every backend route is registered-only, except the found-report
//     submission whitelist. A new route that forgets auth fails this test.
//  C. Storage: uploads only to own reports; signed downloads only for own or matched reports,
//     and only inside the report image bucket.
// No network, no database and no installed server dependencies are needed.
//
//   node .\scripts\test-t1-9a-guest.js

const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const server = path.join(root, "server");

const GUEST = "99999999-0000-0000-0000-000000000000";
const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const C = "cccccccc-0000-0000-0000-000000000000";
const R_A = "a0000000-0000-0000-0000-000000000001";
const R_B = "b0000000-0000-0000-0000-000000000001";
const R_C = "c0000000-0000-0000-0000-000000000001";
const R_G = "90000000-0000-0000-0000-000000000001";

const users = {
  "token-guest": { id: GUEST, is_anonymous: true },
  "token-a": { id: A, is_anonymous: false },
  "token-c": { id: C, is_anonymous: false },
};
const tables = {
  reports: [
    { id: R_A, user_id: A }, { id: R_B, user_id: B }, { id: R_C, user_id: C }, { id: R_G, user_id: GUEST },
  ],
  matches: [{ id: "m1", lost_id: R_A, found_id: R_B }],
};

// ---------------------------------------------------------------- Supabase stand-in
function query(table) {
  const filters = [];
  const run = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
  const b = {
    select() { return b; },
    eq(k, v) { filters.push((r) => String(r[k]) === String(v)); return b; },
    in(k, v) { filters.push((r) => v.map(String).includes(String(r[k]))); return b; },
    or(expr) {
      const parts = [...expr.matchAll(/([a-z_]+)\.in\.\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(",")]);
      filters.push((r) => parts.some(([k, list]) => list.includes(String(r[k]))));
      return b;
    },
    order() { return b; },
    limit() { return b; },
    maybeSingle: () => Promise.resolve({ data: run()[0] || null, error: null }),
    then(res, rej) { try { res({ data: run(), error: null }); } catch (e) { rej(e); } },
  };
  return b;
}
const signed = [];
const supaAdmin = {
  from: (t) => query(t),
  rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (token) => (users[token] ? { data: { user: users[token] }, error: null } : { data: null, error: { message: "bad" } }) },
  storage: {
    from: (bucket) => ({
      createSignedUrl: async (p) => { signed.push(`${bucket}/${p}`); return { data: { signedUrl: `https://signed/${bucket}/${p}` }, error: null }; },
      createSignedUploadUrl: async (p) => ({ data: { signedUrl: `https://upload/${bucket}/${p}` }, error: null }),
    }),
  },
};

// ---------------------------------------------------------------- load real auth middleware
const originalLoad = Module._load;
const supaPath = path.join(server, "supabaseClient.js");
Module._load = function (request, parent) {
  if (parent && request.startsWith(".")) {
    const r = path.resolve(path.dirname(parent.filename), request);
    if (r === supaPath || `${r}.js` === supaPath) return { supaAdmin };
  }
  return originalLoad.apply(this, arguments);
};
const auth = require(path.join(server, "mw", "auth.js"));
Module._load = originalLoad;

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function runAuth(mw, token) {
  const req = { header: () => (token ? `Bearer ${token}` : "") };
  const res = mockRes();
  let passed = false;
  await mw(req, res, () => { passed = true; });
  return { passed, status: res.statusCode, body: res.body, req };
}

// ---------------------------------------------------------------- load every route file
const routes = [];
let currentFile = "";
const fakeExpress = () => ({});
fakeExpress.Router = () => {
  const reg = (method) => (p, ...handlers) => routes.push({ file: currentFile, method, path: p, handlers });
  return { get: reg("GET"), post: reg("POST"), put: reg("PUT"), patch: reg("PATCH"), delete: reg("DELETE"), use() {} };
};
const authPath = path.join(server, "mw", "auth.js");
Module._load = function (request, parent) {
  if (request === "express") return fakeExpress;
  if (parent && request.startsWith(".")) {
    const r = path.resolve(path.dirname(parent.filename), request);
    if (r === supaPath || `${r}.js` === supaPath) return { supaAdmin };
    if (r === authPath || `${r}.js` === authPath) return auth;
  }
  try { return originalLoad.apply(this, arguments); } catch (e) {
    if (!request.startsWith(".")) return new Proxy(function () {}, { get: () => () => ({}) }); // external package stand-in
    throw e;
  }
};
const fs = require("fs");
const routeDir = path.join(server, "routes");
for (const f of fs.readdirSync(routeDir).filter((f) => f.endsWith(".js"))) {
  currentFile = f;
  require(path.join(routeDir, f));
}
Module._load = originalLoad;

const GUEST_ALLOWED = new Set([
  "reports.js POST /",
  "reportImages.js POST /:id/images",
  "storage.js POST /signed-upload",
  "geo.js GET /reverse",
  "geo.js GET /search",
]);

async function call(file, method, p, token, { body = {}, query = {}, params = {} } = {}) {
  const route = routes.find((r) => r.file === file && r.method === method && r.path === p);
  assert(route, `ROUTE_MISSING ${file} ${method} ${p}`);
  const req = { header: () => `Bearer ${token}`, body, query, params };
  const res = mockRes();
  // Middleware calls next() without returning it, so collect every step and wait for all.
  let i = 0;
  const pending = [];
  const next = () => { const h = route.handlers[i++]; if (h) pending.push(Promise.resolve(h(req, res, next))); };
  next();
  for (let k = 0; k < pending.length; k++) await pending[k];
  return res;
}

(async () => {
  let n = 0;
  const ok = (cond, msg) => { assert(cond, msg); n++; };

  // A. middleware
  let r = await runAuth(auth.requireUser, "token-a");
  ok(r.passed && r.req.isGuest === false, "registered user must pass requireUser");
  r = await runAuth(auth.requireUser, "token-guest");
  ok(!r.passed && r.status === 403 && r.body.error === "GUEST_NOT_ALLOWED", "guest must be blocked by requireUser");
  r = await runAuth(auth.requireUser, null);
  ok(!r.passed && r.status === 401, "missing token must be 401");
  r = await runAuth(auth.requireUser, "token-unknown");
  ok(!r.passed && r.status === 401, "invalid token must be 401");
  r = await runAuth(auth.requireUserOrGuest, "token-guest");
  ok(r.passed && r.req.isGuest === true, "guest must pass requireUserOrGuest");

  // B. inventory
  ok(routes.length >= 50, `expected the full route set, found ${routes.length}`);
  for (const route of routes) {
    const key = `${route.file} ${route.method} ${route.path}`;
    const guards = route.handlers.slice(0, -1);
    if (GUEST_ALLOWED.has(key)) {
      ok(guards.includes(auth.requireUserOrGuest), `GUEST_ROUTE_WITHOUT_AUTH: ${key}`);
    } else {
      ok(guards.includes(auth.requireUser), `ROUTE_NOT_REGISTERED_ONLY: ${key}`);
      ok(!guards.includes(auth.requireUserOrGuest), `GUEST_ALLOWED_UNEXPECTEDLY: ${key}`);
    }
  }
  for (const key of GUEST_ALLOWED) ok(routes.some((x) => `${x.file} ${x.method} ${x.path}` === key), `WHITELISTED_ROUTE_MISSING: ${key}`);

  // C. storage
  let res = await call("storage.js", "POST", "/signed-upload", "token-guest", { body: { reportId: R_G } });
  ok(res.statusCode === 200 && /reports\/90000000/.test(res.body.path), "guest may upload to own report");
  res = await call("storage.js", "POST", "/signed-upload", "token-guest", { body: { reportId: R_A } });
  ok(res.statusCode === 404, "guest may not upload to someone else's report");
  res = await call("storage.js", "POST", "/signed-upload", "token-c", { body: { reportId: R_A } });
  ok(res.statusCode === 404, "registered user may not upload to someone else's report");

  const img = (rid) => `report-images/reports/${rid}/x.jpg`;
  res = await call("storage.js", "GET", "/signed-download", "token-a", { query: { path: img(R_A) } });
  ok(res.statusCode === 200 && res.body.url, "owner may view own image");
  res = await call("storage.js", "GET", "/signed-download", "token-a", { query: { path: img(R_B) } });
  ok(res.statusCode === 200, "owner may view image of matched report");
  res = await call("storage.js", "GET", "/signed-download", "token-a", { query: { path: img(R_C) } });
  ok(res.statusCode === 403 && res.body.error === "IMAGE_NOT_ALLOWED", "unmatched report image must be refused");
  res = await call("storage.js", "GET", "/signed-download", "token-a", { query: { path: "other-bucket/secret.pdf" } });
  ok(res.statusCode === 400, "other bucket must be refused");
  res = await call("storage.js", "GET", "/signed-download", "token-a", { query: { path: `report-images/reports/${R_A}/../x.jpg` } });
  ok(res.statusCode === 400, "path traversal must be refused");
  res = await call("storage.js", "GET", "/signed-download", "token-guest", { query: { path: img(R_G) } });
  ok(res.statusCode === 403 && res.body.error === "GUEST_NOT_ALLOWED", "guest may not download images");

  signed.length = 0;
  res = await call("storage.js", "POST", "/signed-download-batch", "token-c", { body: { paths: [img(R_C), img(R_A), "other/x"] } });
  ok(res.statusCode === 200 && Object.keys(res.body.urls).length === 1 && res.body.urls[img(R_C)], "batch signs only allowed paths");
  ok(res.body.errors[img(R_A)] === "IMAGE_NOT_ALLOWED" && res.body.errors["other/x"] === "INVALID_IMAGE_PATH", "batch reports refused paths");
  ok(signed.length === 1, "nothing outside the allowed set was signed");

  // Guests are blocked on a sample of registered-only routes.
  res = await call("matches.js", "GET", "/", "token-guest");
  ok(res.statusCode === 403, "guest blocked on matches");
  res = await call("push.js", "POST", "/register", "token-guest");
  ok(res.statusCode === 403, "guest blocked on push registration");
  res = await call("alertAreas.js", "POST", "/", "token-guest");
  ok(res.statusCode === 403, "guest blocked on watch areas");
  res = await call("reports.js", "GET", "/mine", "token-guest");
  ok(res.statusCode === 403, "guest cannot list reports");

  console.log(`OK: T1.9A guest and storage tests passed (${n} assertions, ${routes.length} routes).`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
