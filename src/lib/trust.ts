// src/lib/trust.ts
// T1.9BP: control questions, the handover code and thank-you cards (server: /trust).
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError } from "./userError";
import type { TranslationKey } from "../i18n/locales/en";

export type TrustKind = "MATCH" | "OBSERVATION";
export type QuestionStatus = "ASKED" | "ANSWERED" | "CONFIRMED" | "NO_MATCH";
export type ThanksDesign = "HEART" | "SUN" | "STAR";
export const THANKS_DESIGNS: ThanksDesign[] = ["HEART", "SUN", "STAR"];
export const THANKS_ICONS: Record<ThanksDesign, string> = { HEART: "heart", SUN: "sunny", STAR: "star" };
export const TRUST_TEXT_MAX = 140;

export type ThanksCard = { id: string; design: ThanksDesign; message: string; created_at: string };
export type TrustState = {
  role: "OWNER" | "HELPER";
  canHandOver: boolean;
  resolved: boolean;
  question: { id: string; question: string; answer: string | null; status: QuestionStatus; attempts: number; maxAttempts: number } | null;
  questionsUsed: number;
  maxQuestions: number;
  canAsk: boolean;
  handover: { code: string | null; used: boolean; locked: boolean } | null;
  thanks: ThanksCard | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw codedError("AUTH_REQUIRED");
  const r = await fetch(`${API_BASE_URL}/trust${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(j?.error || `HTTP_${r.status}`)), { status: r.status });
  return j as T;
}

const ctx = (kind: TrustKind, id: string) => `/${kind}/${encodeURIComponent(id)}`;
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const fetchTrust = (kind: TrustKind, id: string) => request<TrustState>(ctx(kind, id));
export const askQuestion = (kind: TrustKind, id: string, question: string) => request(`${ctx(kind, id)}/question`, post({ question }));
export const answerQuestion = (qid: string, answer: string) => request(`/question/${encodeURIComponent(qid)}/answer`, post({ answer }));
export const judgeAnswer = (qid: string, matches: boolean) =>
  request<{ status: QuestionStatus; triesLeft: number }>(`/question/${encodeURIComponent(qid)}/judge`, post({ matches }));
export const confirmHandover = (kind: TrustKind, id: string, code: string) => request(`${ctx(kind, id)}/handover`, post({ code }));
export const sendThanks = (kind: TrustKind, id: string, design: ThanksDesign, message: string) =>
  request(`${ctx(kind, id)}/thanks`, post({ design, message }));
export const fetchMyThanks = async () => (await request<{ cards: ThanksCard[] }>("/thanks/me")).cards || [];

/** Safe meeting places: opened as a search in the phone's map app, near where the user is. */
export const SAFE_PLACES: { key: string; icon: string; label: TranslationKey; query: TranslationKey }[] = [
  { key: "police", icon: "shield-outline", label: "trust.place.police", query: "trust.placeQuery.police" },
  { key: "station", icon: "train-outline", label: "trust.place.station", query: "trust.placeQuery.station" },
  { key: "store", icon: "storefront-outline", label: "trust.place.store", query: "trust.placeQuery.store" },
];

export function mapsSearchUrl(query: string, platform: string) {
  const q = encodeURIComponent(query);
  return platform === "ios" ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
