// scripts/test-t1-9as.js
// T1.9AS: bonus for helpers — amounts, monthly caps, anti-cheat rules, pending finds and hooks.
//   node .\scripts\test-t1-9as.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

// Small in-memory stand-in for the Supabase client: enough filters for helperBonus.js.
function fakeDb(seed = {}) {
  const tables = { helper_bonus_ledger: [], push_installations: [], account_suspensions: [], reports: [], ...seed.tables };
  const users = seed.users || {};
  let nextId = 1;
  const from = (table) => {
    const st = { op: "select", filters: [], patch: null, row: null, limit: null, head: false, count: false };
    const match = (r) => st.filters.every(([op, c, v]) =>
      op === "eq" ? r[c] === v : op === "neq" ? r[c] !== v : op === "in" ? v.includes(r[c]) :
      op === "gte" ? r[c] >= v : op === "gt" ? r[c] > v : op === "lte" ? r[c] <= v : true);
    const run = () => {
      const rows = tables[table] || (tables[table] = []);
      if (st.op === "insert") {
        const r = { id: `id${nextId++}`, created_at: new Date(seed.now || Date.now()).toISOString(), ...st.row };
        if (table === "helper_bonus_ledger" && r.source_id && rows.some((x) => x.user_id === r.user_id && x.event_type === r.event_type && x.source_id === r.source_id))
          return { data: null, error: { code: "23505", message: "duplicate" } };
        rows.push(r);
        return { data: r, error: null };
      }
      const hits = rows.filter(match);
      if (st.op === "update") { hits.forEach((r) => Object.assign(r, st.patch)); return { data: hits, error: null }; }
      const out = st.limit ? hits.slice(0, st.limit) : hits;
      return { data: st.head ? null : out, count: hits.length, error: null };
    };
    const api = {
      select(_c, o) { if (o?.head) st.head = true; return api; },
      insert(row) { st.op = "insert"; st.row = row; return api; },
      update(p) { st.op = "update"; st.patch = p; return api; },
      eq(c, v) { st.filters.push(["eq", c, v]); return api; },
      neq(c, v) { st.filters.push(["neq", c, v]); return api; },
      in(c, v) { st.filters.push(["in", c, v]); return api; },
      gte(c, v) { st.filters.push(["gte", c, v]); return api; },
      gt(c, v) { st.filters.push(["gt", c, v]); return api; },
      lte(c, v) { st.filters.push(["lte", c, v]); return api; },
      order() { return api; },
      limit(k) { st.limit = k; return api; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data || [])[0] || null, error: r.error }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  const auth = { admin: { getUserById: async (id) => ({ data: { user: users[id] || null }, error: null }) } };
  return { tables, from, auth };
}

const ON = { HELPER_BONUS_ENABLED: "true" };
const quiet = { log() {}, warn() {} };
const now = Date.parse("2026-11-18T12:00:00Z");
const users = { kari: { id: "kari", is_anonymous: false }, ola: { id: "ola", is_anonymous: false }, guest: { id: "guest", is_anonymous: true }, per: { id: "per", is_anonymous: false } };

(async () => {
  const b = require(path.join(root, "server/lib/helperBonus.js"));
  eq(b.POINTS, { FOUND_REGISTERED: 1, SIGHTING_USEFUL: 1, MATCH_CONFIRMED: 3, SIGHTING_RESOLVED: 5, RETURN_CONFIRMED: 15 }, "agreed amounts");
  eq([b.helperLevel(0), b.helperLevel(1), b.helperLevel(5), b.helperLevel(15)], [null, "HELPER", "SUPER_HELPER", "MASTER_HELPER"], "levels from first return");

  // Off by default.
  let db = fakeDb({ users, now });
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "m1", counterpartUserId: "ola" }, { supa: db, now, env: {}, log: quiet })).reason, "DISABLED", "nothing awarded until switched on");
  eq(db.tables.helper_bonus_ledger.length, 0, "no rows while off");

  // Kari's example: find (pending), match confirmed, return confirmed.
  db = fakeDb({ users, now, tables: { reports: [{ id: "lost1", created_at: new Date(now - 5 * 3600e3).toISOString() }] } });
  const d = { supa: db, now, env: ON, log: quiet };
  eq((await b.award({ userId: "kari", event: "FOUND_REGISTERED", sourceId: "found1", reportId: "found1" }, d)).reason, "PENDING", "find waits 24 h");
  eq((await b.award({ userId: "kari", event: "MATCH_CONFIRMED", sourceId: "m1", counterpartUserId: "ola" }, d)).points, 3, "match confirmed 3");
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "m1", counterpartUserId: "ola", caseReportId: "lost1" }, d)).points, 15, "return 15");
  let s = await b.bonusSummary({ supa: db, userId: "kari", now });
  // T1.9AY: a return also waits (7 days), so only the match counts at once.
  eq([s.balance, s.pending, s.returns, s.level], [3, 16, 0, null], "balance excludes waiting find and return");
  ok(s.history.every((h) => !("counterpart_user_id" in h) && !("report_id" in h)), "history shows no other people or cases");
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "m1", counterpartUserId: "ola", caseReportId: "lost1" }, d)).reason, "PAIR_RECENT", "same pair only once (T1.9AY: ever)");

  // Pending find becomes valid after 24 h.
  db.tables.reports.push({ id: "found1", deleted_at: null });
  eq(await b.activatePending({ supa: db, now: now + 25 * 3600e3, log: quiet }), { activated: 1, revoked: 0 }, "find activated");
  s = await b.bonusSummary({ supa: db, userId: "kari", now: now + 25 * 3600e3 });
  eq(s.balance, 4, "find active after 24 h, return still waiting");
  eq(await b.activatePending({ supa: db, now: now + 8 * 24 * 3600e3, log: quiet }), { activated: 1, revoked: 0 }, "return activated after 7 days");
  s = await b.bonusSummary({ supa: db, userId: "kari", now: now + 8 * 24 * 3600e3 });
  eq([s.balance, s.returns, s.level], [19, 1, "HELPER"], "Kari has 19 and is a Helper");

  // A find whose case is deleted is revoked.
  const db2 = fakeDb({ users, now, tables: { reports: [{ id: "f9", deleted_at: new Date(now).toISOString() }] } });
  await b.award({ userId: "kari", event: "FOUND_REGISTERED", sourceId: "f9", reportId: "f9" }, { supa: db2, now, env: ON, log: quiet });
  eq(await b.activatePending({ supa: db2, now: now + 25 * 3600e3, log: quiet }), { activated: 0, revoked: 1 }, "deleted case revoked");

  // Anti-cheat.
  const dbx = fakeDb({ users, now, tables: { push_installations: [{ user_id: "per", installation_id: "phone1" }, { user_id: "ola", installation_id: "phone1" }], account_suspensions: [{ user_id: "ola", status: "ACTIVE" }], reports: [{ id: "new", created_at: new Date(now - 30 * 60e3).toISOString() }] } });
  const dx = { supa: dbx, now, env: ON, log: quiet };
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "x1", counterpartUserId: "kari" }, dx)).reason, "SAME_ACCOUNT", "own case");
  eq((await b.award({ userId: "per", event: "RETURN_CONFIRMED", sourceId: "x2", counterpartUserId: "ola" }, dx)).reason, "SHARED_DEVICE", "same phone");
  eq((await b.award({ userId: "ola", event: "MATCH_CONFIRMED", sourceId: "x3", counterpartUserId: "kari" }, dx)).reason, "SUSPENDED", "suspended account");
  eq((await b.award({ userId: "guest", event: "FOUND_REGISTERED", sourceId: "x4" }, dx)).reason, "NO_ACCOUNT", "guests get no bonus");
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "x5", counterpartUserId: "per", caseReportId: "new" }, dx)).reason, "CASE_TOO_NEW", "case under 2 hours");

  // Caps: 3 finds a month, 30 bonus a month.
  const dbc = fakeDb({ users, now });
  const dc = { supa: dbc, now, env: ON, log: quiet };
  for (const k of [1, 2, 3]) await b.award({ userId: "kari", event: "FOUND_REGISTERED", sourceId: `f${k}` }, dc);
  eq((await b.award({ userId: "kari", event: "FOUND_REGISTERED", sourceId: "f4" }, dc)).reason, "EVENT_CAP", "fourth find this month");
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "r1", counterpartUserId: "ola" }, dc)).points, 15, "15 within cap");
  eq((await b.award({ userId: "kari", event: "RETURN_CONFIRMED", sourceId: "r2", counterpartUserId: "per" }, dc)).points, 12, "trimmed to the 30 cap");
  eq((await b.award({ userId: "kari", event: "MATCH_CONFIRMED", sourceId: "r3", counterpartUserId: "ola" }, dc)).reason, "MONTHLY_CAP", "nothing past 30");
  eq((await b.award({ userId: "kari", event: "FOUND_REGISTERED", sourceId: "f1" }, { ...dc, now: now + 40 * 86400e3 })).reason, "ALREADY_AWARDED", "same source once");

  // Errors never break the caller.
  const broken = { from() { throw new Error("db down"); }, auth: { admin: { getUserById: async () => ({ data: { user: users.kari }, error: null }) } } };
  eq((await b.awardSafely({ userId: "kari", event: "MATCH_CONFIRMED", sourceId: "z" }, { supa: broken, now, env: ON, log: quiet })).reason, "ERROR", "awardSafely swallows errors");

  ok(b.canRedeem(new Date(now - 15 * 86400e3).toISOString(), now) && !b.canRedeem(new Date(now - 3 * 86400e3).toISOString(), now), "redeem after 14 days");

  // Wiring.
  const mig = read("supabase/migrations/20261118100000_t1_9as_helper_bonus.sql");
  ok(/enable row level security/.test(mig) && /for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/.test(mig), "users read only their own rows");
  ok(/revoke insert, update, delete on public\.helper_bonus_ledger from anon, authenticated/.test(mig), "app cannot write bonus");
  ok(/raise exception 'BONUS_INSUFFICIENT'/.test(mig) && /grant execute on function public\.helper_bonus_spend\(uuid, integer, uuid, text\) to service_role/.test(mig), "spending is atomic and server-only");
  ok(/on delete cascade/.test(mig), "deleted account takes its bonus");
  ok(/event: "FOUND_REGISTERED"/.test(read("server/routes/reports.js")) && /!isAnonymousUser\(user\)/.test(read("server/routes/reports.js")), "hook: registered find");
  ok(/event: "MATCH_CONFIRMED"/.test(read("server/routes/matches.js")), "hook: match confirmed");
  ok(/event:"SIGHTING_USEFUL"/.test(read("server/routes/observations.js")), "hook: useful sighting");
  const res = read("server/routes/resolutions.js");
  // T1.9BK: a find from an area alert that is given back is a return, so the event is chosen there.
  ok(/event:"RETURN_CONFIRMED"/.test(res) && /"SIGHTING_RESOLVED"/.test(res), "hooks: both confirmed");
  ok(/app\.use\("\/bonus",bonusRoutes\)/.test(read("server/index.js")) && /scheduleBonusMaintenance/.test(read("server/index.js")), "route and hourly check mounted");
  ok(/\["helper_bonus_ledger", "user_id", \["counterpart_user_id"/.test(read("server/lib/privacyExport.js")), "bonus in access export without other people");

  console.log(`OK: T1.9AS helper bonus passed (${n} assertions).`);
})().catch((e) => { console.error(e); process.exit(1); });
