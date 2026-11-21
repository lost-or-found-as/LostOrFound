"use strict";
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { calculateGeoAlertQuote } = require("../lib/geoAlertPricing");
const { calculateVisibilityQuote } = require("../lib/areaVisibility");
const { normalizeAlertPlaces, placesCenter, MAX_TOTAL_AREA_SQ_KM } = require("../lib/alertPlaces");

const VALID_RADII = new Set([250, 500, 1000, 1500, 3000, 5000, 10000, 25000, 50000]);
const VALID_DURATIONS = new Set([24, 72, 168]);

/**
 * T1.9BG: area and audience for up to three places (place, route, area). Answers the same shape
 * as the radius preview, with radiusM null and the cleaned places.
 */
async function previewPlaces(req, res) {
  const reportId = String(req.body?.reportId || "").trim();
  if (!reportId) return res.status(400).json({ error: "REPORT_ID_REQUIRED" });
  let places;
  try {
    places = normalizeAlertPlaces(req.body?.places);
  } catch (e) {
    return res.status(400).json({ error: e?.code || "INVALID_PLACES" });
  }
  const { data, error } = await supaAdmin.rpc("preview_geo_alert_places", {
    p_report_id: reportId,
    p_user_id: req.user.id,
    p_places: places,
  });
  if (error) throw error;
  const preview = Array.isArray(data) ? data[0] : data;
  if (!preview) return res.status(404).json({ error: "LOST_REPORT_WITH_LOCATION_NOT_FOUND" });
  const areaSqKm = Number(preview.area_sq_km || 0);
  if (areaSqKm > MAX_TOTAL_AREA_SQ_KM) return res.status(400).json({ error: "ALERT_AREA_TOO_LARGE" });
  const quote = calculateGeoAlertQuote({
    places,
    areaSqKm,
    estimatedEligibleInstallations: Number(preview.eligible_installations || 0),
  });
  const center = placesCenter(places);
  return res.json({
    ok: true,
    preview: {
      reportId,
      latitude: center?.latitude ?? null,
      longitude: center?.longitude ?? null,
      radiusM: null,
      areaSqKm,
      places,
      categoryKey: preview.category_key,
      durationHours: 168,
      reminderCount: 0,
      populationDensityBand: "LOW",
    },
    quote,
    note: "TEST_PRICE_NOT_FOR_STORE_RELEASE",
  });
}

router.post("/", requireUser, async (req, res) => {
  try {
    const kindRequested = String(req.body?.kind || "ALERT").toUpperCase();
    if (kindRequested !== "VISIBILITY" && Array.isArray(req.body?.places)) return await previewPlaces(req, res);
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

    // T1.9AM: kind VISIBILITY prices by the people who follow the area (no push); the price
    // comes from the product catalog.
    const kind = String(req.body?.kind || "ALERT").toUpperCase();
    let quote;
    if (kind === "VISIBILITY") {
      const visibility = calculateVisibilityQuote({ followers: Number(preview.eligible_users || 0), radiusM });
      const { data: product, error: productError } = await supaAdmin
        .from("product_catalog")
        .select("base_price_ore,currency")
        .eq("code", visibility.productCode)
        .eq("active", true)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return res.status(409).json({ error: "PRODUCT_NOT_AVAILABLE" });
      quote = {
        ...visibility,
        amountOre: visibility.pilotFree ? 0 : Number(product.base_price_ore),
        listPriceOre: Number(product.base_price_ore),
        currency: product.currency,
      };
    } else {
      quote = calculateGeoAlertQuote({
        radiusM,
        areaSqKm: Number(preview.area_sq_km),
        estimatedEligibleInstallations: Number(preview.eligible_installations || 0),
      });
    }

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
