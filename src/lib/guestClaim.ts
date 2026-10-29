// src/lib/guestClaim.ts
// T1.9A: found reports submitted as a guest follow the person when they sign in on the
// same phone. Just before leaving the guest session (email login/sign-up or Google/Apple),
// the guest access token is stored locally. Once a registered session exists, the backend
// moves the guest's reports to that account (POST /account/claim-guest-reports).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./config";
import { isAnonymousUser } from "./authGate";
import { reportHandledError } from "./sentry";

const STORAGE_KEY = "lof.pendingGuestClaim.v1";
const MIN_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

type PendingClaim = { token: string; guestId: string; expiresAt: number };

async function readPending(): Promise<PendingClaim | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingClaim;
    if (!value?.token || !value?.guestId || !Number.isFinite(value.expiresAt)) return null;
    return value;
  } catch {
    return null;
  }
}

async function clearPending() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// Call right before the guest session is replaced by a sign-in or sign-up.
export async function rememberGuestForClaim(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    let session = data.session;
    if (!session?.user || !isAnonymousUser(session.user)) return;

    const expiresAtMs = (session.expires_at ?? 0) * 1000;
    if (expiresAtMs - Date.now() < MIN_TOKEN_LIFETIME_MS) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.data.session) session = refreshed.data.session;
    }

    const pending: PendingClaim = {
      token: session.access_token,
      guestId: session.user.id,
      expiresAt: (session.expires_at ?? 0) * 1000,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch (e) {
    console.warn("[guestClaim] could not remember guest session", e);
  }
}

let inFlight: Promise<number> | null = null;

// Call when a registered (non-guest) session is active. Returns the number of reports moved.
export function claimPendingGuestReports(accessToken: string): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const pending = await readPending();
    if (!pending) return 0;
    if (pending.expiresAt <= Date.now()) {
      await clearPending();
      return 0;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/account/claim-guest-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ guestAccessToken: pending.token }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        await clearPending();
        return Number(json?.moved) || 0;
      }
      // A 4xx answer will not get better by retrying; a 5xx is retried at the next sign-in event.
      if (res.status < 500) await clearPending();
      reportHandledError(new Error(`GUEST_CLAIM_HTTP_${res.status}`), "account.guest_claim", String(json?.error ?? res.status));
      return 0;
    } catch (e) {
      reportHandledError(e, "account.guest_claim", "NETWORK");
      return 0;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
