// server/lib/sentry.js
"use strict";

// T1.9D: server errors go to Sentry (project lost-or-found-api).
// Off unless SENTRY_DSN is set and @sentry/node is installed, so local runs and tests work
// without it. Only technical data is sent: method, route path (no query string), status and
// the English error code. Request bodies, headers, tokens and user details are never sent.

let Sentry = null;

function initSentry() {
  const dsn = String(process.env.SENTRY_DSN || "").trim();
  if (!dsn) {
    console.log("[sentry] disabled (SENTRY_DSN not set)");
    return false;
  }
  try {
    Sentry = require("@sentry/node");
  } catch {
    console.warn("[sentry] disabled (@sentry/node is not installed)");
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
  console.log(`[sentry] enabled (${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development"})`);
  return true;
}

function routePath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0]
    // Ids in paths are not useful for grouping and may identify a report or user.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
}

// Reports every response with status 500 or higher. Route handlers catch their own errors
// and answer with res.status(500).json(...), so this is where server failures become visible.
// T1.9BD: states that are switched off on purpose are not errors (no alert e-mail).
const EXPECTED_CODES = new Set(["IMAGE_ANALYSIS_DISABLED"]);

// T1.9BE: many routes still answer a database failure with 400 and the raw database text.
// Such an answer is a server fault (for example a column the code expects but the database
// lacks), so it is logged and reported like a 500. Ordinary 400s (bad input) are left alone.
const DB_FAULT = /does not exist|schema cache|could not find the .* column|relation .* does not|syntax error|permission denied for/i;

function isDatabaseFault(status, body) {
  return status >= 400 && status < 500 && typeof body?.error === "string" && DB_FAULT.test(body.error);
}

function sentryResponseMonitor(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (isDatabaseFault(res.statusCode, body)) {
      const path = routePath(req);
      console.error(`[db-fault] ${req.method} ${path} ${res.statusCode}: ${String(body.error).slice(0, 200)}`);
      if (Sentry) {
        Sentry.withScope((scope) => {
          scope.setTag("http.method", req.method);
          scope.setTag("http.route", path);
          scope.setTag("http.status", String(res.statusCode));
          scope.setFingerprint([req.method, path, "DB_FAULT"]);
          Sentry.captureMessage(`DB fault ${req.method} ${path}: ${String(body.error).slice(0, 120)}`, "error");
        });
      }
      return originalJson(body);
    }
    if (!Sentry) return originalJson(body);
    const expected = typeof body?.error === "string" && EXPECTED_CODES.has(body.error);
    if (res.statusCode >= 500 && !expected) {
      const code = typeof body?.error === "string" ? body.error.slice(0, 120) : "UNKNOWN";
      const path = routePath(req);
      Sentry.withScope((scope) => {
        scope.setTag("http.method", req.method);
        scope.setTag("http.route", path);
        scope.setTag("http.status", String(res.statusCode));
        scope.setFingerprint([req.method, path, String(res.statusCode), code]);
        Sentry.captureMessage(`HTTP ${res.statusCode} ${req.method} ${path}: ${code}`, "error");
      });
    }
    return originalJson(body);
  };
  next();
}

function captureServerException(error, tags = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) scope.setTag(k, String(v));
    Sentry.captureException(error);
  });
}

module.exports = { initSentry, sentryResponseMonitor, captureServerException, isDatabaseFault };
