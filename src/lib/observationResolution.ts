// src/lib/observationResolution.ts
// T1.9W: "the case is resolved" for an observation. Either side proposes, the other confirms or
// declines. Shared by the observation detail screen and the observation chat.
// Same API as before: GET /resolutions/context/OBSERVATION/:id, POST /resolutions/propose,
// POST /resolutions/:proposalId/respond.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";
import { codedError, userErrorMessage } from "./userError";

export type ObservationResolution = {
  proposal?: { id: string; status: string } | null;
  role?: "PROPOSER" | "RESPONDER" | "PARTY";
} | null;

// Result of the user's own last action, shown as a short notice.
export type ResolutionNotice = "sent" | "closed" | "rejected" | null;

async function authToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

async function failIfNotOk(r: Response, fallbackCode: string, allowed?: string) {
  const j = await r.json().catch(() => ({}));
  if (r.ok || (allowed && j?.error === allowed)) return j;
  throw Object.assign(codedError(String(j?.error || fallbackCode)), { status: r.status });
}

export function useObservationResolution(observationId: string | undefined) {
  const { t } = useI18n();
  const [resolution, setResolution] = useState<ObservationResolution>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ResolutionNotice>(null);

  const reload = useCallback(async () => {
    try {
      const token = await authToken();
      if (!token || !observationId) return;
      const r = await fetch(`${API_BASE_URL}/resolutions/context/OBSERVATION/${encodeURIComponent(String(observationId))}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setResolution(j);
    } catch {
      // The resolution bar is optional; the screen works without it.
    }
  }, [observationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const propose = useCallback(async (): Promise<boolean> => {
    if (!observationId) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await authToken();
      const r = await fetch(`${API_BASE_URL}/resolutions/propose`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contextType: "OBSERVATION", contextId: String(observationId) }),
      });
      await failIfNotOk(r, "RESOLUTION_PROPOSE_FAILED", "RESOLUTION_ALREADY_PENDING");
      setNotice("sent");
      await reload();
      return true;
    } catch (e) {
      setError(userErrorMessage(e, t, "errors.generic", "resolution"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [observationId, reload, t]);

  const respond = useCallback(
    async (accept: boolean) => {
      const proposalId = resolution?.proposal?.id;
      if (!proposalId) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const token = await authToken();
        const r = await fetch(`${API_BASE_URL}/resolutions/${proposalId}/respond`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accept }),
        });
        await failIfNotOk(r, "RESOLUTION_RESPOND_FAILED");
        setNotice(accept ? "closed" : "rejected");
        await reload();
      } catch (e) {
        setError(userErrorMessage(e, t, "errors.generic", "resolution"));
      } finally {
        setBusy(false);
      }
    },
    [resolution?.proposal?.id, reload, t],
  );

  return {
    resolution,
    status: resolution?.proposal?.status ?? null,
    role: resolution?.role ?? null,
    busy,
    error,
    notice,
    reload,
    propose,
    respond,
  };
}

export type ObservationResolutionController = ReturnType<typeof useObservationResolution>;
