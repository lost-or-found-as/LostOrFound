// server/routes/matches.js
// Matches API:
// - GET /matches?reportId=... retrieves matches for a report.
// - GET /matches/:id retrieves one match.
// - POST /matches/:id/status updates match status.
//
// Policies:
// - 3A: Only the LOST report owner can confirm a match. The FOUND side cannot initiate contact.
// - B2a: Notify the other party when a match is confirmed.
// - B safety rule: Use an hourly buffer to hide chronologically impossible matches.
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
const { notifyUser } = require("../lib/userNotify");
const { localizedPair } = require("../lib/messages");
const { redactCustodyForViewer } = require("../lib/reportCustody");

if (!supaAdmin || typeof supaAdmin.from !== "function") {
  throw new Error(
    "Supabase admin client is not initialized correctly: supaAdmin.from is not a function.",
  );
}

// Configuration: API time buffer in hours, default 48. Can be set in the server environment.
// The Supabase matching engine should use the same p_time_buffer_hours value.
const MATCH_TIME_BUFFER_HOURS = (() => {
  const raw = process.env.MATCH_TIME_BUFFER_HOURS;
  const n = Number.parseInt(String(raw ?? "48"), 10);
  if (!Number.isFinite(n)) return 48;
  return Math.max(0, Math.min(24 * 30, n)); // Clamp to 0 through 30 days.
})();

function isAllowedStatus(s) {
  return s === "SEEN" || s === "DISMISSED" || s === "CONFIRMED";
}

const MATCH_SELECT = `
     id, score, status, reasons, created_at,
     lost:lost_id (
       id, user_id, type, category, subcategory_key, title, description, color, secondary_color, brand,
       occurred_at, created_at, lat, lng, location_label,
       radius_m, search_radius_m, area_radius_m, location_radius_m,
       status, visible_until, closed_at, archived_at,
       reward_ore, custody, custody_place,
       report_images ( id, path, sort_order, created_at )
     ),
     found:found_id (
       id, user_id, type, category, subcategory_key, title, description, color, secondary_color, brand,
       occurred_at, created_at, lat, lng, location_label,
       radius_m, search_radius_m, area_radius_m, location_radius_m,
       status, visible_until, closed_at, archived_at,
       reward_ore, custody, custody_place,
       report_images ( id, path, sort_order, created_at )
     )
    `;

// Adjusted time rule:
// LOST.occurred_at is when the user believes the item was lost.
// FOUND.occurred_at is the last-seen time, not the reported find time.
// Therefore this guard uses FOUND.created_at, the report submission time.
// Hard stop when the LOST time exceeds the FOUND submission time plus the buffer.
function isTimeCompatible(lost, found) {
  try {
    const bufferMs = MATCH_TIME_BUFFER_HOURS * 60 * 60 * 1000;
    const lostWhen = Date.parse(lost?.occurred_at || lost?.created_at || "");
    const foundReported = Date.parse(found?.created_at || "");
    // Do not block when the available data is insufficient.
    if (!Number.isFinite(lostWhen) || !Number.isFinite(foundReported))
      return true;
    return lostWhen <= foundReported + bufferMs;
  } catch {
    return true;
  }
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function reportRadiusMeters(rep) {
  const candidates = [
    rep?.radius_m,
    rep?.search_radius_m,
    rep?.area_radius_m,
    rep?.location_radius_m,
    rep?.search_radius,
    rep?.radius,
    rep?.area_radius,
    rep?.location_radius,
  ];
  for (const raw of candidates) {
    const n = toNumber(raw);
    if (n != null && n > 0) return n;
  }
  return null;
}

function isActiveReport(rep) {
  if (!rep) return false;
  if (rep.status && rep.status !== "ACTIVE") return false;
  if (rep.closed_at || rep.archived_at) return false;
  if (rep.visible_until && Date.parse(rep.visible_until) <= Date.now())
    return false;
  return true;
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function upsertReason(reasons, key, value) {
  const list = Array.isArray(reasons) ? reasons.slice() : [];
  const idx = list.findIndex((r) => r && r.k === key);
  const entry = { k: key, v: value };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  return list;
}

// Enrich matches with area and radius information for the frontend:
// - distance_m when missing
// - within_radius
// - outside_radius_m
function enrichMatchAreaInfo(match) {
  try {
    if (!match || !match.lost || !match.found) return match;

    let reasons = Array.isArray(match.reasons) ? match.reasons.slice() : [];
    const existingDistance = reasons.find((r) => r?.k === "distance_m")?.v;

    const lostLat = toNumber(match.lost?.lat);
    const lostLng = toNumber(match.lost?.lng);
    const foundLat = toNumber(match.found?.lat);
    const foundLng = toNumber(match.found?.lng);

    let distanceM = toNumber(existingDistance);

    // Calculate distance_m here when it is not already available.
    if (
      distanceM == null &&
      lostLat != null &&
      lostLng != null &&
      foundLat != null &&
      foundLng != null
    ) {
      distanceM = Math.round(
        haversineMeters(lostLat, lostLng, foundLat, foundLng),
      );
      reasons = upsertReason(reasons, "distance_m", distanceM);
    }

    // Use the LOST report radius for area evaluation.
    const radiusM = reportRadiusMeters(match.lost);

    if (distanceM != null && radiusM != null) {
      const withinRadius = distanceM <= radiusM;
      const outsideRadiusM = Math.max(0, distanceM - radiusM);
      reasons = upsertReason(reasons, "within_radius", withinRadius);
      reasons = upsertReason(reasons, "outside_radius_m", outsideRadiusM);
    }

    return { ...match, reasons };
  } catch {
    return match;
  }
}

function secondaryColorValue(report) {
  const direct = String(report?.secondary_color || "")
    .trim()
    .toLowerCase();
  if (direct) return direct;
  const match = String(report?.description || "").match(
    /(?:Secondary color|Tilleggsfarge):\s*([^\n]+)/i,
  );
  return (
    String(match?.[1] || "")
      .trim()
      .toLowerCase() || null
  );
}
function reportColors(report) {
  return [report?.color, secondaryColorValue(report)]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}
function enrichMatchColorInfo(match) {
  if (!match?.lost || !match?.found) return match;
  const lostColors = reportColors(match.lost);
  const foundColors = reportColors(match.found);
  const sharedColor =
    lostColors.find((value) => foundColors.includes(value)) || null;
  let reasons = Array.isArray(match.reasons) ? match.reasons.slice() : [];
  // T1.9H: the database stores 1/0 and now compares both colours itself, so a colour it has
  // already scored is not added again here.
  const storedColorMatch = reasons.find((entry) => entry?.k === "color_match")?.v;
  const previousColorMatch = storedColorMatch === true || Number(storedColorMatch) === 1;
  reasons = upsertReason(reasons, "color_match", !!sharedColor);
  if (sharedColor)
    reasons = upsertReason(reasons, "matched_color", sharedColor);
  const score =
    sharedColor && !previousColorMatch
      ? Math.min(100, Number(match.score || 0) + 10)
      : Number(match.score || 0);
  reasons = upsertReason(
    reasons,
    "display_score_adjustment",
    score - Number(match.score || 0),
  );
  return { ...match, score, reasons };
}
// T1.9G: the matches the owner of a report sees, filtered and enriched the same way for the
// match list (GET /matches) and the case activity (GET /reports/:id/activity).
// Returns null when the report does not exist or belongs to someone else.
async function loadReportMatches(reportId, userId) {
  const { data: report, error: rErr } = await supaAdmin
    .from("reports")
    .select("id, type, user_id")
    .eq("id", reportId)
    .eq("user_id", userId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!report) return null;

  const isLost = report.type === "LOST";
  const { data: matches, error: mErr } = await supaAdmin
    .from("matches")
    .select(MATCH_SELECT)
    .or(isLost ? `lost_id.eq.${reportId}` : `found_id.eq.${reportId}`)
    .order("score", { ascending: false });
  if (mErr) throw mErr;

  const filtered = (matches || [])
    .filter((m) => isActiveReport(m?.lost) && isActiveReport(m?.found))
    .filter((m) => isTimeCompatible(m?.lost, m?.found))
    .map(enrichMatchAreaInfo)
    .map(enrichMatchColorInfo)
    // T1.9K: the hand-in place is shown only after the owner has confirmed the match.
    .map((m) => redactCustodyForViewer(m, userId));
  return { report, matches: filtered };
}

// GET /matches?reportId=...
router.get("/", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const reportId = String(req.query.reportId || "");
    if (!reportId) return res.status(400).json({ error: "reportId required" });

    const loaded = await loadReportMatches(reportId, user.id);
    if (!loaded) return res.status(404).json({ error: "Report not found" });
    return res.json({ matches: loaded.matches });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// GET /matches/:id
router.get("/:id", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;

    const { data: match, error } = await supaAdmin
      .from("matches")
      .select(MATCH_SELECT)
      .eq("id", matchId)
      .single();

    if (error || !match)
      return res.status(404).json({ error: "Match not found" });

    const owns =
      match?.lost?.user_id === user.id || match?.found?.user_id === user.id;
    if (!owns) return res.status(403).json({ error: "Not allowed" });

    // Hide closed, expired, archived, and chronologically impossible matches.
    if (!isActiveReport(match?.lost) || !isActiveReport(match?.found)) {
      return res.status(404).json({ error: "Match not found" });
    }
    if (!isTimeCompatible(match?.lost, match?.found)) {
      return res.status(404).json({ error: "Match not found" });
    }

    return res.json({
      match: redactCustodyForViewer(enrichMatchColorInfo(enrichMatchAreaInfo(match)), user.id),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// POST /matches/:id/status
// body: { status: "SEEN" | "DISMISSED" | "CONFIRMED" }
router.post("/:id/status", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const matchId = req.params.id;
    const status = req.body?.status;

    if (!isAllowedStatus(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { data: match, error: mErr } = await supaAdmin
      .from("matches")
      .select(
        `id, status, lost:lost_id ( user_id ), found:found_id ( user_id )`,
      )
      .eq("id", matchId)
      .single();

    if (mErr || !match)
      return res.status(404).json({ error: "Match not found" });

    const ownsLost = match.lost?.user_id === user.id;
    const ownsFound = match.found?.user_id === user.id;
    if (!ownsLost && !ownsFound)
      return res.status(403).json({ error: "Not allowed" });

    // 3A: The FOUND side cannot initiate contact. Only the LOST owner can confirm.
    if (status === "CONFIRMED" && !ownsLost) {
      return res.status(403).json({ error: "Only LOST owner can confirm" });
    }

    const { error: uErr } = await supaAdmin
      .from("matches")
      .update({ status })
      .eq("id", matchId);
    if (uErr) return res.status(400).json({ error: uErr.message });

    // Create the conversation when the match is confirmed.
    if (status === "CONFIRMED") {
      const { error: cErr } = await supaAdmin
        .from("conversations")
        .insert({ id: matchId });
      if (
        cErr &&
        !String(cErr.message || "")
          .toLowerCase()
          .includes("duplicate")
      ) {
        return res.status(500).json({ error: "Failed to create conversation" });
      }
    }

    // B2a: Notify the other party on the first confirmation.
    if (status === "CONFIRMED" && match.status !== "CONFIRMED") {
      const otherUserId = ownsLost
        ? match.found?.user_id
        : ownsFound
          ? match.lost?.user_id
          : null;

      if (otherUserId && otherUserId !== user.id) {
        try {
          await notifyUser({
            userId: otherUserId,
            type: "MATCH_CONFIRMED",
            entityType: "match",
            entityId: matchId,
            titles: localizedPair("push.matchConfirmed.title"),
            bodies: localizedPair("push.matchConfirmed.body"),
          });
        } catch (nErr) {
          console.warn(
            "[matches] notify MATCH_CONFIRMED failed",
            nErr?.message ?? nErr,
          );
        }
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

router.post("/:id/messages", requireUser, async (req, res) => {
  try {
    const body = String(req.body?.body || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!body || body.length > 1000)
      return res.status(400).json({ error: "INVALID_MESSAGE" });
    const q = await supaAdmin
      .from("matches")
      .select("id,lost:lost_id(user_id),found:found_id(user_id)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (q.error) throw q.error;
    const m = q.data;
    const users = [m?.lost?.user_id, m?.found?.user_id];
    if (!m || !users.includes(req.user.id))
      return res.status(404).json({ error: "MATCH_NOT_FOUND" });
    const ins = await supaAdmin
      .from("messages")
      .insert({ conversation_id: m.id, sender_id: req.user.id, body })
      .select("*")
      .single();
    if (ins.error) throw ins.error;
    const other = users.find((x) => x && x !== req.user.id);
    if (other)
      await notifyUser({
        userId: other,
        type: "NEW_MESSAGE",
        entityType: "chat",
        entityId: m.id,
        titles: localizedPair("push.newMessage.title"),
        bodies: localizedPair("push.newMessage.body"),
      });
    return res.json({ ok: true, message: ins.data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "MESSAGE_SEND_FAILED" });
  }
});
module.exports = router;
module.exports.loadReportMatches = loadReportMatches;
