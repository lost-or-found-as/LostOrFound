// T1.9P: delete the signed-in account and everything tied to it (DELETE /account).
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError } from "./userError";

export async function deleteAccountRequest(): Promise<void> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw codedError("AUTH_REQUIRED");
  const r = await fetch(`${API_BASE_URL}/account`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(j?.error || `HTTP_${r.status}`)), { status: r.status });
}
