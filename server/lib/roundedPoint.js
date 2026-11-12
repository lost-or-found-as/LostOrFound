"use strict";
// T1.9AC: two decimals is about 1 km: enough to open a map in the right area, not the exact spot.
function roundedPoint(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
}

module.exports = { roundedPoint };
