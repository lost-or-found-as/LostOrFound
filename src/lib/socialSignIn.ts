// src/lib/socialSignIn.ts
// T1.9BV: sign in with Apple (iPhone, native sheet) and Google (both platforms).
// - Apple: the app gets an ID token from iOS and hands it to Supabase with a nonce, so a stolen
//   token cannot be replayed. Only the e-mail is asked for (no name). The one-time authorization
//   code goes to our server, which keeps Apple's refresh token so it can be revoked when the
//   account is deleted (Apple requires that).
// - Google on iPhone: Supabase's sign-in page in a secure in-app browser that hands the session
//   straight back. Android keeps the earlier flow through the auth-callback link.
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { rememberGuestForClaim } from "./guestClaim";
import { codedError } from "./userError";

/** True on an iPhone that can show Sign in with Apple. */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** The user closed the Apple or Google sheet: not an error to show. */
export function isCancelled(e: unknown): boolean {
  const code = String((e as any)?.code || "");
  return code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED" || code === "SIGN_IN_CANCELLED";
}

async function sendAppleCode(authorizationCode: string | null) {
  if (!authorizationCode) return;
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return;
    await fetch(`${API_BASE_URL}/account/apple-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ authorizationCode }),
    });
  } catch (e) {
    // Sign-in already worked; the server only needs this to revoke Apple's access on deletion.
    console.warn("[signin] apple code not sent", e);
  }
}

export async function signInWithApple(): Promise<void> {
  if (!(await appleSignInAvailable())) throw codedError("APPLE_SIGNIN_UNAVAILABLE");
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  // T1.9BY: Apple's sheet opens first, before anything waits on Supabase, so the button always
  // answers. The guest session is remembered afterwards (with a time limit), still before the
  // new sign-in replaces it.
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) throw codedError("APPLE_NO_TOKEN");
  await rememberGuestForClaim();
  const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce: rawNonce });
  if (error) throw error;
  await sendAppleCode(credential.authorizationCode);
}

function paramsFrom(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  for (const part of [query, hash]) for (const [k, v] of new URLSearchParams(part).entries()) out[k] = v;
  return out;
}

/** Finishes a sign-in from the URL Supabase sent back (tokens in the hash, or a code). */
export async function completeSignInFromUrl(url: string): Promise<void> {
  const p = paramsFrom(url);
  if (p.error || p.error_description) throw codedError(String(p.error_code || p.error || "OAUTH_FAILED"));
  if (p.access_token && p.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
    if (error) throw error;
    return;
  }
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    if (error) throw error;
    return;
  }
  throw codedError("OAUTH_NO_SESSION");
}

/** Google on iPhone: a secure in-app browser that returns straight to the app. */
export async function signInWithGoogleInApp(): Promise<void> {
  await rememberGuestForClaim();
  const redirectTo = Linking.createURL("auth-callback");
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
  if (error) throw error;
  if (!data?.url) throw codedError("OAUTH_NOT_READY");
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success" || !result.url) throw codedError("SIGN_IN_CANCELLED");
  await completeSignInFromUrl(result.url);
}
