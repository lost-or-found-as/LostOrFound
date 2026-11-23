"use strict";
// T1.9BT: Live Activity for the owner's lost case («Bamse savnet · 3 t · 2 tips · 1 mulig treff»).
// The app starts the activity and registers its APNs token here. The server keeps it current: when
// the owner gets a notification (a tip, a match …) and every 15 minutes, it recounts the case and
// pushes only if the text changed. When the case closes, expires or is deleted, the activity ends.
// Switched off unless LIVE_ACTIVITIES_ENABLED=true; without APNs settings nothing is sent.
// All texts are made here in the activity's language, so the lock screen needs no translations.
const crypto = require("crypto");
const { message } = require("./messages");
const { normalizeLanguage } = require("./languages");
const { reportItemText } = require("./reportItemText");
const apns = require("./apns");
const { visibleObservations } = require("./petSightings");

const ACTIVITY_NAME = "CaseActivity";
const REFRESH_EVERY_MS = 15 * 60 * 1000;
const DEBOUNCE_MS = 20 * 1000;
// iOS removes a Live Activity after at most 12 hours on the lock screen; stop pushing after that.
const MAX_AGE_MS = 13 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const ANIMALS = new Set(["DOG", "CAT", "BIRD", "RABBIT", "SMALL_PET", "REPTILE", "HORSE", "OTHER_PET", "CUSTOM"]);

function liveActivitiesEnabled(env = process.env) {
  return String(env.LIVE_ACTIVITIES_ENABLED || "").trim().toLowerCase() === "true";
}

const isAnimal = (r) => String(r?.category || "").toUpperCase() === "PETS" && ANIMALS.has(String(r?.subcategory_key || "").toUpperCase());

/** True while the lost case can still be followed on the lock screen. */
function isFollowable(report, now = Date.now()) {
  if (!report || String(report.type || "").toUpperCase() !== "LOST") return false;
  if (report.deleted_at || report.closed_at || report.hidden_at) return false;
  if (report.status && String(report.status).toUpperCase() !== "ACTIVE") return false;
  if (report.visible_until && Date.parse(report.visible_until) <= now) return false;
  return true;
}

function countText(lang, key, count) {
  return message(lang, `liveActivity.${key}.${count === 1 ? "one" : "other"}`, { count });
}

/**
 * The props the lock screen shows; every text is ready to display.
 * counts: { tips, matches }. A case that cannot be followed gives ended: true.
 */
function caseProps(report, counts, language, now = Date.now()) {
  const lang = normalizeLanguage(language);
  const animal = isAnimal(report);
  const name = animal && report?.pet_name ? String(report.pet_name).trim() : "";
  const tips = Math.max(0, Number(counts?.tips || 0));
  const matches = Math.max(0, Number(counts?.matches || 0));
  const parts = [];
  if (tips) parts.push(countText(lang, "tips", tips));
  if (matches) parts.push(countText(lang, "matches", matches));
  const since = Date.parse(report?.occurred_at || report?.created_at || "") || now;
  const ended = !isFollowable(report, now);
  return {
    kicker: message(lang, animal ? "liveActivity.kicker.lostPet" : "liveActivity.kicker.lost"),
    title: (name || reportItemText(report, lang) || message(lang, "liveActivity.kicker.lost")).slice(0, 40),
    detail: ended ? message(lang, "liveActivity.ended") : parts.length ? parts.join(" · ") : message(lang, "liveActivity.none"),
    badge: String(Math.min(99, tips + matches)),
    sinceLabel: message(lang, "liveActivity.since"),
    sinceMs: Math.min(since, now),
    ended,
    url: report?.id ? `lostorfound://report-details/${report.id}` : "lostorfound://",
  };
}

function propsHash(props) {
  return crypto.createHash("sha256").update(JSON.stringify(props)).digest("hex").slice(0, 32);
}

/** The owner's lost case with its counts: { report, tips, matches } or null. */
async function loadCaseState(supa, reportId, userId, deps = {}) {
  const r = await supa
    .from("reports")
    .select("id,user_id,type,status,category,subcategory_key,subcategory_custom,color,brand,pet_name,occurred_at,created_at,closed_at,deleted_at,hidden_at,visible_until")
    .eq("id", reportId)
    .eq("user_id", userId)
    .maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return null;
  const obs = await supa.from("area_alert_observations").select("id,status").eq("report_id", reportId);
  if (obs.error) throw obs.error;
  const tips = visibleObservations(obs.data).length;
  let matches = 0;
  try {
    // Counted by the same rules as the match list (T1.9BP).
    const loadReportMatches = deps.loadReportMatches || require("../routes/matches").loadReportMatches;
    const { isShownOpenMatch } = require("./reportActivity");
    const loaded = await loadReportMatches(reportId, userId);
    matches = (loaded?.matches || []).filter(isShownOpenMatch).length;
  } catch (e) {
    console.warn("[live] match count failed", e?.message ?? e);
  }
  return { report: r.data, tips, matches };
}

async function markRow(supa, id, patch) {
  const upd = await supa.from("live_activity_tokens").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (upd.error) console.warn("[live] row update failed", upd.error.message);
}

/** Recounts one activity and pushes when its text changed; ends it when the case is over. */
async function refreshRow(supa, row, { priority = 10, deps = {}, now = Date.now() } = {}) {
  if (!row?.push_token) return "NO_TOKEN";
  if (now - Date.parse(row.created_at) > MAX_AGE_MS) {
    await markRow(supa, row.id, { status: "ENDED" });
    return "TOO_OLD";
  }
  const state = await loadCaseState(supa, row.report_id, row.user_id, deps);
  const props = state ? caseProps(state.report, state, row.language, now) : { ...caseProps(null, {}, row.language, now), ended: true };
  const hash = propsHash(props);
  if (!props.ended && hash === row.last_props_hash) return "UNCHANGED";
  const send = deps.sendLiveActivity || apns.sendLiveActivity;
  const payload = apns.liveActivityPayload({
    event: props.ended ? "end" : "update",
    name: ACTIVITY_NAME,
    props,
    // Ended: the lock screen keeps the final text for an hour.
    dismissalDate: props.ended ? new Date(now + 60 * 60 * 1000) : null,
    now,
  });
  const result = await send(row.push_token, payload, { priority });
  if (result.ok) {
    await markRow(supa, row.id, { last_props_hash: hash, last_pushed_at: new Date(now).toISOString(), failures: 0, ...(props.ended ? { status: "ENDED" } : {}) });
    return props.ended ? "ENDED" : "SENT";
  }
  if (apns.isDeadToken(result) || row.failures + 1 >= MAX_FAILURES) {
    await markRow(supa, row.id, { status: "ENDED" });
    return "DEAD";
  }
  if (result.reason !== "APNS_NOT_CONFIGURED") {
    console.warn("[live] push failed", result.status, result.reason);
    await markRow(supa, row.id, { failures: row.failures + 1 });
  }
  return "FAILED";
}

async function activeRows(supa, filter = {}) {
  let q = supa.from("live_activity_tokens").select("*").eq("status", "ACTIVE").not("push_token", "is", null).limit(500);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const res = await q;
  if (res.error) throw res.error;
  return res.data || [];
}

async function refreshUser(supa, userId, opts = {}) {
  if (!liveActivitiesEnabled(opts.env) || !apns.apnsConfigured(opts.env)) return [];
  const out = [];
  for (const row of await activeRows(supa, { user_id: userId })) out.push(await refreshRow(supa, row, opts));
  return out;
}

async function refreshAll(supa, opts = {}) {
  if (!liveActivitiesEnabled(opts.env) || !apns.apnsConfigured(opts.env)) return [];
  const out = [];
  for (const row of await activeRows(supa)) {
    try {
      out.push(await refreshRow(supa, row, { ...opts, priority: 5 }));
    } catch (e) {
      console.warn("[live] refresh failed", e?.message ?? e);
    }
  }
  return out;
}

// Several notifications in a row (a tip and its push) give one recount.
const pending = new Map();
function nudgeUser(userId, { delayMs = DEBOUNCE_MS } = {}) {
  if (!userId || !liveActivitiesEnabled() || !apns.apnsConfigured()) return;
  if (pending.has(userId)) return;
  const timer = setTimeout(() => {
    pending.delete(userId);
    const { supaAdmin } = require("../supabaseClient");
    refreshUser(supaAdmin, userId).catch((e) => console.warn("[live] nudge failed", e?.message ?? e));
  }, delayMs);
  timer.unref?.();
  pending.set(userId, timer);
}

function scheduleLiveActivities({ supa, log = console } = {}) {
  if (!liveActivitiesEnabled()) return null;
  if (!apns.apnsConfigured()) {
    log.warn?.("[live] LIVE_ACTIVITIES_ENABLED but APNs is not configured; nothing will be sent");
    return null;
  }
  const timer = setInterval(() => {
    refreshAll(supa).catch((e) => log.warn?.("[live] scheduled refresh failed", e?.message ?? e));
  }, REFRESH_EVERY_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  ACTIVITY_NAME,
  MAX_AGE_MS,
  liveActivitiesEnabled,
  isFollowable,
  caseProps,
  propsHash,
  loadCaseState,
  refreshRow,
  refreshUser,
  refreshAll,
  nudgeUser,
  scheduleLiveActivities,
};
