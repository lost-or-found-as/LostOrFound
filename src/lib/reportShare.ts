// src/lib/reportShare.ts
// T1.9AK: share a lost case as a public page and a printable poster. The link holds a random
// code; the page shows no owner, exact place, chip number or reward. Stopping makes the link dead.
import { supabase } from "./supabase";
import { API_BASE_URL } from "./config";
import type { Lang } from "../i18n/languages";

async function call(reportId: string, method: "POST" | "DELETE"): Promise<any> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  const res = await fetch(`${API_BASE_URL}/reports/${encodeURIComponent(reportId)}/share`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP_${res.status}`), { code: data?.error || "SHARE_FAILED" });
  return data;
}

/** The share code (the same one while the case stays shared). */
export async function startSharing(reportId: string): Promise<string> {
  const data = await call(reportId, "POST");
  if (!data?.token) throw Object.assign(new Error("SHARE_FAILED"), { code: "SHARE_FAILED" });
  return String(data.token);
}

export async function stopSharing(reportId: string): Promise<void> {
  await call(reportId, "DELETE");
}

/** Page and poster addresses; the public pages exist in Norwegian and English. */
export function shareUrls(token: string, language: Lang): { page: string; poster: string } {
  const lang = language === "no" ? "no" : "en";
  const base = `${API_BASE_URL}/s/${encodeURIComponent(token)}`;
  return { page: `${base}?lang=${lang}`, poster: `${base}/poster?lang=${lang}` };
}
