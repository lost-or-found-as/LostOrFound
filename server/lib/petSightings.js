"use strict";
// T1.9AL: "Sist sett" for a lost case – where the owner's report started and where people have
// seen it since, newest first. Pure (no database access) so it can be tested directly.
const HIDDEN_STATUSES = new Set(["DISMISSED", "REJECTED"]);
const SIGHTING_LIMIT = 20;

const finite = (v) => v != null && v !== "" && Number.isFinite(Number(v));
const validPoint = (lat, lng) => finite(lat) && finite(lng) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
const clean = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Observations the owner has not dismissed, newest first. */
function visibleObservations(observations) {
  return (observations || []).filter((o) => !HIDDEN_STATUSES.has(String(o?.status || "").toUpperCase()));
}

/**
 * { start, sightings }: start is where the case began (null without a point); each sighting has
 * id, kind (SEEN | FOUND), at, comment, direction, latitude, longitude and isNew.
 * points: [{ id, latitude, longitude }] for the observations.
 */
function buildSightings({ report, observations, points }) {
  const pointById = new Map((points || []).map((p) => [String(p.id), p]));
  const sightings = visibleObservations(observations)
    .map((o) => {
      const p = pointById.get(String(o.id));
      return {
        id: String(o.id),
        kind: String(o.observation_type || "SEEN").toUpperCase() === "FOUND" ? "FOUND" : "SEEN",
        at: o.observed_at || o.created_at || null,
        comment: clean(o.comment, 300),
        direction: clean(o.movement_direction, 120),
        latitude: p ? Number(p.latitude) : null,
        longitude: p ? Number(p.longitude) : null,
        isNew: String(o.status || "").toUpperCase() === "NEW",
      };
    })
    .filter((s) => Number.isFinite(Date.parse(s.at || "")) && validPoint(s.latitude, s.longitude))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, SIGHTING_LIMIT);
  const start =
    report && validPoint(report.lat, report.lng)
      ? {
          at: Number.isFinite(Date.parse(report.occurred_at || "")) ? report.occurred_at : null,
          latitude: Number(report.lat),
          longitude: Number(report.lng),
          label: clean(report.location_label, 120),
        }
      : null;
  return { start, sightings };
}

module.exports = { buildSightings, visibleObservations, HIDDEN_STATUSES, SIGHTING_LIMIT };
