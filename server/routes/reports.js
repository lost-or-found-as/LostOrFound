// server/routes/reports.js
"use strict";

const express = require("express");
const router = express.Router();

const supaModule = require("../supabaseClient");
const supaAdmin =
  supaModule?.supaAdmin ||
  supaModule?.supabaseAdmin ||
  supaModule?.admin ||
  supaModule?.client ||
  supaModule;

const authModule = require("../mw/auth");
const requireUser = authModule?.requireUser || authModule;
const requireUserOrGuest = authModule.requireUserOrGuest;
const { normalizeSecondaryColor } = require("../lib/colorKeys");
const { normalizeCustody, normalizeOccurredPrecision } = require("../lib/reportCustody");

if (!supaAdmin || typeof supaAdmin.from !== "function") {
  throw new Error(
    "Supabase admin client is not initialized correctly: supaAdmin.from is not a function.",
  );
}

const MATCH_REFRESH_CONFIG = {
  candidateLimit: Number.parseInt(
    process.env.MATCH_CANDIDATE_LIMIT || "50",
    10,
  ),
  maxDistanceM: Number.parseInt(process.env.MATCH_MAX_DISTANCE_M || "3000", 10),
  maxAgeDays: Number.parseInt(process.env.MATCH_MAX_AGE_DAYS || "30", 10),
  minScore: Number.parseInt(process.env.MATCH_MIN_SCORE || "65", 10),
  timeBufferHours: Number.parseInt(
    process.env.MATCH_TIME_BUFFER_HOURS || "48",
    10,
  ),
};

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function matchRefreshParams(reportId) {
  return {
    p_report_id: reportId,
    p_candidate_limit: safeInt(MATCH_REFRESH_CONFIG.candidateLimit, 50, 1, 500),
    p_max_distance_m: safeInt(
      MATCH_REFRESH_CONFIG.maxDistanceM,
      3000,
      50,
      100000,
    ),
    p_max_age_days: safeInt(MATCH_REFRESH_CONFIG.maxAgeDays, 30, 1, 3650),
    p_min_score: safeInt(MATCH_REFRESH_CONFIG.minScore, 65, 0, 100),
    p_time_buffer_hours: safeInt(
      MATCH_REFRESH_CONFIG.timeBufferHours,
      48,
      0,
      24 * 30,
    ),
  };
}

function toFiniteNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntegerOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function reportVisibilityDays(type) {
  return String(type).toUpperCase() === "FOUND" ? 30 : 7;
}

function visibleUntilForType(type) {
  const days = reportVisibilityDays(type);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function configuredTestUserIds() {
  return new Set(
    String(process.env.LOST_REPORT_TEST_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}
function isLostReportTestUser(userId) {
  return !!userId && configuredTestUserIds().has(String(userId));
}

function isAnonymousUser(user) {
  if (!user) return false;
  return (
    user.is_anonymous === true ||
    user.isAnonymous === true ||
    user.app_metadata?.provider === "anonymous" ||
    user.user_metadata?.is_anonymous === true
  );
}

async function syncLifecycleForUser(userId) {
  const nowIso = new Date().toISOString();
  const foundArchiveCutoff = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const results = [];
  const updates = [
    supaAdmin
      .from("reports")
      .update({ status: "EXPIRED" })
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .lt("visible_until", nowIso),
    supaAdmin
      .from("reports")
      .update({ status: "ARCHIVED", archived_at: nowIso })
      .eq("user_id", userId)
      .eq("type", "FOUND")
      .in("status", ["ACTIVE", "EXPIRED"])
      .lt("created_at", foundArchiveCutoff),
  ];

  for (const promise of updates) {
    try {
      const { error } = await promise;
      if (error) results.push(error.message);
    } catch (e) {
      results.push(String(e?.message ?? e));
    }
  }
  return results;
}

async function countRecentLostCreations(userId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supaAdmin
    .from("report_creation_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("report_type", "LOST")
    .gte("created_at", since);
  if (error) throw error;
  return Number(count ?? 0);
}

async function recordReportCreation(report, userId) {
  const { error } = await supaAdmin.from("report_creation_events").insert({
    report_id: report.id,
    user_id: userId,
    report_type: report.type,
  });
  if (error) throw error;
}

function isReportActiveForMatching(report) {
  if (!report) return false;
  if (report.status && report.status !== "ACTIVE") return false;
  if (report.closed_at || report.archived_at) return false;
  if (report.visible_until && Date.parse(report.visible_until) <= Date.now())
    return false;
  return true;
}

function isMatchActiveForMatching(match) {
  return (
    isReportActiveForMatching(match?.lost) &&
    isReportActiveForMatching(match?.found) &&
    match?.lost?.user_id !== match?.found?.user_id
  );
}

const MATCH_WITH_STATUS_SELECT =
  "id, score, status, reasons, lost_id, found_id, lost:lost_id(id,user_id,status,visible_until,closed_at,archived_at), found:found_id(id,user_id,status,visible_until,closed_at,archived_at)";

async function safeDelete(queryBuilder, label, results) {
  try {
    const { error } = await queryBuilder;
    if (error) results.push({ step: label, ok: false, error: error.message });
    else results.push({ step: label, ok: true });
  } catch (e) {
    results.push({ step: label, ok: false, error: String(e?.message ?? e) });
  }
}

async function cleanupMatchesForReport(reportId) {
  const results = [];
  const { data: matches, error: mErr } = await supaAdmin
    .from("matches")
    .select("id")
    .or(`lost_id.eq.${reportId},found_id.eq.${reportId}`);

  if (mErr) throw mErr;

  const matchIds = (matches || []).map((m) => m.id).filter(Boolean);
  if (matchIds.length > 0) {
    await safeDelete(
      supaAdmin.from("notifications").delete().in("entity_id", matchIds),
      "notifications:matches_or_chat",
      results,
    );
    await safeDelete(
      supaAdmin.from("payments").delete().in("match_id", matchIds),
      "payments",
      results,
    );
    await safeDelete(
      supaAdmin.from("messages").delete().in("conversation_id", matchIds),
      "messages",
      results,
    );
    await safeDelete(
      supaAdmin.from("conversations").delete().in("id", matchIds),
      "conversations",
      results,
    );
    await safeDelete(
      supaAdmin.from("matches").delete().in("id", matchIds),
      "matches",
      results,
    );
  }
  return { matchIds, results };
}

function normalizeSearchAreas(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 3) throw new Error("TOO_MANY_SEARCH_AREAS");
  return value.map((area, index) => {
    const kind = String(area?.kind || "CIRCLE").toUpperCase();
    if (!["CIRCLE", "ROUTE", "POLYGON"].includes(kind))
      throw new Error("INVALID_SEARCH_AREA_KIND");
    const points = Array.isArray(area?.points)
      ? area.points.slice(0, 100).map((point) => {
          const latitude = Number(point?.latitude);
          const longitude = Number(point?.longitude);
          if (
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90 ||
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180
          )
            throw new Error("INVALID_SEARCH_AREA_POINT");
          return { latitude, longitude };
        })
      : [];
    if (kind === "CIRCLE" && points.length !== 1)
      throw new Error("CIRCLE_REQUIRES_ONE_POINT");
    if (kind === "ROUTE" && points.length < 2)
      throw new Error("ROUTE_REQUIRES_TWO_POINTS");
    if (kind === "POLYGON" && points.length < 3)
      throw new Error("POLYGON_REQUIRES_THREE_POINTS");
    return {
      id: String(area?.id || `area_${index + 1}`).slice(0, 100),
      kind,
      radiusMeters:
        kind === "POLYGON"
          ? null
          : safeInt(area?.radiusMeters, 500, 10, 100000),
      points,
    };
  });
}

function normalizeReportPatch(body) {
  const input = body || {};
  const patch = {};

  if (typeof input.category === "string")
    patch.category = input.category.trim().toUpperCase();
  if ("subcategory_key" in input)
    patch.subcategory_key = input.subcategory_key
      ? String(input.subcategory_key).trim().toUpperCase()
      : null;
  if ("subcategory_custom" in input)
    patch.subcategory_custom = input.subcategory_custom || null;
  if (typeof input.title === "string") patch.title = input.title.trim();
  if ("description" in input) patch.description = input.description || null;
  if ("color" in input) patch.color = input.color || null;
  // T1.9F: validated colour key (throws INVALID_SECONDARY_COLOR).
  if ("secondary_color" in input) patch.secondary_color = normalizeSecondaryColor(input.secondary_color);
  if ("brand" in input) patch.brand = input.brand || null;
  if ("occurred_at" in input) patch.occurred_at = input.occurred_at;
  if ("lat" in input) patch.lat = toFiniteNumberOrNull(input.lat);
  if ("lng" in input) patch.lng = toFiniteNumberOrNull(input.lng);
  if ("reward_ore" in input)
    patch.reward_ore = Math.max(0, toIntegerOrNull(input.reward_ore) ?? 0);
  if ("location_label" in input)
    patch.location_label = input.location_label || null;
  if ("radius_m" in input) patch.radius_m = toIntegerOrNull(input.radius_m);
  if ("search_radius_m" in input)
    patch.search_radius_m = toIntegerOrNull(input.search_radius_m);
  if ("area_radius_m" in input)
    patch.area_radius_m = toIntegerOrNull(input.area_radius_m);
  if ("location_radius_m" in input)
    patch.location_radius_m = toIntegerOrNull(input.location_radius_m);
  if ("search_areas" in input)
    patch.search_areas = normalizeSearchAreas(input.search_areas);

  // Never allow these to be changed by client PATCH.
  delete patch.id;
  delete patch.user_id;
  delete patch.type;
  delete patch.created_at;
  delete patch.status;
  delete patch.visible_until;
  delete patch.closed_at;
  delete patch.archived_at;
  delete patch.last_extended_at;
  delete patch.extension_count;

  return patch;
}

function changed(a, b) {
  const av = a == null ? null : String(a);
  const bv = b == null ? null : String(b);
  return av !== bv;
}

function detectCriticalChanges(existing, patch) {
  const criticalFields = [
    "category",
    "subcategory_key",
    "subcategory_custom",
    "occurred_at",
    "lat",
    "lng",
    "radius_m",
    "search_radius_m",
    "area_radius_m",
    "location_radius_m",
    "search_areas",
  ];
  const changedFields = [];
  const criticalChangedFields = [];

  for (const [key, value] of Object.entries(patch)) {
    if (changed(existing[key], value)) changedFields.push(key);
    if (criticalFields.includes(key) && changed(existing[key], value))
      criticalChangedFields.push(key);
  }

  return {
    changedFields,
    criticalChangedFields,
    isCritical: criticalChangedFields.length > 0,
  };
}

function minutesSince(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60000;
}

function publicEditState(report) {
  return {
    critical_edit_count: Number(report?.critical_edit_count || 0),
    last_critical_edit_at: report?.last_critical_edit_at || null,
    edit_locked_until: report?.edit_locked_until || null,
  };
}

/**
 * POST /reports
 * Create a report and refresh matching.
 */
router.post("/", requireUserOrGuest, async (req, res) => {
  try {
    const user = req.user;
    const {
      type,
      category,
      subcategory_key,
      subcategory_custom = null,
      title,
      description = null,
      color = null,
      secondary_color = null,
      brand = null,
      occurred_at,
      lat = null,
      lng = null,
      reward_ore = 0,
      location_label = null,
      radius_m = null,
      search_radius_m = null,
      area_radius_m = null,
      location_radius_m = null,
      search_areas = [],
      test_override_weekly_limit = false,
      client_request_id = null,
      custody = null,
      custody_place = null,
      occurred_precision = null,
    } = req.body || {};

    if (!type || !category || !title || !occurred_at) {
      return res.status(400).json({
        error: "REQUIRED_REPORT_FIELDS_MISSING",
      });
    }

    const normalizedType = String(type).toUpperCase();
    if (normalizedType !== "LOST" && normalizedType !== "FOUND") {
      return res.status(400).json({ error: "Invalid report type" });
    }

    let normalizedSecondaryColor = null;
    try {
      normalizedSecondaryColor = normalizeSecondaryColor(secondary_color);
    } catch {
      return res.status(400).json({ error: "INVALID_SECONDARY_COLOR" });
    }

    // T1.9K: where a found item is now, and how precisely the date is known.
    let custodyFields;
    let precisionFields;
    try {
      custodyFields = normalizeCustody(normalizedType, custody, custody_place);
      precisionFields = normalizeOccurredPrecision(occurred_precision, occurred_at);
    } catch (fieldErr) {
      return res.status(400).json({ error: fieldErr?.code || "INVALID_INPUT" });
    }

    const normalizedClientRequestId =
      typeof client_request_id === "string" ? client_request_id.trim() : "";
    if (
      !normalizedClientRequestId ||
      normalizedClientRequestId.length < 12 ||
      normalizedClientRequestId.length > 100
    ) {
      return res.status(400).json({ error: "CLIENT_REQUEST_ID_REQUIRED" });
    }
    const { data: existingRequest, error: existingRequestError } =
      await supaAdmin
        .from("reports")
        .select("*")
        .eq("user_id", user.id)
        .eq("client_request_id", normalizedClientRequestId)
        .maybeSingle();
    if (existingRequestError)
      return res.status(400).json({ error: existingRequestError.message });
    if (existingRequest)
      return res.json({
        report: existingRequest,
        candidates: [],
        idempotent_replay: true,
      });
    if (normalizedType === "LOST" && isAnonymousUser(user)) {
      return res.status(403).json({
        error: "ACCOUNT_REQUIRED_FOR_LOST",
        message: "A regular account is required to create a lost report.",
      });
    }

    if (normalizedType === "LOST") {
      const recentLostCount = await countRecentLostCreations(user.id);
      const testUser = isLostReportTestUser(user.id);
      const overrideRequested = test_override_weekly_limit === true;

      if (recentLostCount >= 2 && !(testUser && overrideRequested)) {
        return res.status(429).json({
          error: "LOST_REPORT_WEEKLY_LIMIT",
          message: "You can create up to two lost reports within seven days.",
          limit: 2,
          window_days: 7,
          current_count: recentLostCount,
          test_override_allowed: testUser,
        });
      }

      if (overrideRequested && !testUser) {
        return res.status(403).json({
          error: "TEST_OVERRIDE_NOT_ALLOWED",
          message: "This account is not allowed to use the test override.",
        });
      }
    }

    const insertPayload = {
      user_id: user.id,
      client_request_id: normalizedClientRequestId,
      type: normalizedType,
      status: "ACTIVE",
      visible_until: visibleUntilForType(normalizedType),
      category,
      subcategory_key: subcategory_key || null,
      subcategory_custom: subcategory_custom || null,
      title,
      description,
      color,
      secondary_color: normalizedSecondaryColor,
      brand,
      occurred_at,
      lat: toFiniteNumberOrNull(lat),
      lng: toFiniteNumberOrNull(lng),
      reward_ore: Math.max(0, toIntegerOrNull(reward_ore) ?? 0),
      location_label: location_label || null,
      radius_m: toIntegerOrNull(radius_m),
      search_radius_m: toIntegerOrNull(search_radius_m),
      area_radius_m: toIntegerOrNull(area_radius_m),
      location_radius_m: toIntegerOrNull(location_radius_m),
      search_areas: normalizeSearchAreas(search_areas),
      // T1.9K: only sent when set, so a report without them never depends on the new columns.
      ...(custodyFields.custody ? custodyFields : {}),
      ...precisionFields,
    };

    const { data, error } = await supaAdmin
      .from("reports")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: replay } = await supaAdmin
          .from("reports")
          .select("*")
          .eq("user_id", user.id)
          .eq("client_request_id", normalizedClientRequestId)
          .maybeSingle();
        if (replay)
          return res.json({
            report: replay,
            candidates: [],
            idempotent_replay: true,
          });
      }
      return res.status(400).json({ error: error.message });
    }

    try {
      await recordReportCreation(data, user.id);
    } catch (auditErr) {
      console.error(
        "[reports] report_creation_events insert failed",
        auditErr?.message ?? auditErr,
      );
      await supaAdmin
        .from("reports")
        .delete()
        .eq("id", data.id)
        .eq("user_id", user.id);
      return res
        .status(500)
        .json({ error: "Could not register report creation safely" });
    }

    let candidates = [];
    try {
      await supaAdmin.rpc(
        "refresh_matches_for_report",
        matchRefreshParams(data.id),
      );

      const matchColumn = data.type === "LOST" ? "lost_id" : "found_id";
      const { data: matchRows, error: matchErr } = await supaAdmin
        .from("matches")
        .select(MATCH_WITH_STATUS_SELECT)
        .eq(matchColumn, data.id)
        .order("score", { ascending: false });

      if (matchErr)
        console.warn("[reports] fetch candidates failed", matchErr.message);
      else candidates = (matchRows || []).filter(isMatchActiveForMatching);
    } catch (rpcErr) {
      console.warn(
        "[reports] refresh_matches_for_report failed",
        rpcErr?.message ?? rpcErr,
      );
    }

    // T1.9A: a guest only gets a receipt for the image upload, never match candidates.
    if (req.isGuest) return res.json({ report: { id: data.id, type: data.type }, candidates: [] });
    return res.json({ report: data, candidates });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * GET /reports/mine
 */
router.get("/mine", requireUser, async (req, res) => {
  try {
    const user = req.user;
    await syncLifecycleForUser(user.id);

    const { data, error } = await supaAdmin
      .from("reports")
      .select(
        "id, type, category, subcategory_key, subcategory_custom, title, created_at, occurred_at, color, secondary_color, brand, lat, lng, location_label, radius_m, search_radius_m, area_radius_m, location_radius_m, status, visible_until, closed_at, archived_at, last_extended_at, extension_count, critical_edit_count, last_critical_edit_at, edit_locked_until, custody",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ reports: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * PATCH /reports/:id
 * Edit a report with abuse protection.
 * - LOST requires a regular account. Ownership is enforced on the backend.
 * - Full editing during the first 15 minutes.
 * - After 15 minutes: maximum three critical edits and a 60-minute cooldown.
 * - Critical edits refresh matches.
 */
router.patch("/:id", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const reportId = req.params.id;

    const { data: existing, error: rErr } = await supaAdmin
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rErr) return res.status(400).json({ error: rErr.message });
    if (!existing) return res.status(404).json({ error: "Report not found" });

    // Do not allow changing report type. LOST remains LOST, FOUND remains FOUND.
    let patch;
    try {
      patch = normalizeReportPatch(req.body || {});
    } catch (patchErr) {
      if (patchErr?.code === "INVALID_SECONDARY_COLOR") {
        return res.status(400).json({ error: "INVALID_SECONDARY_COLOR" });
      }
      throw patchErr;
    }
    // T1.9K: custody and date precision depend on the stored type and the new date.
    try {
      const body = req.body || {};
      if ("custody" in body || "custody_place" in body)
        Object.assign(patch, normalizeCustody(existing.type, body.custody, body.custody_place));
      if ("occurred_precision" in body)
        Object.assign(patch, normalizeOccurredPrecision(body.occurred_precision, patch.occurred_at || existing.occurred_at));
    } catch (fieldErr) {
      return res.status(400).json({ error: fieldErr?.code || "INVALID_INPUT" });
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No editable fields provided" });
    }

    // Require required core fields to stay valid after patch.
    const next = { ...existing, ...patch };
    if (!next.category || !next.title || !next.occurred_at) {
      return res
        .status(400)
        .json({ error: "category, title and occurred_at are required" });
    }

    const editInfo = detectCriticalChanges(existing, patch);
    const isCritical = editInfo.isCritical;
    const inGracePeriod = minutesSince(existing.created_at) <= 15;
    const currentCriticalCount = Number(existing.critical_edit_count || 0);
    const lockedUntilRaw = existing.edit_locked_until || null;
    const lockedUntil = lockedUntilRaw ? Date.parse(lockedUntilRaw) : NaN;

    if (isCritical && !inGracePeriod) {
      if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
        return res.status(429).json({
          error: "CRITICAL_EDIT_COOLDOWN",
          message:
            "The item, time, or area was changed recently. Try again later.",
          edit_locked_until: existing.edit_locked_until,
          edit_state: publicEditState(existing),
        });
      }

      if (currentCriticalCount >= 3) {
        return res.status(429).json({
          error: "CRITICAL_EDIT_LIMIT_REACHED",
          message:
            "This report has reached the critical edit limit. Description, color, brand, and reward can still be updated.",
          edit_state: publicEditState(existing),
        });
      }
    }

    const nowIso = new Date().toISOString();
    const updatePayload = { ...patch };
    if (isCritical && !inGracePeriod) {
      updatePayload.critical_edit_count = currentCriticalCount + 1;
      updatePayload.last_critical_edit_at = nowIso;
      updatePayload.edit_locked_until = new Date(
        Date.now() + 60 * 60 * 1000,
      ).toISOString();
    }

    const { data: updated, error: uErr } = await supaAdmin
      .from("reports")
      .update(updatePayload)
      .eq("id", reportId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (uErr) return res.status(400).json({ error: uErr.message });

    // Best-effort edit log. Do not fail edit if log table is missing in early dev, but SQL should be run.
    try {
      await supaAdmin.from("report_edits").insert({
        report_id: reportId,
        user_id: user.id,
        changed_fields: editInfo.changedFields,
        critical_fields: editInfo.criticalChangedFields,
        is_critical: isCritical,
        before: existing,
        after: updated,
      });
    } catch (logErr) {
      console.warn(
        "[reports] report_edits insert failed",
        logErr?.message ?? logErr,
      );
    }

    let candidates = [];
    let cleanup = null;
    if (isCritical) {
      cleanup = await cleanupMatchesForReport(reportId);
      try {
        await supaAdmin.rpc(
          "refresh_matches_for_report",
          matchRefreshParams(reportId),
        );
        const matchColumn = updated.type === "LOST" ? "lost_id" : "found_id";
        const { data: matchRows, error: matchErr } = await supaAdmin
          .from("matches")
          .select(MATCH_WITH_STATUS_SELECT)
          .eq(matchColumn, reportId)
          .order("score", { ascending: false });

        if (matchErr)
          console.warn(
            "[reports] fetch refreshed candidates failed",
            matchErr.message,
          );
        else candidates = (matchRows || []).filter(isMatchActiveForMatching);
      } catch (rpcErr) {
        console.warn(
          "[reports] refresh_matches_for_report after edit failed",
          rpcErr?.message ?? rpcErr,
        );
      }
    }

    return res.json({
      ok: true,
      report: updated,
      edit: {
        is_critical: isCritical,
        changed_fields: editInfo.changedFields,
        critical_fields: editInfo.criticalChangedFields,
        in_grace_period: inGracePeriod,
        edit_state: publicEditState(updated),
      },
      cleanup,
      candidates,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * POST /reports/:id/extend-found
 * Confirm that the finder still has the item and extend a FOUND report by 30 days.
 * Maximum two extensions and 90 active days in total. Available when seven days or less remain,
 * or shortly after expiry while the 90-day maximum has not been reached.
 */
router.post("/:id/extend-found", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const reportId = req.params.id;
    await syncLifecycleForUser(user.id);

    const { data: existing, error: rErr } = await supaAdmin
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rErr) return res.status(400).json({ error: rErr.message });
    if (!existing) return res.status(404).json({ error: "Report not found" });
    if (existing.type !== "FOUND")
      return res.status(400).json({ error: "ONLY_FOUND_CAN_BE_EXTENDED" });
    if (existing.closed_at || existing.status === "CLOSED")
      return res.status(409).json({ error: "REPORT_CLOSED" });

    const extensionCount = Number(existing.extension_count || 0);
    if (extensionCount >= 2) {
      return res
        .status(409)
        .json({
          error: "FOUND_EXTENSION_LIMIT",
          message: "The found report has reached the 90-day maximum.",
        });
    }

    const createdAt = Date.parse(existing.created_at || "");
    const currentVisibleUntil = Date.parse(existing.visible_until || "");
    if (!Number.isFinite(createdAt))
      return res.status(400).json({ error: "INVALID_CREATED_AT" });

    const maxVisibleUntil = createdAt + 90 * 24 * 60 * 60 * 1000;
    if (Date.now() >= maxVisibleUntil) {
      return res
        .status(409)
        .json({
          error: "FOUND_MAX_AGE_REACHED",
          message: "The found report cannot be extended beyond 90 days.",
        });
    }

    const msLeft = Number.isFinite(currentVisibleUntil)
      ? currentVisibleUntil - Date.now()
      : 0;
    if (msLeft > 7 * 24 * 60 * 60 * 1000) {
      return res.status(409).json({
        error: "FOUND_EXTENSION_TOO_EARLY",
        message: "The report can be extended when seven days or less remain.",
        visible_until: existing.visible_until,
      });
    }

    const base = Math.max(
      Date.now(),
      Number.isFinite(currentVisibleUntil) ? currentVisibleUntil : Date.now(),
    );
    const nextVisibleUntil = new Date(
      Math.min(base + 30 * 24 * 60 * 60 * 1000, maxVisibleUntil),
    ).toISOString();
    const nowIso = new Date().toISOString();

    const { data: updated, error: uErr } = await supaAdmin
      .from("reports")
      .update({
        status: "ACTIVE",
        visible_until: nextVisibleUntil,
        archived_at: null,
        last_extended_at: nowIso,
        extension_count: extensionCount + 1,
      })
      .eq("id", reportId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (uErr) return res.status(400).json({ error: uErr.message });

    try {
      await supaAdmin.rpc(
        "refresh_matches_for_report",
        matchRefreshParams(reportId),
      );
    } catch (rpcErr) {
      console.warn(
        "[reports] refresh after FOUND extension failed",
        rpcErr?.message ?? rpcErr,
      );
    }

    return res.json({ ok: true, report: updated });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * POST /reports/:id/close
 * Close a report without deleting it. Closed reports are excluded from new matching.
 */
router.post("/:id/close", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const reportId = req.params.id;

    const { data: existing, error: rErr } = await supaAdmin
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rErr) return res.status(400).json({ error: rErr.message });
    if (!existing) return res.status(404).json({ error: "Report not found" });

    if (existing.status === "CLOSED" || existing.closed_at) {
      return res.json({ ok: true, report: existing, alreadyClosed: true });
    }

    const nowIso = new Date().toISOString();
    const cleanup = await cleanupMatchesForReport(reportId);

    const { data: updated, error: uErr } = await supaAdmin
      .from("reports")
      .update({ status: "CLOSED", closed_at: nowIso })
      .eq("id", reportId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (uErr) return res.status(400).json({ error: uErr.message });

    try {
      await supaAdmin.from("report_edits").insert({
        report_id: reportId,
        user_id: user.id,
        changed_fields: ["status", "closed_at"],
        critical_fields: [],
        is_critical: false,
        before: existing,
        after: updated,
      });
    } catch (logErr) {
      console.warn(
        "[reports] report_edits close insert failed",
        logErr?.message ?? logErr,
      );
    }

    return res.json({ ok: true, report: updated, cleanup });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * DELETE /reports/:id
 * Delete a report and perform best-effort cleanup of images, matches, notifications, and conversation data.
 */
router.delete("/:id", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const reportId = req.params.id;

    const { data: report, error: rErr } = await supaAdmin
      .from("reports")
      .select("id")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (rErr) return res.status(400).json({ error: rErr.message });
    if (!report) return res.status(404).json({ error: "Report not found" });

    const { data: imgs, error: iErr } = await supaAdmin
      .from("report_images")
      .select("path")
      .eq("report_id", reportId);

    if (iErr) return res.status(400).json({ error: iErr.message });

    const { data: matches, error: mErr } = await supaAdmin
      .from("matches")
      .select("id")
      .or(`lost_id.eq.${reportId},found_id.eq.${reportId}`);

    if (mErr) return res.status(400).json({ error: mErr.message });

    const matchIds = (matches || []).map((m) => m.id).filter(Boolean);
    const cleanupResults = [];

    // Delete notifications pointing directly to this report.
    await safeDelete(
      supaAdmin
        .from("notifications")
        .delete()
        .eq("entity_type", "report")
        .eq("entity_id", reportId),
      "notifications:report",
      cleanupResults,
    );

    // Delete notifications and related rows pointing to matches/conversations for this report.
    if (matchIds.length > 0) {
      await safeDelete(
        supaAdmin.from("notifications").delete().in("entity_id", matchIds),
        "notifications:matches_or_chat",
        cleanupResults,
      );
      await safeDelete(
        supaAdmin.from("payments").delete().in("match_id", matchIds),
        "payments",
        cleanupResults,
      );
      await safeDelete(
        supaAdmin.from("messages").delete().in("conversation_id", matchIds),
        "messages",
        cleanupResults,
      );
      await safeDelete(
        supaAdmin.from("conversations").delete().in("id", matchIds),
        "conversations",
        cleanupResults,
      );
      await safeDelete(
        supaAdmin.from("matches").delete().in("id", matchIds),
        "matches",
        cleanupResults,
      );
    }

    const paths = (imgs || []).map((x) => x.path).filter(Boolean);

    await safeDelete(
      supaAdmin.from("report_images").delete().eq("report_id", reportId),
      "report_images",
      cleanupResults,
    );
    const { count: orderCount, error: orderCheckError } = await supaAdmin
      .from("report_orders")
      .select("id", { count: "exact", head: true })
      .eq("report_id", reportId);
    if (orderCheckError)
      return res.status(400).json({ error: "REPORT_DELETE_CHECK_FAILED" });
    if (Number(orderCount || 0) > 0) {
      const deletedAt = new Date().toISOString();
      const { error: softDeleteError } = await supaAdmin
        .from("reports")
        .update({
          deleted_at: deletedAt,
          status: "ARCHIVED",
          archived_at: deletedAt,
        })
        .eq("id", reportId)
        .eq("user_id", user.id);
      if (softDeleteError)
        return res.status(400).json({ error: "REPORT_DELETE_FAILED" });
      return res.json({
        ok: true,
        deleted: reportId,
        deletionMode: "SOFT",
        cleanupResults,
      });
    }
    const { error: dErr } = await supaAdmin
      .from("reports")
      .delete()
      .eq("id", reportId)
      .eq("user_id", user.id);
    if (dErr)
      return res
        .status(400)
        .json({ error: "REPORT_DELETE_FAILED", cleanupResults });

    const byBucket = new Map();
    for (const p of paths) {
      const [bucket, ...rest] = String(p).split("/");
      const objectPath = rest.join("/");
      if (!bucket || !objectPath) continue;
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(objectPath);
    }

    const storageCleanup = [];
    for (const [bucket, objectPaths] of byBucket.entries()) {
      try {
        const { error: sErr } = await supaAdmin.storage
          .from(bucket)
          .remove(objectPaths);
        if (sErr)
          storageCleanup.push({ bucket, ok: false, error: sErr.message });
        else
          storageCleanup.push({ bucket, ok: true, count: objectPaths.length });
      } catch (e) {
        storageCleanup.push({
          bucket,
          ok: false,
          error: String(e?.message ?? e),
        });
      }
    }

    return res.json({
      ok: true,
      deleted: reportId,
      matchCleanupCount: matchIds.length,
      cleanupResults,
      storageCleanup,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * GET /reports/:id
 * Owner-only report details with images, paid additions and confirmed chat history.
 */
router.get("/:id", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const reportId = req.params.id;

    const { data: report, error: rErr } = await supaAdmin
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (rErr) return res.status(400).json({ error: rErr.message });
    if (!report) return res.status(404).json({ error: "Report not found" });

    const [
      imagesResult,
      entitlementsResult,
      campaignsResult,
      lostMatchesResult,
      foundMatchesResult,
      observationsResult,
    ] = await Promise.all([
      supaAdmin
        .from("report_images")
        .select("id, path, sort_order")
        .eq("report_id", reportId)
        .order("sort_order", { ascending: true }),
      supaAdmin
        .from("report_entitlements")
        .select(
          "id, product_code, status, starts_at, current_period_end, auto_renews, provider, order_id",
        )
        .eq("report_id", reportId)
        .order("created_at", { ascending: false }),
      supaAdmin
        .from("geo_alert_campaigns")
        .select(
          "id, status, geometry_type, radius_m, area_sq_km, population_density_band, estimated_eligible_users, duration_hours, reminder_count, price_tier, starts_at, ends_at, activated_at, completed_at",
        )
        .eq("report_id", reportId)
        .order("created_at", { ascending: false }),
      supaAdmin
        .from("matches")
        .select("id, status, score, created_at, lost_id, found_id")
        .eq("lost_id", reportId)
        .in("status", ["CONFIRMED", "PAID"]),
      supaAdmin
        .from("matches")
        .select("id, status, score, created_at, lost_id, found_id")
        .eq("found_id", reportId)
        .in("status", ["CONFIRMED", "PAID"]),
      supaAdmin
        .from("area_alert_observations")
        .select(
          "id,observation_type,observed_at,comment,movement_direction,has_item,status,created_at",
        )
        .eq("report_id", reportId)
        .order("created_at", { ascending: false }),
    ]);

    for (const result of [
      imagesResult,
      entitlementsResult,
      campaignsResult,
      lostMatchesResult,
      foundMatchesResult,
      observationsResult,
    ]) {
      if (result.error)
        return res.status(400).json({ error: result.error.message });
    }

    const images = [];
    for (const image of imagesResult.data || []) {
      const parts = String(image.path || "")
        .split("/")
        .filter(Boolean);
      const bucket = parts.shift();
      const objectPath = parts.join("/");
      let signed_url = null;
      if (bucket && objectPath) {
        try {
          const { data } = await supaAdmin.storage
            .from(bucket)
            .createSignedUrl(objectPath, 60 * 60);
          signed_url = data?.signedUrl || data?.signedURL || null;
        } catch (e) {
          console.warn("[reports] signed image URL failed", e?.message || e);
        }
      }
      images.push({ ...image, signed_url });
    }

    const matchMap = new Map();
    for (const match of [
      ...(lostMatchesResult.data || []),
      ...(foundMatchesResult.data || []),
    ])
      matchMap.set(match.id, match);
    const confirmedMatches = Array.from(matchMap.values());
    const matchIds = confirmedMatches.map((match) => match.id);
    let lastMessages = [];
    if (matchIds.length > 0) {
      const { data, error } = await supaAdmin
        .from("last_message_per_conversation")
        .select("conversation_id, sender_id, body, created_at")
        .in("conversation_id", matchIds);
      if (!error) lastMessages = data || [];
    }

    return res.json({
      report,
      images,
      entitlements: entitlementsResult.data || [],
      geo_alert_campaigns: campaignsResult.data || [],
      confirmed_matches: confirmedMatches,
      last_messages: lastMessages,
      observations: observationsResult.data || [],
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

module.exports = router;
