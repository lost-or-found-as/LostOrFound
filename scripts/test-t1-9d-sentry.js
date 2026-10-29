"use strict";
// T1.9D behavior test: server error reporting (server/lib/sentry.js) and app wiring.
//   node .\scripts\test-t1-9d-sentry.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const libPath = path.join(root, "server", "lib", "sentry.js");

const sent = [];
const fakeSentry = {
  init: (opts) => { fakeSentry.options = opts; },
  withScope: (fn) => {
    const scope = { tags: {}, setTag(k, v) { this.tags[k] = v; }, setFingerprint(f) { this.fp = f; } };
    fn(scope);
    fakeSentry.lastScope = scope;
  },
  captureMessage: (msg, level) => sent.push({ msg, level }),
  captureException: (err) => sent.push({ err }),
};

// The stub stays active for the whole test, because initSentry() loads @sentry/node lazily.
let packageInstalled = true;
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === "@sentry/node") {
    if (!packageInstalled) throw new Error("Cannot find module '@sentry/node'");
    return fakeSentry;
  }
  return originalLoad.apply(this, arguments);
};

function load(withPackage) {
  packageInstalled = withPackage;
  delete require.cache[libPath];
  return require(libPath);
}

function respond(lib, req, status, body) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  lib.sentryResponseMonitor(req, res, () => {});
  res.status(status).json(body);
  return res;
}

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const log = console.log; const warn = console.warn;
console.log = () => {}; console.warn = () => {};
try {
  // Disabled without DSN.
  delete process.env.SENTRY_DSN;
  let lib = load(true);
  ok(lib.initSentry() === false, "no DSN -> disabled");
  respond(lib, { method: "GET", originalUrl: "/reports/mine" }, 500, { error: "X" });
  ok(sent.length === 0, "nothing sent when disabled");

  // Disabled when the package is missing.
  process.env.SENTRY_DSN = "https://key@o1.ingest.de.sentry.io/1";
  lib = load(false);
  ok(lib.initSentry() === false, "missing package -> disabled, server still starts");

  // Enabled.
  process.env.SENTRY_ENVIRONMENT = "staging";
  lib = load(true);
  ok(lib.initSentry() === true, "enabled with DSN and package");
  ok(fakeSentry.options.sendDefaultPii === false && fakeSentry.options.environment === "staging", "no PII, environment tag");
  const ev = fakeSentry.options.beforeSend({ request: { data: "secret" }, user: { email: "a@b.no" }, message: "m" });
  ok(!ev.request && !ev.user, "request body and user removed before sending");

  const res = respond(lib, { method: "POST", originalUrl: "/reports/0f8fad5b-d9cb-469f-a165-70867728950e/images?token=abc" }, 500, { error: "Server error" });
  ok(res.body.error === "Server error", "response unchanged");
  ok(sent.length === 1 && sent[0].msg === "HTTP 500 POST /reports/:id/images: Server error", "500 reported with masked id and no query");
  ok(!sent[0].msg.includes("token"), "query string never sent");
  ok(fakeSentry.lastScope.tags["http.route"] === "/reports/:id/images", "route tag");

  respond(lib, { method: "GET", originalUrl: "/matches" }, 403, { error: "GUEST_NOT_ALLOWED" });
  respond(lib, { method: "GET", originalUrl: "/matches" }, 200, { ok: true });
  ok(sent.length === 1, "4xx and 2xx are not reported");
} finally {
  console.log = log; console.warn = warn;
}

// App and server wiring.
const index = fs.readFileSync(path.join(root, "server", "index.js"), "utf8");
ok(/initSentry\(\);/.test(index) && /app\.use\(sentryResponseMonitor\);/.test(index), "server wires Sentry");
const appSentry = fs.readFileSync(path.join(root, "src", "lib", "sentry.ts"), "utf8");
ok(/export function reportHandledError/.test(appSentry) && /export async function sendSentryTestEvent/.test(appSentry), "app helpers exist");
const profile = fs.readFileSync(path.join(root, "app", "(tabs)", "profile.tsx"), "utf8");
ok(/EXPO_PUBLIC_APP_ENV === "staging"/.test(profile), "test button only in staging builds");

console.log(`OK: T1.9D Sentry tests passed (${n} assertions).`);
