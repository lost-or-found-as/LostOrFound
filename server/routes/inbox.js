"use strict";
// T1.9BJ: «Meldinger» – every conversation the user is part of, in one list: match chats (as the
// owner or the finder) and sightings from area alerts (as the owner or the helper), also after
// the case is solved. Before, a helper could only find a sighting again through a notification.
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { loadThumbnailUrls } = require("../lib/reportThumbnails");
const { bonusEnabled, helperStatus } = require("../lib/helperBonus");

const REPORT_FIELDS = "id,user_id,type,category,subcategory_key,subcategory_custom,color,brand,status,closed_at,deleted_at";
const CHAT_MATCH_STATUSES = ["CONFIRMED", "PAID"];
const MAX_ITEMS = 100;

function preview(body) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function subject(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    subcategory_key: r.subcategory_key,
    subcategory_custom: r.subcategory_custom,
    color: r.color,
    brand: r.brand,
  };
}

function closed(r) {
  return !!r && (String(r.status || "").toUpperCase() === "CLOSED" || !!r.closed_at);
}

/** Builds the list from plain rows (kept apart from the database calls so it can be tested). */
function buildInbox({ userId, matches, reportsById, matchLast, observations, conversations, observationLast }) {
  const items = [];
  for (const m of matches) {
    const lost = reportsById.get(m.lost_id);
    const found = reportsById.get(m.found_id);
    const mine = lost?.user_id === userId ? lost : found?.user_id === userId ? found : null;
    if (!mine || mine.deleted_at) continue;
    const theirs = mine === lost ? found : lost;
    const last = matchLast.get(m.id) || null;
    items.push({
      kind: "MATCH",
      id: m.id,
      reportId: mine.id,
      role: mine === lost ? "OWNER" : "FINDER",
      counterpartId: theirs?.user_id || null,
      photoReportId: mine.id,
      subject: subject(lost || found),
      caseClosed: closed(lost) || closed(found),
      last: last ? { body: preview(last.body), at: last.created_at, mine: last.sender_id === userId } : null,
      at: last?.created_at || m.created_at,
    });
  }
  const convByObservation = new Map(conversations.map((c) => [c.observation_id, c]));
  for (const o of observations) {
    const r = reportsById.get(o.report_id);
    if (!r || r.deleted_at) continue;
    const conv = convByObservation.get(o.id) || null;
    const last = conv ? observationLast.get(conv.id) || null : null;
    items.push({
      kind: "OBSERVATION",
      id: o.id,
      reportId: r.id,
      role: o.observer_user_id === userId ? "HELPER" : "OWNER",
      counterpartId: o.observer_user_id === userId ? o.report_owner_user_id : o.observer_user_id,
      photoReportId: r.id,
      observationType: o.observation_type,
      hasConversation: !!conv,
      subject: subject(r),
      caseClosed: closed(r),
      last: last ? { body: preview(last.body), at: last.created_at, mine: last.sender_id === userId } : null,
      at: last?.created_at || o.created_at,
    });
  }
  items.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  return items.slice(0, MAX_ITEMS);
}

function latestBy(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const prev = map.get(row[key]);
    if (!prev || Date.parse(row.created_at) > Date.parse(prev.created_at)) map.set(row[key], row);
  }
  return map;
}

router.get("/", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const own = await supaAdmin.from("reports").select("id").eq("user_id", userId).is("deleted_at", null);
    if (own.error) throw own.error;
    const ownIds = (own.data || []).map((r) => r.id);

    let matches = [];
    if (ownIds.length) {
      const [a, b] = await Promise.all([
        supaAdmin.from("matches").select("id,lost_id,found_id,status,created_at").in("lost_id", ownIds).in("status", CHAT_MATCH_STATUSES),
        supaAdmin.from("matches").select("id,lost_id,found_id,status,created_at").in("found_id", ownIds).in("status", CHAT_MATCH_STATUSES),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      const byId = new Map([...(a.data || []), ...(b.data || [])].map((m) => [m.id, m]));
      matches = [...byId.values()];
    }

    const obs = await supaAdmin
      .from("area_alert_observations")
      .select("id,report_id,observer_user_id,report_owner_user_id,observation_type,created_at")
      .or(`observer_user_id.eq.${userId},report_owner_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS);
    if (obs.error) throw obs.error;
    const observations = obs.data || [];

    const reportIds = [...new Set([...matches.flatMap((m) => [m.lost_id, m.found_id]), ...observations.map((o) => o.report_id)].filter(Boolean))];
    const reportsById = new Map();
    if (reportIds.length) {
      const r = await supaAdmin.from("reports").select(REPORT_FIELDS).in("id", reportIds);
      if (r.error) throw r.error;
      for (const row of r.data || []) reportsById.set(row.id, row);
    }

    let matchLast = new Map();
    if (matches.length) {
      const l = await supaAdmin.from("last_message_per_conversation").select("conversation_id,sender_id,body,created_at").in("conversation_id", matches.map((m) => m.id));
      if (l.error) throw l.error;
      matchLast = latestBy(l.data, "conversation_id");
    }

    let conversations = [];
    let observationLast = new Map();
    if (observations.length) {
      const c = await supaAdmin.from("observation_conversations").select("id,observation_id").in("observation_id", observations.map((o) => o.id));
      if (c.error) throw c.error;
      conversations = c.data || [];
      if (conversations.length) {
        const m = await supaAdmin
          .from("observation_messages")
          .select("conversation_id,sender_id,body,created_at")
          .in("conversation_id", conversations.map((x) => x.id))
          .order("created_at", { ascending: false })
          .limit(1000);
        if (m.error) throw m.error;
        observationLast = latestBy(m.data, "conversation_id");
      }
    }

    const items = buildInbox({ userId, matches, reportsById, matchLast, observations, conversations, observationLast });

    // T1.9BL: the item's photo (never a held one) and the other person's helper level.
    const thumbs = await loadThumbnailUrls(supaAdmin, [...new Set(items.map((i) => i.photoReportId).filter(Boolean))], { skipHeld: true });
    const helpers = new Map();
    if (bonusEnabled()) {
      for (const id of [...new Set(items.map((i) => i.counterpartId).filter(Boolean))]) {
        try {
          const st = await helperStatus({ supa: supaAdmin, userId: id });
          if (st?.level) helpers.set(id, st);
        } catch {
          // The level is a nicety; the list works without it.
        }
      }
    }
    const out = items.map(({ counterpartId, photoReportId, ...item }) => ({
      ...item,
      thumbnail_url: thumbs.get(photoReportId) || null,
      counterpart_helper: helpers.get(counterpartId) || null,
    }));
    return res.json({ ok: true, items: out });
  } catch (e) {
    console.error("[inbox] load failed", e?.message || e);
    return res.status(500).json({ error: "INBOX_LOAD_FAILED" });
  }
});

module.exports = router;
module.exports.buildInbox = buildInbox;
