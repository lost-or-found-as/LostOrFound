// src/lib/itemTags.ts
// T1.9BS: QR tags for things the user is afraid to lose. A finder scans the code, writes on a web
// page without the app, and the owner answers here. Neither sees the other's contact details.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError } from "./userError";
import type { TranslationKey } from "../i18n/locales/en";
import type { Lang } from "../i18n/languages";

export const TAG_KINDS = ["KEYS", "BAG", "WALLET", "PHONE", "BIKE", "PET", "OTHER"] as const;
export type TagKind = (typeof TAG_KINDS)[number];
export const TAG_KIND_KEYS: Record<TagKind, TranslationKey> = {
  KEYS: "tags.kind.keys",
  BAG: "tags.kind.bag",
  WALLET: "tags.kind.wallet",
  PHONE: "tags.kind.phone",
  BIKE: "tags.kind.bike",
  PET: "tags.kind.pet",
  OTHER: "tags.kind.other",
};
export const TAG_KIND_ICONS: Record<TagKind, string> = {
  KEYS: "key-outline",
  BAG: "bag-handle-outline",
  WALLET: "wallet-outline",
  PHONE: "phone-portrait-outline",
  BIKE: "bicycle-outline",
  PET: "paw-outline",
  OTHER: "pricetag-outline",
};
export const TAG_LABEL_MAX = 40;
export const TAG_MESSAGE_MAX = 1000;

export type ItemTag = {
  id: string;
  code: string;
  displayCode: string;
  label: string | null;
  kind: TagKind;
  active: boolean;
  created_at: string;
  pageUrl: string;
  printUrl: string;
  threads?: number;
  unread?: number;
};

export type TagThread = {
  id: string;
  tag_id: string;
  status: "OPEN" | "CLOSED" | "BLOCKED";
  last_message_at: string;
  created_at: string;
  unread?: boolean;
  lastMessage?: { sender: "FINDER" | "OWNER"; body: string; created_at: string } | null;
};

export type TagMessage = { id: string; sender: "FINDER" | "OWNER"; body: string; created_at: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw codedError("AUTH_REQUIRED");
  const r = await fetch(`${API_BASE_URL}/tags${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(j?.error || `HTTP_${r.status}`)), { status: r.status });
  return j as T;
}

export async function fetchMyTags() {
  return request<{ tags: ItemTag[]; maxTags: number }>("/mine");
}

export async function createTag(input: { label: string; kind: TagKind }) {
  return (await request<{ tag: ItemTag }>("", { method: "POST", body: JSON.stringify(input) })).tag;
}

export async function claimTag(input: { code: string; label: string; kind: TagKind }) {
  return (await request<{ tag: ItemTag }>("/claim", { method: "POST", body: JSON.stringify(input) })).tag;
}

export async function updateTag(id: string, patch: Partial<{ label: string; kind: TagKind; active: boolean }>) {
  return (await request<{ tag: ItemTag }>(`/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).tag;
}

export async function deleteTag(id: string) {
  await request<{ ok: true }>(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchTagThreads(id: string) {
  return request<{ tag: ItemTag; threads: TagThread[] }>(`/${encodeURIComponent(id)}/threads`);
}

export async function fetchTagThread(threadId: string) {
  return request<{ thread: TagThread; tag: ItemTag | null; messages: TagMessage[] }>(`/threads/${encodeURIComponent(threadId)}`);
}

export async function replyToTagThread(threadId: string, message: string) {
  return (await request<{ message: TagMessage }>(`/threads/${encodeURIComponent(threadId)}/reply`, { method: "POST", body: JSON.stringify({ message: message.trim() }) })).message;
}

export async function setTagThreadStatus(threadId: string, status: TagThread["status"]) {
  await request<{ ok: true }>(`/threads/${encodeURIComponent(threadId)}/status`, { method: "POST", body: JSON.stringify({ status }) });
}

/** The public pages exist in Norwegian and English. */
export function tagUrlWithLanguage(url: string, language: Lang) {
  return `${url}?lang=${language === "no" ? "no" : "en"}`;
}

/** "abcd 2345" -> "ABCD-2345" while typing (letters and digits only, max eight). */
export function formatTagCodeInput(input: string) {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

/** A user-facing error key for a tag error code. */
export function tagErrorKey(code: string): TranslationKey {
  switch (code) {
    case "TAG_LIMIT":
      return "tags.error.limit";
    case "TAG_CODE_INVALID":
      return "tags.error.codeInvalid";
    case "TAG_CODE_UNAVAILABLE":
      return "tags.error.codeUnavailable";
    case "TAG_ALREADY_YOURS":
      return "tags.error.alreadyYours";
    case "TAG_THREAD_BLOCKED":
      return "tags.error.blocked";
    case "MESSAGE_RATE_LIMIT":
      return "tags.error.rate";
    default:
      return "tags.error.generic";
  }
}
