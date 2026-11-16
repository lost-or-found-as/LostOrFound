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
 * id, kind (SEEN | FOUND | TIP), source (AREA_ALERT | OWNER), at, comment, direction, latitude,
 * longitude and isNew. points: [{ id, latitude, longitude }] for the observations.
 * ownerTips (T1.9AN): rows of report_owner_sightings – tips the owner put on the map.
 */
function buildSightings({ report, observations, points, ownerTips = [] }) {
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
        source: "AREA_ALERT",
      };
    })
    .concat(
      (ownerTips || []).map((t) => ({
        id: String(t.id),
        kind: "TIP",
        at: t.seen_at || null,
        comment: clean(t.note, 300),
        direction: null,
        latitude: Number(t.latitude),
        longitude: Number(t.longitude),
        isNew: false,
        source: "OWNER",
      })),
    )
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

// T1.9AN: an owner tip. Returns { value } or { error }.
const OWNER_TIP_LIMIT = 50;
function cleanOwnerTip(body, now = Date.now()) {
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (!validPoint(latitude, longitude)) return { error: "INVALID_LOCATION" };
  const seenAt = Date.parse(body?.seenAt || "");
  // Not in the future (a few minutes' clock drift allowed), not older than a year.
  if (!Number.isFinite(seenAt) || seenAt > now + 5 * 60000 || seenAt < now - 366 * 86400000) return { error: "INVALID_SEEN_AT" };
  return { value: { latitude, longitude, seen_at: new Date(seenAt).toISOString(), note: clean(body?.note, 300) } };
}

module.exports = { buildSightings, visibleObservations, cleanOwnerTip, HIDDEN_STATUSES, SIGHTING_LIMIT, OWNER_TIP_LIMIT };
