"use strict";
// T1.9BN: admin screens (reports, feedback, suspensions) need the admin's second step (2FA)
// once ADMIN_REQUIRE_MFA=true. The level comes from the access token that auth.js verified.
const { isAdmin } = require("../lib/chatSafety");

function adminMfaRequired(env = process.env) {
  return String(env.ADMIN_REQUIRE_MFA || "").toLowerCase() === "true";
}

/** Reads the aal claim from a JWT already checked by Supabase (auth.js). */
function tokenAal(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof payload?.aal === "string" ? payload.aal : null;
  } catch {
    return null;
  }
}

/** "ok", "NOT_ADMIN" or "ADMIN_MFA_REQUIRED". */
function adminAccess(userId, aal, env = process.env) {
  if (!isAdmin(userId, env)) return "NOT_ADMIN";
  if (adminMfaRequired(env) && aal !== "aal2") return "ADMIN_MFA_REQUIRED";
  return "ok";
}

function requireAdmin(req, res, next) {
  const access = adminAccess(req.user?.id, req.authAal);
  if (access !== "ok") return res.status(403).json({ error: access });
  return next();
}

module.exports = { adminMfaRequired, tokenAal, adminAccess, requireAdmin };
