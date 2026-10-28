"use strict";
// T1.9A security probe. Talks to the STAGING Supabase project exactly like an outsider would:
// with the public app key, as "not signed in", as a fresh guest, and (optionally) as a registered user.
// It reports what each role can read or write directly, bypassing the app and the backend.
//
// Usage (PowerShell, see the package instructions):
//   $env:PROBE_ANON_KEY = "<staging publishable key>"
//   optional: $env:PROBE_EMAIL / $env:PROBE_PASSWORD for a registered staging account
//   node scripts/security-probe.js
//
// Safety: refuses to run against anything but the staging project. Write probes use random
// user ids, so they cannot touch real users; a successful write leaves a row titled SECURITY_PROBE.

const STAGING_URL = "https://lxctyscebfwgzdbpeury.supabase.co";
const url = (process.env.PROBE_SUPABASE_URL || STAGING_URL).replace(/\/$/, "");
const key = process.env.PROBE_ANON_KEY || "";

if (url !== STAGING_URL) {
  console.error(`PROBE_REFUSED: only ${STAGING_URL} is allowed.`);
  process.exit(2);
}
if (!key) {
  console.error("PROBE_ANON_KEY is missing.");
  process.exit(2);
}

const randomUuid = () => require("crypto").randomUUID();
const results = [];

async function call(method, path, token, body) {
  const headers = { apikey: key, Authorization: `Bearer ${token || key}`, "Content-Type": "application/json" };
  if (method === "POST" && path.startsWith("/rest/v1/") && !path.startsWith("/rest/v1/rpc/")) {
    headers.Prefer = "return=minimal";
  }
  const res = await fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

function record(who, check, verdict, detail) {
  results.push({ who, check, verdict, detail });
}

// Read: any returned row is a leak.
async function probeRead(who, token, check, path, filter) {
  const r = await call("GET", path, token);
  if (r.status >= 200 && r.status < 300 && Array.isArray(r.json)) {
    const rows = filter ? r.json.filter(filter) : r.json;
    record(who, check, rows.length > 0 ? "LEAK" : "OK", `${rows.length} rows`);
  } else {
    record(who, check, "OK", `HTTP ${r.status} ${r.json?.code || ""}`.trim());
  }
}

// Write / RPC: only a permission error proves the door is closed.
async function probeWrite(who, token, check, method, path, body) {
  const r = await call(method, path, token, body);
  const code = r.json?.code || r.json?.error || "";
  const closed = code === "42501" || code === "PGRST202" || [401, 403, 404].includes(r.status);
  record(who, check, closed ? "OK" : "LEAK", `HTTP ${r.status} ${code}`.trim());
}

async function storageList(who, token) {
  const r = await call("POST", "/storage/v1/object/list/report-images", token, { prefix: "", limit: 20 });
  const n = Array.isArray(r.json) ? r.json.length : 0;
  record(who, "list report images", n > 0 ? "LEAK" : "OK", Array.isArray(r.json) ? `${n} objects` : `HTTP ${r.status}`);
}

const watchAreaArgs = (userId) => ({
  p_user_id: userId, p_name: "SECURITY_PROBE", p_area_type: "CIRCLE", p_lat: 59.91, p_lng: 10.75,
  p_radius_m: 500, p_boundary_points: [], p_category_keys: [], p_all_categories: true, p_push_enabled: false,
});

async function commonProbes(who, token) {
  await probeRead(who, token, "read reports", "/rest/v1/reports?select=id,user_id&limit=50");
  await probeRead(who, token, "read profiles", "/rest/v1/profiles?select=id&limit=50");
  await probeRead(who, token, "read matches", "/rest/v1/matches?select=id&limit=50");
  await probeRead(who, token, "read items", "/rest/v1/items?select=*&limit=50");
  await probeRead(who, token, "read watch areas", "/rest/v1/notification_watch_areas?select=id&limit=50");
  await probeRead(who, token, "read messages", "/rest/v1/messages?select=id&limit=50");
  await storageList(who, token);
  await probeWrite(who, token, "rpc get_user_watch_areas", "POST", "/rest/v1/rpc/get_user_watch_areas", { p_user_id: randomUuid() });
  await probeWrite(who, token, "rpc create_user_watch_area_v2", "POST", "/rest/v1/rpc/create_user_watch_area_v2", watchAreaArgs(randomUuid()));
  await probeWrite(who, token, "insert items", "POST", "/rest/v1/items", {});
}

async function main() {
  console.log(`Probing ${url}\n`);

  // 1. Not signed in.
  await commonProbes("not signed in", null);
  await probeWrite("not signed in", null, "insert report", "POST", "/rest/v1/reports", { title: "SECURITY_PROBE" });

  // 2. Fresh guest (anonymous sign-in, like the app does for found reports).
  const guest = await call("POST", "/auth/v1/signup", null, {});
  if (guest.json?.access_token) {
    const t = guest.json.access_token;
    await commonProbes("guest", t);
    await probeWrite("guest", t, "insert report", "POST", "/rest/v1/reports", { title: "SECURITY_PROBE", user_id: guest.json.user.id });
  } else {
    record("guest", "anonymous sign-in", "SKIPPED", `HTTP ${guest.status}`);
  }

  // 3. Registered user (optional): must not see other users' data.
  if (process.env.PROBE_EMAIL && process.env.PROBE_PASSWORD) {
    const login = await call("POST", "/auth/v1/token?grant_type=password", null, {
      email: process.env.PROBE_EMAIL, password: process.env.PROBE_PASSWORD,
    });
    const t = login.json?.access_token;
    const me = login.json?.user?.id;
    if (t) {
      await probeRead("registered", t, "read OTHER users' reports", "/rest/v1/reports?select=id,user_id&limit=200", (r) => r.user_id !== me);
      await probeRead("registered", t, "read OTHER profiles", "/rest/v1/profiles?select=id&limit=200", (r) => r.id !== me);
      await storageList("registered", t);
      await probeWrite("registered", t, "rpc get_user_watch_areas (other user)", "POST", "/rest/v1/rpc/get_user_watch_areas", { p_user_id: randomUuid() });
    } else {
      record("registered", "login", "SKIPPED", `HTTP ${login.status}`);
    }
  }

  const w = Math.max(...results.map((r) => r.check.length));
  for (const r of results) {
    console.log(`${r.verdict.padEnd(7)} ${r.who.padEnd(14)} ${r.check.padEnd(w)}  ${r.detail}`);
  }
  const leaks = results.filter((r) => r.verdict === "LEAK").length;
  console.log(`\n${leaks === 0 ? "PROBE_CLEAN" : "PROBE_LEAKS"}: ${leaks} open of ${results.length} checks.`);
  process.exit(leaks === 0 ? 0 : 1);
}

main().catch((e) => { console.error("PROBE_ERROR:", e.message); process.exit(2); });
