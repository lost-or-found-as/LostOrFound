// T1.9BH: draws a case's search areas (place, route, area) on a map, the same way as the map
// picker, and works out a region that shows all of them. Used by the form preview and the case
// screen, which before only drew one circle at the first point.
import React from "react";
import { Circle, Marker, Polygon, Polyline } from "react-native-maps";

export type AreaShape = {
  id?: string;
  kind: "CIRCLE" | "ROUTE" | "POLYGON" | string;
  radiusMeters?: number | null;
  points: Array<{ latitude: number; longitude: number }>;
};

const COLORS = ["#2563EB", "#16A34A", "#7C3AED"];
const METERS_PER_DEGREE = 111000;

/** Only shapes with enough valid points. */
export function usableAreas(value: unknown): AreaShape[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((a: any) => ({
      id: a?.id ? String(a.id) : undefined,
      kind: String(a?.kind || "").toUpperCase(),
      radiusMeters: a?.radiusMeters == null ? null : Number(a.radiusMeters),
      points: (Array.isArray(a?.points) ? a.points : [])
        .map((p: any) => ({ latitude: Number(p?.latitude), longitude: Number(p?.longitude) }))
        .filter((p: { latitude: number; longitude: number }) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
    }))
    .filter((a) => (a.kind === "CIRCLE" && a.points.length >= 1) || (a.kind === "ROUTE" && a.points.length >= 2) || (a.kind === "POLYGON" && a.points.length >= 3))
    .slice(0, 3);
}

/** A region that holds every shape, with its radius or route width as margin. */
export function areasRegion(areas: AreaShape[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const a of areas) {
    const pad = a.kind === "POLYGON" ? 0 : Number(a.radiusMeters || 500) / METERS_PER_DEGREE;
    for (const p of a.points) {
      const lngPad = pad / Math.max(0.2, Math.cos((p.latitude * Math.PI) / 180));
      minLat = Math.min(minLat, p.latitude - pad);
      maxLat = Math.max(maxLat, p.latitude + pad);
      minLng = Math.min(minLng, p.longitude - lngPad);
      maxLng = Math.max(maxLng, p.longitude + lngPad);
    }
  }
  if (!Number.isFinite(minLat)) return null;
  const latitudeDelta = Math.min(1.5, Math.max(0.006, (maxLat - minLat) * 1.35));
  const longitudeDelta = Math.min(1.5, Math.max(0.006, (maxLng - minLng) * 1.35));
  return { latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2, latitudeDelta, longitudeDelta };
}

export function SearchAreaShapes({ areas }: { areas: AreaShape[] }) {
  return (
    <>
      {areas.map((a, index) => {
        const color = COLORS[index] ?? COLORS[0];
        const key = a.id || `area-${index}`;
        if (a.kind === "CIRCLE")
          return (
            <React.Fragment key={key}>
              <Marker coordinate={a.points[0]} pinColor={color} />
              <Circle center={a.points[0]} radius={Number(a.radiusMeters || 500)} strokeColor={color} strokeWidth={2} fillColor={`${color}22`} />
            </React.Fragment>
          );
        if (a.kind === "ROUTE") return <Polyline key={key} coordinates={a.points} strokeColor={color} strokeWidth={6} />;
        return <Polygon key={key} coordinates={a.points} strokeColor={color} strokeWidth={2} fillColor={`${color}22`} />;
      })}
    </>
  );
}
