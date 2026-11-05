"use strict";

const { randomUUID } = require("crypto");

const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");

const RADII = new Set([250, 500, 1000, 3000, 5000, 10000]);
const CURRENT_LOCATION_RADII = new Set([1000, 3000, 5000, 10000]);
const CURRENT_LOCATION_EXPIRIES = new Set([0, 24, 72, 168]);

const cleanCategories = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((item) =>
              String(item || "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean),
        ),
      ].slice(0, 30)
    : [];

const validCoordinate = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  Number.isFinite(longitude) &&
  longitude >= -180 &&
  longitude <= 180;

const cleanBoundaryPoints = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 100)
    .map((point) => ({
      latitude: Number(point?.latitude),
      longitude: Number(point?.longitude),
    }))
    .filter((point) => validCoordinate(point.latitude, point.longitude));
};

router.get("/", requireUser, async (req, res) => {
  try {
    const { data, error } = await supaAdmin.rpc("get_user_watch_areas", {
      p_user_id: req.user.id,
    });

    if (error) throw error;
    return res.json({ areas: data || [] });
  } catch (error) {
    console.error("[alert-areas] load failed", error?.message || error);
    return res.status(500).json({ error: "WATCH_AREAS_LOAD_FAILED" });
  }
});

router.put("/current-location", requireUser, async (req, res) => {
  try {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const radiusM = Number(req.body?.radiusM);
    const expiryHours = Number(req.body?.expiryHours ?? 0);
    // T1.9AA: a location refresh from the app keeps the end time the user chose.
    const keepExpiry = req.body?.keepExpiry === true;
    if (!validCoordinate(latitude, longitude))
      return res.status(400).json({ error: "INVALID_COORDINATES" });
    if (!CURRENT_LOCATION_RADII.has(radiusM))
      return res.status(400).json({ error: "INVALID_RADIUS" });
    if (!CURRENT_LOCATION_EXPIRIES.has(expiryHours))
      return res.status(400).json({ error: "INVALID_EXPIRY" });
    const now = new Date().toISOString();
    const values = {
      name: "Current location",
      area_type: "CIRCLE",
      center: `POINT(${longitude} ${latitude})`,
      radius_m: radiusM,
      boundary: null,
      category_keys: cleanCategories(req.body?.categoryKeys),
      all_categories: req.body?.allCategories !== false,
      push_enabled: req.body?.pushEnabled !== false,
      active: true,
      source_type: "CURRENT_LOCATION",
      expires_at:
        expiryHours === 0
          ? null
          : new Date(Date.now() + expiryHours * 3600000).toISOString(),
      location_updated_at: now,
      updated_at: now,
    };
    const existing = await supaAdmin
      .from("notification_watch_areas")
      .select("id,expires_at")
      .eq("user_id", req.user.id)
      .eq("source_type", "CURRENT_LOCATION")
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (keepExpiry && existing.data?.id) {
      const endsAt = existing.data.expires_at ? Date.parse(existing.data.expires_at) : null;
      // An area that has run out is not brought back by opening the app.
      if (endsAt != null && endsAt <= Date.now()) return res.json({ area: null, expired: true });
      delete values.expires_at;
    }
    const result = existing.data?.id
      ? await supaAdmin
          .from("notification_watch_areas")
          .update(values)
          .eq("id", existing.data.id)
          .eq("user_id", req.user.id)
          .select(
            "id,name,area_type,radius_m,category_keys,all_categories,push_enabled,active,source_type,expires_at,location_updated_at",
          )
          .single()
      : await supaAdmin
          .from("notification_watch_areas")
          .insert({ id: randomUUID(), ...values, user_id: req.user.id })
          .select(
            "id,name,area_type,radius_m,category_keys,all_categories,push_enabled,active,source_type,expires_at,location_updated_at",
          )
          .single();
    if (result.error) throw result.error;
    return res.json({ area: result.data });
  } catch (error) {
    console.error("[alert-areas] current location storage failed", {
      message: String(error?.message || error || ""),
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    });
    return res.status(500).json({ error: "CURRENT_LOCATION_STORAGE_FAILED" });
  }
});
router.delete("/current-location", requireUser, async (req, res) => {
  try {
    const { error } = await supaAdmin
      .from("notification_watch_areas")
      .delete()
      .eq("user_id", req.user.id)
      .eq("source_type", "CURRENT_LOCATION");
    if (error) throw error;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "CURRENT_LOCATION_DISABLE_FAILED" });
  }
});
router.post("/", requireUser, async (req, res) => {
  try {
    const countResult = await supaAdmin
      .from("notification_watch_areas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .neq("source_type", "CURRENT_LOCATION");

    if (countResult.error) throw countResult.error;

    if ((countResult.count || 0) >= 3) {
      return res.status(409).json({ error: "WATCH_AREA_LIMIT_REACHED" });
    }

    const name = String(req.body?.name || "")
      .trim()
      .slice(0, 80);
    if (!name) return res.status(400).json({ error: "NAME_REQUIRED" });

    const areaType = String(req.body?.areaType || "CIRCLE").toUpperCase();
    if (!["CIRCLE", "POLYGON"].includes(areaType)) {
      return res.status(400).json({ error: "INVALID_AREA_TYPE" });
    }

    const categoryKeys = cleanCategories(req.body?.categoryKeys);
    const allCategories = req.body?.allCategories !== false;

    let latitude = null;
    let longitude = null;
    let radiusM = null;
    let boundaryPoints = [];

    if (areaType === "CIRCLE") {
      latitude = Number(req.body?.latitude);
      longitude = Number(req.body?.longitude);
      radiusM = Number(req.body?.radiusM);

      if (!validCoordinate(latitude, longitude)) {
        return res.status(400).json({ error: "INVALID_COORDINATES" });
      }

      if (!RADII.has(radiusM)) {
        return res.status(400).json({ error: "INVALID_RADIUS" });
      }
    } else {
      boundaryPoints = cleanBoundaryPoints(req.body?.boundaryPoints);

      if (boundaryPoints.length < 3) {
        return res.status(400).json({ error: "INVALID_BOUNDARY" });
      }
    }

    const { data, error } = await supaAdmin.rpc("create_user_watch_area_v2", {
      p_user_id: req.user.id,
      p_name: name,
      p_area_type: areaType,
      p_lat: latitude,
      p_lng: longitude,
      p_radius_m: radiusM,
      p_boundary_points: boundaryPoints,
      p_category_keys: categoryKeys,
      p_all_categories: allCategories,
      p_push_enabled: req.body?.pushEnabled !== false,
    });

    if (error) throw error;

    return res.status(201).json({
      area: Array.isArray(data) ? data[0] : data,
    });
  } catch (error) {
    const message = String(error?.message || "");
    console.error("[alert-areas] create failed", message);

    if (message.includes("WATCH_AREA_LIMIT_REACHED")) {
      return res.status(409).json({ error: "WATCH_AREA_LIMIT_REACHED" });
    }

    if (message.includes("INVALID_BOUNDARY_COORDINATES")) {
      return res.status(400).json({ error: "INVALID_BOUNDARY_COORDINATES" });
    }

    if (message.includes("INVALID_BOUNDARY")) {
      return res.status(400).json({ error: "INVALID_BOUNDARY" });
    }

    return res.status(500).json({ error: "WATCH_AREA_CREATE_FAILED" });
  }
});

router.patch("/:id", requireUser, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const hasGeometry = req.body?.areaType != null;

    if (hasGeometry) {
      const name = String(req.body?.name || "")
        .trim()
        .slice(0, 80);
      const areaType = String(req.body?.areaType || "CIRCLE").toUpperCase();
      const categoryKeys = cleanCategories(req.body?.categoryKeys);
      const allCategories = req.body?.allCategories !== false;
      let latitude = null;
      let longitude = null;
      let radiusM = null;
      let boundaryPoints = [];

      if (!name) return res.status(400).json({ error: "NAME_REQUIRED" });
      if (!["CIRCLE", "POLYGON"].includes(areaType))
        return res.status(400).json({ error: "INVALID_AREA_TYPE" });

      if (areaType === "CIRCLE") {
        latitude = Number(req.body?.latitude);
        longitude = Number(req.body?.longitude);
        radiusM = Number(req.body?.radiusM);
        if (!validCoordinate(latitude, longitude))
          return res.status(400).json({ error: "INVALID_COORDINATES" });
        if (!RADII.has(radiusM))
          return res.status(400).json({ error: "INVALID_RADIUS" });
      } else {
        boundaryPoints = cleanBoundaryPoints(req.body?.boundaryPoints);
        if (boundaryPoints.length < 3)
          return res.status(400).json({ error: "INVALID_BOUNDARY" });
      }

      const { data, error } = await supaAdmin.rpc("update_user_watch_area_v2", {
        p_user_id: req.user.id,
        p_area_id: id,
        p_name: name,
        p_area_type: areaType,
        p_lat: latitude,
        p_lng: longitude,
        p_radius_m: radiusM,
        p_boundary_points: boundaryPoints,
        p_category_keys: categoryKeys,
        p_all_categories: allCategories,
        p_push_enabled: req.body?.pushEnabled !== false,
      });
      if (error) throw error;
      const area = Array.isArray(data) ? data[0] : data;
      if (!area) return res.status(404).json({ error: "NOT_FOUND" });
      return res.json({ area });
    }

    const statusPatch = {};
    if (req.body?.active != null) statusPatch.active = Boolean(req.body.active);
    if (req.body?.pushEnabled != null)
      statusPatch.push_enabled = Boolean(req.body.pushEnabled);
    statusPatch.updated_at = new Date().toISOString();

    const { data, error } = await supaAdmin
      .from("notification_watch_areas")
      .update(statusPatch)
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select(
        "id,name,area_type,radius_m,category_keys,all_categories,push_enabled,active,created_at,updated_at",
      )
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ area: data });
  } catch (error) {
    const message = String(error?.message || "");
    console.error("[alert-areas] update failed", message);
    if (message.includes("INVALID_BOUNDARY"))
      return res.status(400).json({ error: "INVALID_BOUNDARY" });
    return res.status(500).json({ error: "WATCH_AREA_UPDATE_FAILED" });
  }
});

router.delete("/:id", requireUser, async (req, res) => {
  try {
    const { data, error } = await supaAdmin
      .from("notification_watch_areas")
      .delete()
      .eq("id", String(req.params.id || ""))
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "NOT_FOUND" });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[alert-areas] delete failed", error?.message || error);
    return res.status(500).json({ error: "WATCH_AREA_DELETE_FAILED" });
  }
});

module.exports = router;
