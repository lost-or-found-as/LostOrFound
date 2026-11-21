"use strict";
// T1.9BG: the places an area alert covers. The owner draws them on the same map as when the
// case was registered: a place (circle), a route (a line with a width on each side) or an area
// (a drawn shape), at most three. The database joins them into one shape; overlaps count once.

const MAX_PLACES = 3;
const MAX_POINTS = 100;
const CIRCLE_RADIUS_M = Object.freeze({ min: 100, max: 10000 });
const ROUTE_WIDTH_M = Object.freeze({ min: 50, max: 2000 });
// Roughly a 11 km radius. Larger alerts are not offered.
const MAX_TOTAL_AREA_SQ_KM = 400;

function placesError(code) {
  return Object.assign(new Error(code), { code });
}

function point(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    throw placesError("INVALID_PLACE_POINT");
  return { latitude, longitude };
}

function clampWhole(value, { min, max }) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Checks and cleans the places from the app. Throws an error with a stable code. */
function normalizeAlertPlaces(value) {
  if (!Array.isArray(value) || value.length === 0) throw placesError("PLACES_REQUIRED");
  if (value.length > MAX_PLACES) throw placesError("TOO_MANY_PLACES");
  return value.map((place) => {
    const kind = String(place?.kind || "").toUpperCase();
    if (!["CIRCLE", "ROUTE", "POLYGON"].includes(kind)) throw placesError("INVALID_PLACE_KIND");
    const raw = Array.isArray(place?.points) ? place.points : [];
    if (raw.length > MAX_POINTS) throw placesError("TOO_MANY_PLACE_POINTS");
    const points = raw.map(point);
    if (kind === "CIRCLE") {
      if (points.length !== 1) throw placesError("CIRCLE_REQUIRES_ONE_POINT");
      const radiusMeters = clampWhole(place?.radiusMeters, CIRCLE_RADIUS_M);
      if (radiusMeters === null) throw placesError("INVALID_PLACE_RADIUS");
      return { kind, radiusMeters, points };
    }
    if (kind === "ROUTE") {
      if (points.length < 2) throw placesError("ROUTE_REQUIRES_TWO_POINTS");
      const radiusMeters = clampWhole(place?.radiusMeters, ROUTE_WIDTH_M);
      if (radiusMeters === null) throw placesError("INVALID_PLACE_RADIUS");
      return { kind, radiusMeters, points };
    }
    if (points.length < 3) throw placesError("POLYGON_REQUIRES_THREE_POINTS");
    return { kind, radiusMeters: null, points };
  });
}

/** First point of the first place: where maps start and where the alert is "about". */
function placesCenter(places) {
  const p = places?.[0]?.points?.[0];
  return p ? { latitude: p.latitude, longitude: p.longitude } : null;
}

module.exports = { MAX_PLACES, MAX_TOTAL_AREA_SQ_KM, CIRCLE_RADIUS_M, ROUTE_WIDTH_M, normalizeAlertPlaces, placesCenter };
