"use strict";
// T1.9AS: bonus for helpers. Rules agreed 18.11.2026 (doc «Poeng for hjelpere – forslag»):
// registered find 1, useful sighting 1, match confirmed 3, sighting that solved the case 5,
// confirmed return 15; at most 30 per month; valid 12 months; no money value.
// Nothing is awarded until HELPER_BONUS_ENABLED=true (terms and privacy text must come first).

const DAY = 24 * 60 * 60 * 1000;
const POINTS = Object.freeze({
  FOUND_REGISTERED: 1,
  SIGHTING_USEFUL: 1,
  MATCH_CONFIRMED: 3,
  SIGHTING_RESOLVED: 5,
  RETURN_CONFIRMED: 15,
});
const MONTHLY_CAP = 30;
const EVENT_MONTHLY_CAPS = Object.freeze({ FOUND_REGISTERED: 3, SIGHTING_USEFUL: 3 });
const PAIR_EVENTS = new Set(["MATCH_CONFIRMED", "SIGHTING_USEFUL", "SIGHTING_RESOLVED", "RETURN_CONFIRMED"]);
const PAIR_DAYS = 90;
const CASE_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const CASE_AGE_EVENTS = new Set(["SIGHTING_RESOLVED", "RETURN_CONFIRMED"]);
const FOUND_HOLD_MS = DAY;
const VALID_MONTHS = 12;
const REDEEM_MIN_ACCOUNT_DAYS = 14;
const LEVELS = Object.freeze([
  { level: "MASTER_HELPER", from: 15 },
  { level: "SUPER_HELPER", from: 5 },
  { level: "HELPER", from: 1 },
]);

function bonusEnabled(env = process.env) {
  return String(env.HELPER_BONUS_ENABLED || "").toLowerCase() === "true";
}

/** Helper status shown to others: by confirmed returns only, never by bonus. */
function helperLevel(returns) {
  const n = Number(returns) || 0;
  return LEVELS.find((l) => n >= l.from)?.level || null;
}

// T1.9AX: after Mesterhjelper (15 returns) one star per 15 more returns, at most five.
const STAR_STEP = 15;
const MAX_STARS = 5;
function helperStars(returns) {
  const n = Number(returns) || 0;
  return Math.max(0, Math.min(MAX_STARS, Math.floor((n - LEVELS[0].from) / STAR_STEP)));
}

/** T1.9AX: the next level (or star) and how many returns it takes, for the progress bar. */
function nextStep(returns) {
  const n = Number(returns) || 0;
  const up = [...LEVELS].reverse().find((l) => n < l.from);
  if (up) return { kind: "LEVEL", level: up.level, at: up.from };
  const stars = helperStars(n);
  if (stars >= MAX_STARS) return null;
  return { kind: "STAR", stars: stars + 1, at: LEVELS[0].from + (stars + 1) * STAR_STEP };
}

/** T1.9AX: in-app notice (never push) when bonus is earned. Never throws. */
async function notifyAwarded({ userId, event, points, ledgerId, notify, log = console }) {
  try {
    const send = notify || require("./userNotify").notifyUser;
    const { localizedPair } = require("./messages");
    await send({
      userId,
      type: "BONUS_AWARDED",
      entityType: "bonus",
      entityId: ledgerId || userId,
      titles: localizedPair("bonus.awarded.title", { points }),
      bodies: localizedPair(`bonus.awarded.body.${event}`),
      push: false,
    });
  } catch (e) {
    log.warn?.("[bonus] notice failed", e?.message || String(e));
  }
}

function addMonths(ms, months) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

function monthStartIso(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** True when both accounts have been signed in on the same phone (push registrations). */
async function sharedDevice(supa, a, b) {
  const { data, error } = await supa.from("push_installations").select("user_id,installation_id").in("user_id", [a, b]);
  if (error) throw error;
  const seen = new Map();
  for (const r of data || []) {
    const users = seen.get(r.installation_id) || new Set();
    users.add(r.user_id);
    seen.set(r.installation_id, users);
  }
  return [...seen.values()].some((users) => users.has(a) && users.has(b));
}

async function isSuspended(supa, userId) {
  const { data, error } = await supa.from("account_suspensions").select("user_id").eq("user_id", userId).eq("status", "ACTIVE").limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

/**
 * Awards bonus for one event. Returns { awarded, points, reason }.
 * input = { userId, event, sourceType, sourceId, reportId, counterpartUserId, caseReportId }
 */
async function award(input, { supa, now = Date.now(), env = process.env, log = console, notify } = {}) {
  const { userId, event, sourceType = null, sourceId = null, reportId = null, counterpartUserId = null, caseReportId = null } = input;
  const done = (awarded, points, reason) => {
    log.log?.(`[bonus] ${event} ${awarded ? `+${points}` : `skipped ${reason}`}`);
    return { awarded, points, reason };
  };
  if (!bonusEnabled(env)) return done(false, 0, "DISABLED");
  if (!POINTS[event]) return done(false, 0, "UNKNOWN_EVENT");
  if (!userId) return done(false, 0, "NO_USER");
  if (counterpartUserId && counterpartUserId === userId) return done(false, 0, "SAME_ACCOUNT");

  const { data: au, error: auErr } = await supa.auth.admin.getUserById(userId);
  if (auErr) throw auErr;
  if (!au?.user || au.user.is_anonymous) return done(false, 0, "NO_ACCOUNT");
  if (await isSuspended(supa, userId)) return done(false, 0, "SUSPENDED");
  if (counterpartUserId && (await sharedDevice(supa, userId, counterpartUserId))) return done(false, 0, "SHARED_DEVICE");

  if (counterpartUserId && PAIR_EVENTS.has(event)) {
    const since = new Date(now - PAIR_DAYS * DAY).toISOString();
    const { data, error } = await supa.from("helper_bonus_ledger").select("id")
      .eq("user_id", userId).eq("counterpart_user_id", counterpartUserId).eq("event_type", event)
      .neq("status", "REVOKED").gte("created_at", since).limit(1);
    if (error) throw error;
    if ((data || []).length) return done(false, 0, "PAIR_RECENT");
  }

  if (caseReportId && CASE_AGE_EVENTS.has(event)) {
    const { data, error } = await supa.from("reports").select("created_at").eq("id", caseReportId).maybeSingle();
    if (error) throw error;
    if (data?.created_at && now - Date.parse(data.created_at) < CASE_MIN_AGE_MS) return done(false, 0, "CASE_TOO_NEW");
  }

  const { data: month, error: mErr } = await supa.from("helper_bonus_ledger").select("event_type,points")
    .eq("user_id", userId).gt("points", 0).neq("status", "REVOKED").gte("created_at", monthStartIso(now));
  if (mErr) throw mErr;
  const rows = month || [];
  const cap = EVENT_MONTHLY_CAPS[event];
  if (cap && rows.filter((r) => r.event_type === event).length >= cap) return done(false, 0, "EVENT_CAP");
  const used = rows.reduce((s, r) => s + r.points, 0);
  const points = Math.min(POINTS[event], MONTHLY_CAP - used);
  if (points <= 0) return done(false, 0, "MONTHLY_CAP");

  const pending = event === "FOUND_REGISTERED";
  const validFrom = pending ? now + FOUND_HOLD_MS : now;
  const { data: inserted, error } = await supa.from("helper_bonus_ledger").insert({
    user_id: userId,
    event_type: event,
    points,
    remaining: points,
    status: pending ? "PENDING" : "ACTIVE",
    source_type: sourceType,
    source_id: sourceId,
    report_id: reportId,
    counterpart_user_id: counterpartUserId,
    valid_from: new Date(validFrom).toISOString(),
    expires_at: new Date(addMonths(validFrom, VALID_MONTHS)).toISOString(),
  }).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return done(false, 0, "ALREADY_AWARDED");
    throw error;
  }
  // T1.9AX: tell the helper now; a pending find is told when it turns active (activatePending).
  if (!pending) await notifyAwarded({ userId, event, points, ledgerId: inserted?.id, notify, log });
  return done(true, points, pending ? "PENDING" : "ACTIVE");
}

/** Same as award, but never throws: bonus must not break the action that triggered it. */
async function awardSafely(input, deps = {}) {
  try {
    return await award(input, deps);
  } catch (e) {
    (deps.log || console).warn?.("[bonus] award failed", input?.event, e?.message || String(e));
    return { awarded: false, points: 0, reason: "ERROR" };
  }
}

/** Turns pending finds into bonus after 24 hours, or revokes them if the case is gone. */
async function activatePending({ supa, now = Date.now(), log = console, notify } = {}) {
  const { data, error } = await supa.from("helper_bonus_ledger").select("id,user_id,report_id,event_type,points")
    .eq("status", "PENDING").lte("valid_from", new Date(now).toISOString()).limit(500);
  if (error) throw error;
  let activated = 0;
  let revoked = 0;
  for (const row of data || []) {
    let ok = true;
    let reason = null;
    if (row.report_id) {
      const r = await supa.from("reports").select("id,deleted_at").eq("id", row.report_id).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || r.data.deleted_at) { ok = false; reason = "REPORT_DELETED"; }
    }
    if (ok && (await isSuspended(supa, row.user_id))) { ok = false; reason = "SUSPENDED"; }
    const patch = ok ? { status: "ACTIVE", updated_at: new Date(now).toISOString() } : { status: "REVOKED", remaining: 0, reason, updated_at: new Date(now).toISOString() };
    const u = await supa.from("helper_bonus_ledger").update(patch).eq("id", row.id).eq("status", "PENDING");
    if (u.error) throw u.error;
    if (ok) {
      activated += 1;
      await notifyAwarded({ userId: row.user_id, event: row.event_type, points: row.points, ledgerId: row.id, notify, log });
    } else revoked += 1;
  }
  if (activated || revoked) log.log?.(`[bonus] pending: ${activated} activated, ${revoked} revoked`);
  return { activated, revoked };
}

/** What the user sees about their own bonus. Never includes other people or their cases. */
async function bonusSummary({ supa, userId, now = Date.now() }) {
  const { data, error } = await supa.from("helper_bonus_ledger")
    .select("event_type,points,remaining,status,valid_from,expires_at,created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  const rows = data || [];
  const live = (r) => r.status === "ACTIVE" && r.points > 0 && Date.parse(r.valid_from) <= now && (!r.expires_at || Date.parse(r.expires_at) > now);
  const balance = rows.filter(live).reduce((s, r) => s + r.remaining, 0);
  const pending = rows.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.points, 0);
  const returns = rows.filter((r) => r.event_type === "RETURN_CONFIRMED" && r.status === "ACTIVE").length;
  const soon = rows.filter((r) => live(r) && r.remaining > 0).sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at))[0];
  return {
    enabled: bonusEnabled(),
    balance,
    pending,
    returns,
    level: helperLevel(returns),
    stars: helperStars(returns),
    next: nextStep(returns),
    nextExpiry: soon ? { points: soon.remaining, at: soon.expires_at } : null,
    history: rows.slice(0, 50).map((r) => ({ event: r.event_type, points: r.points, status: r.status, at: r.created_at, validFrom: r.valid_from })),
  };
}

/** Helper status for another person (chat header): level and number of returns only. */
async function helperStatus({ supa, userId }) {
  const { count, error } = await supa.from("helper_bonus_ledger").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("event_type", "RETURN_CONFIRMED").eq("status", "ACTIVE");
  if (error) throw error;
  const returns = count || 0;
  return { returns, level: helperLevel(returns), stars: helperStars(returns) };
}

function canRedeem(accountCreatedAt, now = Date.now()) {
  return !!accountCreatedAt && now - Date.parse(accountCreatedAt) >= REDEEM_MIN_ACCOUNT_DAYS * DAY;
}

function scheduleBonusMaintenance({ supa, log = console, everyMs = 60 * 60 * 1000 } = {}) {
  const run = () => activatePending({ supa, log }).catch((e) => log.warn?.("[bonus] maintenance failed", e?.message || String(e)));
  const t = setInterval(run, everyMs);
  t.unref?.();
  return t;
}

module.exports = {
  POINTS, MONTHLY_CAP, EVENT_MONTHLY_CAPS, PAIR_DAYS, VALID_MONTHS, REDEEM_MIN_ACCOUNT_DAYS,
  bonusEnabled, helperLevel, helperStars, nextStep, award, awardSafely, activatePending, bonusSummary, helperStatus,
  canRedeem, sharedDevice, scheduleBonusMaintenance,
};
