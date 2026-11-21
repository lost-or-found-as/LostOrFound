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
// T1.9AY: the same two accounts get bonus for each kind of help only once, ever (was 90 days).
const PAIR_DAYS = null;
const CASE_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const CASE_AGE_EVENTS = new Set(["SIGHTING_RESOLVED", "RETURN_CONFIRMED"]);
const FOUND_HOLD_MS = DAY;
// T1.9AY: how long bonus waits before it can be used. A return or a solving sighting waits a week,
// so admin can withdraw it, and it is withdrawn automatically when the case is hidden.
const HOLD_MS = Object.freeze({ FOUND_REGISTERED: FOUND_HOLD_MS, RETURN_CONFIRMED: 7 * DAY, SIGHTING_RESOLVED: 7 * DAY });
// T1.9AY: bonus can pay for extensions and «Synlig i nærheten», never for an area alert (no
// free mass sending with earned bonus).
const BONUS_SPENDABLE = Object.freeze(["REPORT_REACTIVATION", "AREA_VISIBILITY"]);
function canSpendBonusOn(productCode) {
  const code = String(productCode || "").toUpperCase();
  if (code.startsWith("GEO_ALERT")) return false;
  return BONUS_SPENDABLE.some((p) => code === p || code.startsWith(`${p}_`));
}
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

// T1.9BK: test accounts (HELPER_BONUS_TEST_USER_IDS, comma separated). When both people are test
// accounts, the anti-abuse rules that stop one person testing with two accounts are skipped:
// same phone, same pair before, and a case younger than two hours. Caps and holds still apply.
function bonusTestPair(a, b, env = process.env) {
  const ids = new Set(String(env.HELPER_BONUS_TEST_USER_IDS || "").split(",").map((x) => x.trim()).filter(Boolean));
  return !!a && !!b && ids.has(a) && ids.has(b);
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
async function notifyAwarded({ userId, event, points, ledgerId, holdDays = 0, notify, log = console }) {
  try {
    const send = notify || require("./userNotify").notifyUser;
    const { localizedPair } = require("./messages");
    await send({
      userId,
      type: "BONUS_AWARDED",
      entityType: "bonus",
      entityId: ledgerId || userId,
      titles: localizedPair("bonus.awarded.title", { points }),
      bodies: Object.fromEntries(
        Object.entries(localizedPair(`bonus.awarded.body.${event}`)).map(([lang, text]) => [
          lang,
          holdDays > 0 ? `${text} ${localizedPair("bonus.awarded.pendingDays", { days: holdDays })[lang]}` : text,
        ]),
      ),
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
  const testPair = bonusTestPair(userId, counterpartUserId, env);
  if (counterpartUserId && !testPair && (await sharedDevice(supa, userId, counterpartUserId))) return done(false, 0, "SHARED_DEVICE");

  if (counterpartUserId && !testPair && PAIR_EVENTS.has(event)) {
    let q = supa.from("helper_bonus_ledger").select("id")
      .eq("user_id", userId).eq("counterpart_user_id", counterpartUserId).eq("event_type", event)
      .neq("status", "REVOKED");
    if (PAIR_DAYS) q = q.gte("created_at", new Date(now - PAIR_DAYS * DAY).toISOString());
    const { data, error } = await q.limit(1);
    if (error) throw error;
    if ((data || []).length) return done(false, 0, "PAIR_RECENT");
  }

  if (caseReportId && !testPair && CASE_AGE_EVENTS.has(event)) {
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

  const hold = HOLD_MS[event] || 0;
  const pending = hold > 0;
  const validFrom = now + hold;
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
  // T1.9AX/AY: tell the helper now; waiting bonus says when it can be used.
  await notifyAwarded({ userId, event, points, ledgerId: inserted?.id, holdDays: Math.round(hold / DAY), notify, log });
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
      const r = await supa.from("reports").select("id,deleted_at,hidden_at").eq("id", row.report_id).maybeSingle();
      if (r.error) throw r.error;
      // A finder may delete the found case after the return; only a find needs the case to stay.
      if (!r.data || (row.event_type === "FOUND_REGISTERED" && r.data.deleted_at)) { ok = false; reason = "REPORT_DELETED"; }
      else if (r.data.hidden_at) { ok = false; reason = "REPORT_HIDDEN"; }
    }
    if (ok && (await isSuspended(supa, row.user_id))) { ok = false; reason = "SUSPENDED"; }
    const patch = ok ? { status: "ACTIVE", updated_at: new Date(now).toISOString() } : { status: "REVOKED", remaining: 0, reason, updated_at: new Date(now).toISOString() };
    const u = await supa.from("helper_bonus_ledger").update(patch).eq("id", row.id).eq("status", "PENDING");
    if (u.error) throw u.error;
    if (ok) activated += 1; else revoked += 1;
  }
  if (activated || revoked) log.log?.(`[bonus] pending: ${activated} activated, ${revoked} revoked`);
  return { activated, revoked };
}

/** T1.9AY: admin withdraws one bonus row (waiting or active). Returns true when changed. */
async function revokeBonus({ supa, ledgerId, reason = "ADMIN", now = Date.now() }) {
  const { data, error } = await supa.from("helper_bonus_ledger")
    .update({ status: "REVOKED", remaining: 0, reason, updated_at: new Date(now).toISOString() })
    .eq("id", ledgerId).neq("status", "REVOKED").select("id").maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * T1.9AY: accounts whose bonus looks arranged, for admin to check (nothing is changed here).
 *   RECIPROCAL  two accounts have given each other bonus (friends taking turns)
 *   CLUSTER     most of an account's bonus comes from two or fewer other accounts (at least 3 rows)
 *   MANY_RETURNS more than 3 confirmed returns in 30 days
 */
async function bonusFlags({ supa, now = Date.now(), days = 90 }) {
  const { data, error } = await supa.from("helper_bonus_ledger")
    .select("id,user_id,counterpart_user_id,event_type,points,status,created_at")
    .not("counterpart_user_id", "is", null).neq("status", "REVOKED")
    .gte("created_at", new Date(now - days * DAY).toISOString()).limit(5000);
  if (error) throw error;
  const rows = data || [];
  const pairs = new Set(rows.map((r) => `${r.user_id}>${r.counterpart_user_id}`));
  const byUser = new Map();
  for (const r of rows) {
    const list = byUser.get(r.user_id) || [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const flags = [];
  for (const [userId, list] of byUser) {
    const reasons = [];
    const partners = [...new Set(list.map((r) => r.counterpart_user_id))];
    if (partners.some((p) => pairs.has(`${p}>${userId}`))) reasons.push("RECIPROCAL");
    if (list.length >= 3 && partners.length <= 2) reasons.push("CLUSTER");
    const recentReturns = list.filter((r) => r.event_type === "RETURN_CONFIRMED" && now - Date.parse(r.created_at) <= 30 * DAY).length;
    if (recentReturns > 3) reasons.push("MANY_RETURNS");
    if (reasons.length) {
      flags.push({
        userId,
        reasons,
        points: list.reduce((sum, r) => sum + r.points, 0),
        partners: partners.length,
        rows: list.map((r) => ({ id: r.id, event: r.event_type, points: r.points, status: r.status, at: r.created_at, counterpart: r.counterpart_user_id })),
      });
    }
  }
  return flags.sort((a, b) => b.points - a.points);
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
  const pendingRows = rows.filter((r) => r.status === "PENDING");
  const pending = pendingRows.reduce((s, r) => s + r.points, 0);
  // T1.9BK: when waiting bonus can first be used, and returns that wait (shown on the level card).
  const nextPendingAt = pendingRows.map((r) => r.valid_from).filter(Boolean).sort()[0] || null;
  const pendingReturns = pendingRows.filter((r) => r.event_type === "RETURN_CONFIRMED").length;
  const returns = rows.filter((r) => r.event_type === "RETURN_CONFIRMED" && r.status === "ACTIVE").length;
  const soon = rows.filter((r) => live(r) && r.remaining > 0).sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at))[0];
  return {
    enabled: bonusEnabled(),
    balance,
    pending,
    nextPendingAt,
    pendingReturns,
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
  HOLD_MS, BONUS_SPENDABLE, canSpendBonusOn, revokeBonus, bonusFlags, bonusTestPair,
  bonusEnabled, helperLevel, helperStars, nextStep, award, awardSafely, activatePending, bonusSummary, helperStatus,
  canRedeem, sharedDevice, scheduleBonusMaintenance,
};
