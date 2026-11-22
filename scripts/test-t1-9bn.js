// scripts/test-t1-9bn.js
// T1.9BN: solved cases leave «I nærheten»; time-of-day greeting; caller address that cannot be
// faked; security headers and origin guard; admin screens behind two-step verification.
//   node .\scripts\test-t1-9bn.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// Nearby notices about solved or deleted cases.
const { closedNearbyIds } = require(path.join(root, "server/lib/nearbyClosed.js"));
const notes = [
  { id: "a", type: "AREA_ALERT", entity_id: "c1" },
  { id: "b", type: "AREA_ALERT", entity_id: "c2" },
  { id: "c", type: "GEO_ALERT", entity_id: "c3" },
  { id: "d", type: "NEW_MATCH", entity_id: "c1" },
  { id: "e", type: "AREA_ALERT", entity_id: "unknown" },
];
const camps = [{ id: "c1", report_id: "r1" }, { id: "c2", report_id: "r2" }, { id: "c3", report_id: "r3" }];
const reps = [{ id: "r1", status: "CLOSED" }, { id: "r2", status: "ACTIVE" }, { id: "r3", status: "ACTIVE", deleted_at: "2026-11-01" }];
eq([...closedNearbyIds(notes, camps, reps)].sort(), ["a", "c"], "closed and deleted cases leave the nearby list");
const nr = read("server/routes/notifications.js");
ok(/filter\(\(n\) => !hidden\.has\(n\.id\)\)/.test(nr) && /count: Math\.max\(0, \(count \|\| 0\) - hiddenCount\)/.test(nr), "list and unread count");

// Greeting.
const g = read("src/lib/greeting.ts");
ok(/hour >= 17 && hour < 23\) return "evening"/.test(g) && /greetingKey/.test(read("app/(tabs)/index.tsx")), "greeting by time of day");

// Caller address.
const { clientIpInfo } = require(path.join(root, "server/lib/clientIp.js"));
eq(clientIpInfo({ headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9" } }).ip, "9.9.9.9", "the caller's own X-Forwarded-For entry is ignored");
eq(clientIpInfo({ headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6, 9.9.9.9" } }).ip, "1.2.3.4", "Cloudflare header first");
ok(!/x-forwarded-for"\] \|\| ""\)\.split\(","\)\[0\]/.test(read("server/lib/rateLimits.js") + read("server/routes/share.js")), "no first-entry reads left");

// Headers and origin guard.
const { originGuard } = require(path.join(root, "server/lib/securityHeaders.js"));
const run = (env, req) => { let status = 0; let passed = false; originGuard(env)(req, { status: (s) => ({ json: () => { status = s; } }) }, () => { passed = true; }); return passed ? 200 : status; };
eq(run({}, { path: "/reports", headers: {} }), 200, "no secret: open");
eq(run({ ORIGIN_SHARED_SECRET: "abc123" }, { path: "/reports", headers: {} }), 403, "secret set: direct call refused");
eq(run({ ORIGIN_SHARED_SECRET: "abc123" }, { path: "/reports", headers: { "x-origin-auth": "abc123" } }), 200, "through Cloudflare: allowed");
eq(run({ ORIGIN_SHARED_SECRET: "abc123" }, { path: "/", headers: {} }), 200, "health check open");
ok(/app\.use\(securityHeaders\)/.test(read("server/index.js")) && /app\.disable\("x-powered-by"\)/.test(read("server/index.js")), "headers on");

// Admin two-step.
const { adminAccess, tokenAal } = require(path.join(root, "server/mw/admin.js"));
const admin = "00000000-0000-0000-0000-0000000000aa";
const env = { ADMIN_USER_IDS: admin, ADMIN_REQUIRE_MFA: "true" };
eq(adminAccess(admin, "aal1", env), "ADMIN_MFA_REQUIRED", "aal1 refused");
eq(adminAccess(admin, "aal2", env), "ok", "aal2 allowed");
eq(adminAccess(admin, "aal1", { ADMIN_USER_IDS: admin }), "ok", "switch off: as before");
eq(adminAccess("00000000-0000-0000-0000-0000000000bb", "aal2", env), "NOT_ADMIN", "others refused");
eq(tokenAal("x." + Buffer.from(JSON.stringify({ aal: "aal2" })).toString("base64url") + ".y"), "aal2", "reads aal");
for (const f of ["server/routes/safety.js", "server/routes/feedback.js"]) {
  const s = read(f);
  ok(/require\("\.\.\/mw\/admin"\)/.test(s) && !/function requireAdmin/.test(s), `${f} uses the shared admin check`);
}
ok(/req\.authAal = tokenAal\(token\)/.test(read("server/mw/auth.js")), "auth keeps the level");
ok(/challengeAndVerify/.test(read("app/admin-mfa.tsx")) && /openAdmin\("\/safety-reports"\)/.test(read("app/(tabs)/profile.tsx")), "app asks for the code");

for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["home.greetingMorning", "home.greetingEvening", "home.greetingNight", "adminMfa.title", "adminMfa.codeError", "adminMfa.profileRow"]) ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
console.log(`T1.9BN OK (${n} checks)`);
