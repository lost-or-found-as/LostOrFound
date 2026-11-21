// T1.9BG: hands the places of an area alert between the order screen and the map picker.
// The map picker is the same screen as in the registration; with purpose "alert" it reads and
// writes here instead of the report draft, so the case itself is never changed.
import type { SearchArea } from "../contexts/ReportDraftContext";

export const MAX_ALERT_PLACES = 3;

let places: SearchArea[] | null = null;
let version = 0;

export function setAlertPlaces(next: SearchArea[]) {
  places = next.slice(0, MAX_ALERT_PLACES).map((p) => ({ ...p, points: p.points.map((x) => ({ ...x })) }));
  version += 1;
}

export function getAlertPlaces(): SearchArea[] | null {
  return places;
}

export function alertPlacesVersion(): number {
  return version;
}

/** The places as the server wants them (no ids or labels). */
export function alertPlacesPayload(list: SearchArea[]) {
  return list.slice(0, MAX_ALERT_PLACES).map((p) => ({
    kind: p.kind,
    radiusMeters: p.kind === "POLYGON" ? null : Number(p.radiusMeters || 500),
    points: p.points.map((x) => ({ latitude: x.latitude, longitude: x.longitude })),
  }));
}

/** The case's own search areas as starting places, or one circle at the case location. */
export function startPlaces(searchAreas: unknown, latitude: number, longitude: number): SearchArea[] {
  const list = Array.isArray(searchAreas) ? searchAreas : [];
  const valid = list
    .map((a: any, i: number): SearchArea | null => {
      const kind = String(a?.kind || "").toUpperCase();
      if (!["CIRCLE", "ROUTE", "POLYGON"].includes(kind)) return null;
      const points = (Array.isArray(a?.points) ? a.points : [])
        .map((p: any) => ({ latitude: Number(p?.latitude), longitude: Number(p?.longitude) }))
        .filter((p: { latitude: number; longitude: number }) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
      const min = kind === "CIRCLE" ? 1 : kind === "ROUTE" ? 2 : 3;
      if (points.length < min) return null;
      return {
        id: String(a?.id || `place_${i + 1}`),
        kind: kind as SearchArea["kind"],
        radiusMeters: kind === "POLYGON" ? undefined : Number(a?.radiusMeters) || 500,
        points: kind === "CIRCLE" ? points.slice(0, 1) : points,
      };
    })
    .filter((a): a is SearchArea => !!a)
    .slice(0, MAX_ALERT_PLACES);
  if (valid.length) return valid;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  return [{ id: "place_1", kind: "CIRCLE", radiusMeters: 1500, points: [{ latitude, longitude }] }];
}
