// server/lib/rateLimits.js
// T1.9L: how much one user can create. Counted from the database (rows the user created in
// the window), so the limits hold across restarts and server instances.
"use strict";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Decided 31.10.2026: found reports 5 per day (guests 2). Lost reports keep their own weekly
// rule (2 per week) in routes/reports.js.
const LIMITS = Object.freeze({
  foundReports: { account: 5, guest: 2, windowMs: DAY_MS, code: "FOUND_REPORT_DAILY_LIMIT" },
  messagesPerMinute: { account: 30, windowMs: 60 * 1000, code: "MESSAGE_RATE_LIMIT" },
  messagesPerDay: { account: 500, windowMs: DAY_MS, code: "MESSAGE_RATE_LIMIT" },
  observations: { account: 20, guest: 20, windowMs: DAY_MS, code: "OBSERVATION_DAILY_LIMIT" },
});

function limitFor(name, isGuest) {
  const rule = LIMITS[name];
  return isGuest && rule.guest != null ? rule.guest : rule.account;
}

/**
 * Counts rows in `table` with `column` = userId created inside the window (plus optional eq
 * filters) and says whether one more is allowed.
 */
async function checkLimit(supaAdmin, { name, table, column, userId, isGuest = false, filters = {}, now = Date.now() }) {
  const rule = LIMITS[name];
  const limit = limitFor(name, isGuest);
  let query = supaAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, userId)
    .gte("created_at", new Date(now - rule.windowMs).toISOString());
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { count, error } = await query;
  if (error) throw error;
  const used = Number(count || 0);
  return { allowed: used < limit, used, limit, code: rule.code, windowHours: Math.round(rule.windowMs / HOUR_MS) || 0 };
}

/** The JSON body for a refused request. */
function limitResponse(result) {
  return { error: result.code, limit: result.limit, used: result.used };
}

// Per-address guard against floods of requests (all routes). In memory per server instance,
// which is enough to stop a script hammering the API; the per-user limits above are the real rules.
function ipRateLimit({ windowMs = 60 * 1000, max = 300 } = {}) {
  const hits = new Map();
  let sweepAt = Date.now() + windowMs;
  return function ipRateLimitMiddleware(req, res, next) {
    const now = Date.now();
    if (now > sweepAt) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
      sweepAt = now + windowMs;
    }
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const key = forwarded || req.socket?.remoteAddress || "unknown";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    }
    return next();
  };
}

module.exports = { LIMITS, limitFor, checkLimit, limitResponse, ipRateLimit };
