"use strict";
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { calculateGeoAlertQuote } = require("../lib/geoAlertPricing");

const VALID_RADII = new Set([250, 500, 1000, 1500, 3000, 5000, 10000, 25000, 50000]);
const VALID_DURATIONS = new Set([24, 72, 168]);

router.post("/", requireUser, async (req, res) => {
  try {
    const reportId = String(req.body?.reportId || "").trim();
    const radiusM = Number(req.body?.radiusM);
    const durationHours = Number(req.body?.durationHours || 72);
    const reminderCount = Number(req.body?.reminderCount || 0);
    const populationDensityBand = String(req.body?.populationDensityBand || "LOW").toUpperCase();
    if (!reportId) return res.status(400).json({ error: "REPORT_ID_REQUIRED" });
    if (!VALID_RADII.has(radiusM)) return res.status(400).json({ error: "INVALID_RADIUS" });
    if (!VALID_DURATIONS.has(durationHours)) return res.status(400).json({ error: "INVALID_DURATION" });
    if (!Number.isInteger(reminderCount) || reminderCount < 0 || reminderCount > 2) return res.status(400).json({ error: "INVALID_REMINDER_COUNT" });

    const { data, error } = await supaAdmin.rpc("preview_geo_alert_audience", {
      p_report_id: reportId,
      p_user_id: req.user.id,
      p_radius_m: radiusM,
    });
    if (error) throw error;
    const preview = Array.isArray(data) ? data[0] : data;
    if (!preview) return res.status(404).json({ error: "LOST_REPORT_WITH_LOCATION_NOT_FOUND" });

    const quote = calculateGeoAlertQuote({
      radiusM,
      areaSqKm: Number(preview.area_sq_km),
      estimatedEligibleInstallations: Number(preview.eligible_installations || 0),
    });

    return res.json({
      ok: true,
      preview: {
        reportId,
        latitude: preview.latitude,
        longitude: preview.longitude,
        radiusM,
        areaSqKm: Number(preview.area_sq_km),
        categoryKey: preview.category_key,
        durationHours,
        reminderCount,
        populationDensityBand,
      },
      quote,
      note: "TEST_PRICE_NOT_FOR_STORE_RELEASE",
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "GEO_ALERT_PREVIEW_FAILED" });
  }
});

module.exports = router;
