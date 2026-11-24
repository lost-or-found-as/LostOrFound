// scripts/test-t1-9bv.js
// T1.9BV: Sign in with Apple (iPhone) and Google (both platforms); Apple's access is revoked when
// the account is deleted.
//   node .\scripts\test-t1-9bv.js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

(async () => {
  const apple = require(path.join(root, "server/lib/appleSignIn.js"));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });

  // Settings: own Sign in with Apple key, or the APNs key when it has both services.
  ok(!apple.appleConfig({}).configured, "not configured without a key");
  const viaApns = apple.appleConfig({ APNS_KEY_ID: "K1", APNS_TEAM_ID: "T1", APNS_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
  ok(viaApns.configured && viaApns.clientId === "com.kjfok.lostorfound", "falls back to the APNs key and the app's bundle id");
  const own = apple.appleConfig({ APPLE_SIGNIN_KEY_ID: "S1", APPLE_TEAM_ID: "T2", APPLE_SIGNIN_PRIVATE_KEY: pem, APNS_KEY_ID: "K1" });
  eq([own.keyId, own.teamId], ["S1", "T2"], "own Sign in with Apple key wins");

  // Client secret: ES256, audience Apple, subject the app.
  const secret = apple.clientSecret({ ...own, privateKey: pem }, 1_800_000_000_000);
  const [h, c, sig] = secret.split(".");
  eq(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "S1" }, "secret header");
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  eq([claims.iss, claims.aud, claims.sub, claims.exp - claims.iat], ["T2", "https://appleid.apple.com", "com.kjfok.lostorfound", 3600], "secret claims");
  ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")), "secret verifies");

  // Exchange and revoke against a fake Apple.
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
    if (url.endsWith("/auth/token")) return { ok: true, status: 200, text: async () => JSON.stringify({ refresh_token: "r.efresh-token-123" }) };
    return { ok: true, status: 200, text: async () => "" };
  };
  const env = { APPLE_SIGNIN_KEY_ID: "S1", APPLE_TEAM_ID: "T2", APPLE_SIGNIN_PRIVATE_KEY: pem };
  eq((await apple.exchangeCode("c.abcdefghij123", { env, fetchImpl: fakeFetch })).refreshToken, "r.efresh-token-123", "code swapped for a refresh token");
  eq(calls[0].body.grant_type, "authorization_code", "authorization_code grant");
  eq(calls[0].body.client_id, "com.kjfok.lostorfound", "client id");
  eq((await apple.exchangeCode("bad code!", { env, fetchImpl: fakeFetch })).reason, "APPLE_CODE_INVALID", "odd codes refused");
  eq((await apple.exchangeCode("c.abcdefghij123", { env: {}, fetchImpl: fakeFetch })).reason, "APPLE_NOT_CONFIGURED", "nothing sent without settings");
  ok((await apple.revokeToken("r.efresh-token-123", { env, fetchImpl: fakeFetch })).ok, "revoke");
  eq(calls[calls.length - 1].body.token_type_hint, "refresh_token", "revokes the refresh token");
  const fakeSupa = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ refresh_token: "r.one-token-12" }, { refresh_token: "r.two-token-12" }], error: null }) }) }) };
  eq(await apple.revokeForUser(fakeSupa, "u1", { env, fetchImpl: fakeFetch, log: { warn() {} } }), 2, "all of the user's Apple tokens revoked");
  const brokenSupa = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: new Error("down") }) }) }) };
  eq(await apple.revokeForUser(brokenSupa, "u1", { env, fetchImpl: fakeFetch, log: { warn() {} } }), 0, "deletion is not blocked by a revoke problem");

  // Wiring.
  ok(/revokeForUser\(supa, userId, \{ log \}\)[\s\S]*auth\.admin\.deleteUser/.test(read("server/lib/accountDeletion.js")), "revoked before the account is deleted");
  ok(/router\.post\("\/apple-token", requireUser/.test(read("server/routes/account.js")), "apple-token route");
  ok(/"apple_sign_in_tokens", "user_id", \["refresh_token"\]/.test(read("server/lib/privacyExport.js")), "privacy export without the token");
  const sql = read("supabase/migrations/20261127100000_t1_9bv_apple_sign_in_tokens.sql");
  ok(/enable row level security/.test(sql) && /revoke all on table public\.apple_sign_in_tokens from anon, authenticated/.test(sql), "server only");

  // App.
  const social = read("src/lib/socialSignIn.ts");
  ok(/requestedScopes: \[AppleAuthentication\.AppleAuthenticationScope\.EMAIL\]/.test(social), "Apple asks for e-mail only");
  ok(/nonce: hashedNonce/.test(social) && /nonce: rawNonce/.test(social), "hashed nonce to Apple, raw nonce to Supabase");
  ok(/signInWithIdToken\(\{ provider: "apple"/.test(social), "Supabase ID token sign-in");
  ok(/openAuthSessionAsync\(data\.url, redirectTo\)/.test(social) && /skipBrowserRedirect: true/.test(social), "Google in a secure in-app browser on iPhone");
  ok(/rememberGuestForClaim\(\)/.test(social), "a guest's found reports follow to the account");
  const login = read("app/(auth)/login.tsx");
  ok(/AppleAuthenticationButton/.test(login) && /appleReady &&/.test(login), "Apple's own button, only where available");
  ok(/const SHOW_GOOGLE = true;/.test(login), "Google on both platforms");
  ok(/if \(!isCancelled\(e\)\) setError/.test(login), "closing the sheet is not an error");
  const app = JSON.parse(read("app.json")).expo;
  eq(app.ios.usesAppleSignIn, true, "Sign in with Apple capability");
  ok(app.plugins.includes("expo-apple-authentication"), "plugin");
  const pkg = JSON.parse(read("package.json"));
  ok(pkg.dependencies["expo-apple-authentication"] && pkg.dependencies["expo-crypto"], "packages installed");

  console.log(`OK: T1.9BV ${n} checks`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
