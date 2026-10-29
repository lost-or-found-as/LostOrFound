"use strict";
const { Router } = require("express");
const { requireUserOrGuest } = require("../mw/auth");
const router = Router();
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${ms}ms)`)), ms))]);
}
function apiKey(res) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
  return key;
}
router.get("/reverse", requireUserOrGuest, async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    const language = String(req.query.language || "no");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "Invalid lat/lng" });
    const key = apiKey(res); if (!key) return;
    const url = "https://maps.googleapis.com/maps/api/geocode/json" +
      `?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${encodeURIComponent(key)}&language=${encodeURIComponent(language)}`;
    const r = await withTimeout(fetch(url), 12000);
    const json = await r.json().catch(() => null);
    const results = json?.results;
    const street = Array.isArray(results) ? results.find((x) => Array.isArray(x?.types) && x.types.includes("street_address")) : null;
    return res.json({ label: street?.formatted_address || results?.[0]?.formatted_address || null, status: json?.status ?? null, error_message: json?.error_message ?? null });
  } catch (e) { return res.status(500).json({ error: e?.message || "Server error" }); }
});
router.get("/search", requireUserOrGuest, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const language = String(req.query.language || "no");
    if (q.length < 3) return res.status(400).json({ error: "QUERY_TOO_SHORT" });
    const key = apiKey(res); if (!key) return;
    const url = "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}&language=${encodeURIComponent(language)}&region=no`;
    const r = await withTimeout(fetch(url), 12000);
    const json = await r.json().catch(() => null);
    const results = Array.isArray(json?.results) ? json.results.slice(0, 6).map((x) => ({
      id: x.place_id,
      label: x.formatted_address,
      latitude: x.geometry?.location?.lat,
      longitude: x.geometry?.location?.lng,
    })).filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude)) : [];
    return res.json({ results, status: json?.status ?? null, error_message: json?.error_message ?? null });
  } catch (e) { return res.status(500).json({ error: e?.message || "Server error" }); }
});
module.exports = router;
