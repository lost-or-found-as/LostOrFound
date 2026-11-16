// scripts/test-t1-9ao.js
// T1.9AO: deletion of old cases (retention), data export for access requests, and the admin
// access log.
//   node .\scripts\test-t1-9ao.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

// A tiny stand-in for the Supabase client: records calls, answers from fixtures.
function fakeSupa(fixtures = {}) {
  const calls = [];
  const builder = (table) => {
    const q = { table, filters: [], op: "select", payload: null };
    const api = {
      select() { return api; },
      limit() { return api; },
      eq(c, v) { q.filters.push(["eq", c, v]); return api; },
      in(c, v) { q.filters.push(["in", c, v]); return api; },
      update(p) { q.op = "update"; q.payload = p; return api; },
      delete() { q.op = "delete"; return api; },
      insert(p) { q.op = "insert"; q.payload = p; calls.push(q); return Promise.resolve({ error: null }); },
      then(res, rej) {
        calls.push(q);
        const data = q.op === "select" ? (fixtures[table] || []) : null;
        const error = fixtures[`${table}:error`] || null;
        return Promise.resolve({ data, error }).then(res, rej);
      },
    };
    return api;
  };
  return {
    calls,
    from: (t) => builder(t),
    rpc: (name, args) => { calls.push({ rpc: name, args }); return Promise.resolve({ data: fixtures[`rpc:${name}`] || [], error: null }); },
  };
}
const quiet = { info() {}, error() {} };

(async () => {
  // 1. Retention rule in the database.
  const sql = read("supabase/migrations/20261116100000_t1_9ao_retention_candidates.sql");
  ok(/r\.deleted_at is null[\s\S]*r\.purged_at is null[\s\S]*r\.legal_hold_at is null/.test(sql), "deleted, purged and held cases are skipped");
  ok(/r\.status in \('CLOSED', 'EXPIRED', 'ARCHIVED'\) or r\.closed_at is not null/.test(sql), "only closed or expired cases");
  ok(/from public\.report_entitlements e[\s\S]*'ACTIVE'/.test(sql) && /from public\.long_term_watches w[\s\S]*'ACTIVE'/.test(sql), "nothing with a running paid service");
  ok(/greatest\(coalesce\(p_months, 12\), 6\)/.test(sql), "never fewer than 6 months");
  ok(/area_alert_observations[\s\S]*report_owner_sightings/.test(sql), "sightings and tips count as activity");
  ok(/grant execute on function public\.report_retention_candidates\(integer, integer\) to service_role/.test(sql), "server only");

  // 2. The job.
  const ret = require(path.join(root, "server/lib/retentionPurge.js"));
  eq([ret.retentionMode({}), ret.retentionMode({ RETENTION_PURGE_MODE: "DELETE" }), ret.retentionMode({ RETENTION_PURGE_MODE: "off" }), ret.retentionMode({ RETENTION_PURGE_MODE: "x" })], ["report", "delete", "off", "report"], "mode, report by default");
  eq(ret.msUntilNextRun(Date.parse("2026-11-16T03:00:00Z")), 40 * 60000, "runs at 03:40 UTC");
  eq(ret.msUntilNextRun(Date.parse("2026-11-16T04:00:00Z")), (23 * 60 + 40) * 60000, "next night when 03:40 has passed");
  const rows = [
    { report_id: "a", user_id: "u1", report_type: "LOST", status: "EXPIRED", has_orders: false, last_activity: "2025-01-01T00:00:00Z" },
    { report_id: "b", user_id: "u2", report_type: "LOST", status: "CLOSED", has_orders: true, last_activity: "2025-02-01T00:00:00Z" },
  ];
  const deleted = [];
  const fakeDelete = async (id) => { deleted.push(id); return { status: 200, body: { deletionMode: id === "b" ? "SOFT" : undefined } }; };

  let supa = fakeSupa({ "rpc:report_retention_candidates": rows });
  let s = await ret.runRetention({ mode: "report", deps: { supa, deleteOwnedReport: fakeDelete, log: quiet } });
  eq([s.candidates, s.deleted, deleted.length], [2, 0, 0], "report mode deletes nothing");

  supa = fakeSupa({ "rpc:report_retention_candidates": rows });
  s = await ret.runRetention({ mode: "delete", deps: { supa, deleteOwnedReport: fakeDelete, log: quiet } });
  eq([s.deleted, s.scrubbed, s.failed], [1, 1, 0], "one deleted, one emptied (it has orders)");
  const scrub = supa.calls.find((c) => c.table === "reports" && c.op === "update");
  ok(scrub && scrub.payload.description === null && scrub.payload.pet_name === null && scrub.payload.share_token === null && scrub.payload.purged_at, "soft-deleted case loses personal text");
  ok(supa.calls.some((c) => c.table === "report_identifiers" && c.op === "delete"), "private identifiers go");
  eq(supa.calls.filter((c) => c.table === "report_retention_events" && c.op === "insert").map((c) => c.payload.event_type), ["RETENTION_DELETED", "RETENTION_SCRUBBED"], "every deletion is logged");

  supa = fakeSupa({ "rpc:report_retention_candidates": rows });
  s = await ret.runRetention({ mode: "delete", deps: { supa, deleteOwnedReport: async () => ({ status: 500, body: { error: "X" } }), log: quiet } });
  eq(s.failed, 2, "a failed delete is counted, not thrown");
  eq((await ret.runRetention({ mode: "off", deps: { supa: fakeSupa(), deleteOwnedReport: fakeDelete, log: quiet } })).candidates, 0, "off does nothing");

  const reports = read("server/routes/reports.js");
  ok(/deletionMode: "SOFT",[\s\S]{0,40}storageCleanup/.test(reports) && /const storageCleanup = await removeStoredImages\(paths\);[\s\S]{0,200}deletionMode: "SOFT"/.test(reports), "soft delete removes the photos too");
  const index = read("server/index.js");
  ok(/scheduleRetention\(\{ deps: \{ supa: supaAdmin, deleteOwnedReport/.test(index), "job starts with the server");

  // 3. Data export.
  const exp = require(path.join(root, "server/lib/privacyExport.js"));
  eq(exp.strip({ id: 1, expo_push_token: "x", device_token: "y", platform: "ios" }, ["*token*"]), { id: 1, platform: "ios" }, "push tokens left out");
  supa = fakeSupa({
    reports: [{ id: "r1", user_id: "u1", description: "Svart lommebok" }],
    chat_reports: [{ id: "c1", reporter_id: "u1", reported_user_id: "u9", reason: "SPAM", message_snapshot: "..." }],
    user_blocks: [{ blocker_id: "u1", blocked_id: "u9" }],
    report_images: [{ report_id: "r1", path: "report-images/r1/a.jpg" }],
    "image_analyses:error": { code: "42P01" },
  });
  const out = await exp.buildPrivacyExport(supa, { id: "u1", email: "a@b.no", providers: ["email"] }, new Date("2026-11-16T12:00:00Z"));
  eq(out.account, { id: "u1", email: "a@b.no", created_at: null, last_sign_in_at: null, sign_in_methods: ["email"] }, "account part");
  eq(out.tables.chat_reports, [{ id: "c1", reporter_id: "u1", reason: "SPAM" }], "own reports without the other person or the message");
  eq(out.tables.user_blocks, [{ blocker_id: "u1" }], "own blocks without who");
  ok(supa.calls.some((c) => c.table === "report_images" && c.filters.some((f) => f[0] === "in" && f[2].includes("r1"))), "photos of own cases");
  ok(out.problems.some((p) => p.table === "image_analyses"), "a table that fails is reported, not hidden");
  const tables = exp.USER_TABLES.map((t) => t[0]);
  for (const t of ["reports", "notification_watch_areas", "report_orders", "messages", "report_owner_sightings", "app_feedback", "image_analyses"]) ok(tables.includes(t), `export covers ${t}`);
  const script = read("server/scripts/privacy-export.js");
  ok(/--out must be outside the repository/.test(script), "export file never lands in the repository");
  ok(/action: "EXPORT_USER_DATA"/.test(script), "export is logged");

  // 4. Admin access log.
  const safety = read("server/routes/safety.js");
  for (const action of ["VIEW_CHAT_REPORTS", "RESOLVE_CHAT_REPORT", "SUSPEND_ACCOUNT", "RESTORE_ACCOUNT"]) ok(safety.includes(`"${action}"`), `admin action ${action} logged`);
  ok(/never fails|Never fails/.test(read("server/lib/adminAudit.js")) && /catch \(e\)/.test(read("server/lib/adminAudit.js")), "a failed log line does not stop the admin");

  console.log(`OK: T1.9AO retention, data export and admin access log passed (${n} assertions).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
