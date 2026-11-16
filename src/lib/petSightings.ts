// src/lib/petSightings.ts
// T1.9AL: "Sist sett" on a lost animal case – where it went missing and where people have seen it
// since (GET /reports/:id/sightings). The helpers below are pure so they can be tested.
import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";

export type SightingStart = { at: string | null; latitude: number; longitude: number; label: string | null };
export type Sighting = {
  id: string;
  // T1.9AN: TIP = a tip the owner put on the map (source OWNER).
  kind: "SEEN" | "FOUND" | "TIP";
  source?: "AREA_ALERT" | "OWNER";
  at: string;
  comment: string | null;
  direction: string | null;
  latitude: number;
  longitude: number;
  isNew: boolean;
};
export type Sightings = { start: SightingStart | null; sightings: Sighting[] };

export const EMPTY_SIGHTINGS: Sightings = { start: null, sightings: [] };

export async function fetchSightings(reportId: string): Promise<Sightings> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  const res = await fetch(`${API_BASE_URL}/reports/${encodeURIComponent(reportId)}/sightings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(String(body?.error || `HTTP_${res.status}`)), { code: body?.error });
  return {
    start: body?.start ?? null,
    sightings: Array.isArray(body?.sightings) ? body.sightings : [],
  };
}

async function authHeaders() {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(String(body?.error || `HTTP_${res.status}`)), { code: body?.error });
  return body;
}

/** T1.9AN: the owner puts a tip they got outside the app on the map. */
export async function addOwnerTip(reportId: string, tip: { latitude: number; longitude: number; seenAt: string; note: string | null }) {
  return call(`/reports/${encodeURIComponent(reportId)}/sightings`, { method: "POST", body: JSON.stringify(tip) });
}

export async function deleteOwnerTip(reportId: string, tipId: string) {
  return call(`/reports/${encodeURIComponent(reportId)}/sightings/${encodeURIComponent(tipId)}`, { method: "DELETE" });
}

/** An owner tip cannot be in the future. */
export function tipTimeIsValid(date: Date, now = Date.now()): boolean {
  const ms = date.getTime();
  return Number.isFinite(ms) && ms <= now + 60000 && ms >= now - 366 * 86400000;
}

type Point = { latitude: number; longitude: number };

/** The route on the map: from where it went missing, through the sightings, oldest first. */
export function sightingPath(data: Sightings): Point[] {
  const ordered = [...data.sightings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const points: Point[] = data.start ? [{ latitude: data.start.latitude, longitude: data.start.longitude }] : [];
  for (const s of ordered) points.push({ latitude: s.latitude, longitude: s.longitude });
  return points;
}

/** A map region that shows every point with some room around it. */
export function sightingRegion(points: Point[]): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.6),
  };
}

/** The first part of a place label ("Sognsvannsveien 20, 0863 Oslo" -> "Sognsvannsveien 20"). */
export function shortPlace(label: string | null | undefined): string {
  const first = String(label || "").split(",")[0]?.trim() || "";
  return first.slice(0, 60);
}
