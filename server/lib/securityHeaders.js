"use strict";
// T1.9BN: basic browser security headers on every answer, and an optional guard so only
// traffic through our own Cloudflare reaches the API once it sits in front of Render.

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

// Paths that must answer without the shared secret (Render's health check).
const ORIGIN_GUARD_OPEN_PATHS = new Set(["/"]);

/**
 * When ORIGIN_SHARED_SECRET is set, every request must carry it in X-Origin-Auth (Cloudflare adds
 * the header with a Transform Rule). Requests that go straight to the onrender.com address are
 * refused with 403 ORIGIN_NOT_ALLOWED. Without the variable nothing changes.
 */
function originGuard(env = process.env) {
  return function originGuardMiddleware(req, res, next) {
    const secret = String(env.ORIGIN_SHARED_SECRET || "");
    if (!secret) return next();
    if (ORIGIN_GUARD_OPEN_PATHS.has(req.path)) return next();
    const sent = String(req.headers["x-origin-auth"] || "");
    if (sent.length === secret.length && require("crypto").timingSafeEqual(Buffer.from(sent), Buffer.from(secret))) return next();
    return res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
  };
}

module.exports = { securityHeaders, originGuard, ORIGIN_GUARD_OPEN_PATHS };
