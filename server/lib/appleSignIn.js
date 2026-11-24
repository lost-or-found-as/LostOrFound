"use strict";
// T1.9BV: Sign in with Apple – what the server must do besides what Supabase does.
// Apple requires that an app which offers Sign in with Apple revokes the user's Apple tokens when
// the account is deleted. The app sends the one-time authorization code after signing in; we swap
// it for a refresh token here, keep it (server only), and revoke it when the account is deleted.
// Settings (Render, secret). One Apple key can have both APNs and Sign in with Apple switched on,
// so the APNs settings are used when the Sign in with Apple ones are missing:
//   APPLE_SIGNIN_KEY_ID / APNS_KEY_ID
//   APPLE_SIGNIN_PRIVATE_KEY / APNS_PRIVATE_KEY
//   APPLE_TEAM_ID / APNS_TEAM_ID
//   APPLE_CLIENT_ID (default APNS_BUNDLE_ID or com.kjfok.lostorfound)
// Nothing here throws to the caller.
const crypto = require("crypto");

const APPLE = "https://appleid.apple.com";
const SECRET_TTL_S = 60 * 60; // a fresh, short-lived client secret per call

function appleConfig(env = process.env) {
  const keyId = String(env.APPLE_SIGNIN_KEY_ID || env.APNS_KEY_ID || "").trim();
  const teamId = String(env.APPLE_TEAM_ID || env.APNS_TEAM_ID || "").trim();
  const privateKey = String(env.APPLE_SIGNIN_PRIVATE_KEY || env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  const clientId = String(env.APPLE_CLIENT_ID || env.APNS_BUNDLE_ID || "com.kjfok.lostorfound").trim();
  return { keyId, teamId, privateKey, clientId, configured: !!(keyId && teamId && privateKey.includes("PRIVATE KEY")) };
}

const b64url = (v) => Buffer.from(v).toString("base64url");

/** The client secret Apple wants: an ES256 JWT { iss: team, sub: client id, aud: appleid }. */
function clientSecret(config, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = b64url(JSON.stringify({ iss: config.teamId, iat, exp: iat + SECRET_TTL_S, aud: APPLE, sub: config.clientId }));
  const data = `${header}.${claims}`;
  const sig = crypto.sign("sha256", Buffer.from(data), { key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return `${data}.${sig.toString("base64url")}`;
}

async function post(path, form, fetchImpl) {
  const r = await fetchImpl(`${APPLE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await r.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: r.ok, status: r.status, json };
}

/** Swaps the one-time code for Apple's refresh token. Returns { ok, refreshToken?, reason? }. */
async function exchangeCode(code, { env = process.env, fetchImpl = fetch } = {}) {
  const config = appleConfig(env);
  if (!config.configured) return { ok: false, reason: "APPLE_NOT_CONFIGURED" };
  if (!/^[A-Za-z0-9._-]{10,2000}$/.test(String(code || ""))) return { ok: false, reason: "APPLE_CODE_INVALID" };
  try {
    const r = await post("/auth/token", { client_id: config.clientId, client_secret: clientSecret(config), code, grant_type: "authorization_code" }, fetchImpl);
    if (!r.ok || !r.json?.refresh_token) return { ok: false, reason: r.json?.error || `HTTP_${r.status}` };
    return { ok: true, refreshToken: String(r.json.refresh_token) };
  } catch (e) {
    return { ok: false, reason: e?.code || "APPLE_REQUEST_FAILED" };
  }
}

/** Revokes Apple's access for this user. Returns { ok, reason? }. */
async function revokeToken(refreshToken, { env = process.env, fetchImpl = fetch } = {}) {
  const config = appleConfig(env);
  if (!config.configured) return { ok: false, reason: "APPLE_NOT_CONFIGURED" };
  try {
    const r = await post("/auth/revoke", { client_id: config.clientId, client_secret: clientSecret(config), token: refreshToken, token_type_hint: "refresh_token" }, fetchImpl);
    return r.ok ? { ok: true } : { ok: false, reason: r.json?.error || `HTTP_${r.status}` };
  } catch (e) {
    return { ok: false, reason: e?.code || "APPLE_REQUEST_FAILED" };
  }
}

/** For account deletion: revoke every stored Apple token of the user. Never throws. */
async function revokeForUser(supa, userId, { env = process.env, fetchImpl = fetch, log = console } = {}) {
  try {
    const q = await supa.from("apple_sign_in_tokens").select("refresh_token").eq("user_id", userId);
    if (q.error) throw q.error;
    for (const row of q.data || []) {
      const r = await revokeToken(row.refresh_token, { env, fetchImpl });
      if (!r.ok) log.warn?.("[apple] revoke failed", r.reason);
    }
    return (q.data || []).length;
  } catch (e) {
    log.warn?.("[apple] revoke lookup failed", e?.message ?? e);
    return 0;
  }
}

module.exports = { appleConfig, clientSecret, exchangeCode, revokeToken, revokeForUser };
