// T1.9BJ: «Meldinger» – all conversations in one list (GET /inbox).
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { getLastSeenMap } from "./unread";

export type InboxItem = {
  kind: "MATCH" | "OBSERVATION";
  id: string;
  reportId: string;
  role: "OWNER" | "FINDER" | "HELPER";
  observationType?: "SEEN" | "FOUND";
  hasConversation?: boolean;
  subject: Record<string, any> | null;
  caseClosed: boolean;
  last: { body: string; at: string; mine: boolean } | null;
  at: string;
  unread?: boolean;
};

/** The key the chats use when they mark a conversation as seen on this phone. */
export function seenKey(item: Pick<InboxItem, "kind" | "id">) {
  return item.kind === "MATCH" ? item.id : `obs:${item.id}`;
}

export async function fetchInbox(): Promise<InboxItem[]> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  const [seen, r] = await Promise.all([
    getLastSeenMap().catch(() => ({} as Record<string, string>)),
    fetch(`${API_BASE_URL}/inbox`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(String(j?.error || `HTTP_${r.status}`)), { code: String(j?.error || `HTTP_${r.status}`), status: r.status });
  const items: InboxItem[] = Array.isArray(j?.items) ? j.items : [];
  return items.map((item) => {
    const seenAt = seen[seenKey(item)];
    const fromOther = !!item.last && !item.last.mine;
    const unread = fromOther && (!seenAt || Date.parse(item.last!.at) > Date.parse(seenAt));
    return { ...item, unread };
  });
}
