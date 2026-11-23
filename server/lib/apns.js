"use strict";
// T1.9BT: sends Live Activity updates straight to Apple (APNs). Expo's push service cannot do this.
// Settings (Render, secret):
//   APNS_KEY_ID        the key's id from Apple Developer → Keys
//   APNS_TEAM_ID       the Apple team id
//   APNS_PRIVATE_KEY   the .p8 file's contents (line breaks may be written as \n)
//   APNS_BUNDLE_ID     the app's bundle id (default com.kjfok.lostorfound)
//   APNS_ENV           production (TestFlight and App Store, default) or sandbox (development builds)
// Nothing here throws to the caller: send() returns { ok, status, reason }.
const crypto = require("crypto");
const http2 = require("http2");

const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };
const JWT_TTL_MS = 50 * 60 * 1000; // Apple accepts a token for up to an hour.
const TIMEOUT_MS = 10000;
// Apple's answer that the token is dead: the activity has ended or the app was removed.
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "ExpiredToken", "DeviceTokenNotForTopic"]);

function apnsConfig(env = process.env) {
  const keyId = String(env.APNS_KEY_ID || "").trim();
  const teamId = String(env.APNS_TEAM_ID || "").trim();
  const privateKey = String(env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  const bundleId = String(env.APNS_BUNDLE_ID || "com.kjfok.lostorfound").trim();
  const mode = String(env.APNS_ENV || "production").trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
  return { keyId, teamId, privateKey, bundleId, mode, host: HOSTS[mode] };
}

function apnsConfigured(env = process.env) {
  const c = apnsConfig(env);
  return !!(c.keyId && c.teamId && c.privateKey.includes("PRIVATE KEY"));
}

const b64url = (input) => Buffer.from(input).toString("base64url");

/** ES256 JWT for APNs: header { alg, kid }, claims { iss, iat }. */
function signJwt({ keyId, teamId, privateKey, now = Date.now() }) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const data = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${data}.${signature.toString("base64url")}`;
}

let cachedJwt = null;
function jwtFor(config, now = Date.now()) {
  if (cachedJwt && cachedJwt.keyId === config.keyId && now - cachedJwt.at < JWT_TTL_MS) return cachedJwt.token;
  const token = signJwt({ ...config, now });
  cachedJwt = { keyId: config.keyId, at: now, token };
  return token;
}

/**
 * The Live Activity payload. contentState is what the app's Live Activity reads:
 * { name, props } where props is a JSON string (expo-widgets' ContentState).
 * event: "update" or "end". Dates are Date objects or null.
 */
function liveActivityPayload({ event, name, props, staleDate = null, dismissalDate = null, now = Date.now() }) {
  const aps = {
    timestamp: Math.floor(now / 1000),
    event,
    "content-state": { name, props: JSON.stringify(props ?? {}) },
  };
  if (staleDate) aps["stale-date"] = Math.floor(staleDate.getTime() / 1000);
  if (event === "end" && dismissalDate) aps["dismissal-date"] = Math.floor(dismissalDate.getTime() / 1000);
  return { aps };
}

function liveActivityHeaders(config, jwt, priority) {
  return {
    ":method": "POST",
    authorization: `bearer ${jwt}`,
    "apns-topic": `${config.bundleId}.push-type.liveactivity`,
    "apns-push-type": "liveactivity",
    // 10 = now (counts against the activity's budget), 5 = when convenient.
    "apns-priority": String(priority === 5 ? 5 : 10),
  };
}

function isDeadToken(result) {
  return result.status === 410 || (result.status === 400 && DEAD_TOKEN_REASONS.has(result.reason));
}

let session = null;
function getSession(host) {
  if (session && !session.closed && !session.destroyed && session.host === host) return session;
  session = http2.connect(host);
  session.host = host;
  session.on("error", () => {
    session = null;
  });
  session.on("goaway", () => {
    session = null;
  });
  session.unref?.();
  return session;
}

/** Sends one Live Activity push. Returns { ok, status, reason }. */
async function sendLiveActivity(pushToken, payload, { priority = 10, env = process.env } = {}) {
  if (!apnsConfigured(env)) return { ok: false, status: 0, reason: "APNS_NOT_CONFIGURED" };
  if (!/^[0-9a-fA-F]{16,400}$/.test(String(pushToken || ""))) return { ok: false, status: 0, reason: "BAD_TOKEN_FORMAT" };
  const config = apnsConfig(env);
  let jwt;
  try {
    jwt = jwtFor(config);
  } catch (e) {
    return { ok: false, status: 0, reason: "APNS_KEY_INVALID" };
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    try {
      const s = getSession(config.host);
      const req = s.request({ ...liveActivityHeaders(config, jwt, priority), ":path": `/3/device/${pushToken}` });
      req.setTimeout(TIMEOUT_MS, () => {
        req.close();
        finish({ ok: false, status: 0, reason: "TIMEOUT" });
      });
      let status = 0;
      let body = "";
      req.on("response", (headers) => {
        status = Number(headers[":status"] || 0);
      });
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let reason = null;
        try {
          reason = body ? JSON.parse(body).reason || null : null;
        } catch {
          reason = null;
        }
        finish({ ok: status === 200, status, reason });
      });
      req.on("error", (e) => finish({ ok: false, status: 0, reason: e?.code || "REQUEST_FAILED" }));
      req.end(JSON.stringify(payload));
    } catch (e) {
      finish({ ok: false, status: 0, reason: e?.code || "REQUEST_FAILED" });
    }
  });
}

module.exports = { apnsConfig, apnsConfigured, signJwt, liveActivityPayload, liveActivityHeaders, isDeadToken, sendLiveActivity };
