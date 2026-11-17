// scripts/test-t1-9ap.js
// T1.9AP: the nightly retention run also removes photo-suggestion log rows (image_analyses)
// older than 12 months, as privacy policy v4 promises.
//   node .\scripts\test-t1-9ap.js
"use strict";
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

// Records each query: table, operation, options and filters.
function fakeSupa({ count = 0, error = null, candidates = [] } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, op: "select", options: null, filters: [] };
    const api = {
      select(_cols, options) { q.op = "select"; q.options = options || null; return api; },
      delete(options) { q.op = "delete"; q.options = options || null; return api; },
      update() { q.op = "update"; return api; },
      insert() { q.op = "insert"; calls.push(q); return Promise.resolve({ error: null }); },
      eq(c, v) { q.filters.push(["eq", c, v]); return api; },
      lt(c, v) { q.filters.push(["lt", c, v]); return api; },
      then(res, rej) {
        calls.push(q);
        const fail = table === "image_analyses" ? error : null;
        return Promise.resolve({ data: null, count: fail ? null : count, error: fail }).then(res, rej);
      },
    };
    return api;
  };
  return { calls, from, rpc: () => Promise.resolve({ data: candidates, error: null }) };
}
const quiet = { info() {}, error() {} };

(async () => {
  const ret = require(path.join(root, "server/lib/retentionPurge.js"));
  const now = Date.parse("2026-11-17T03:40:00Z");

  eq(ret.cutoffIso(12, now), "2025-11-17T03:40:00.000Z", "cut-off is 12 months back");

  // Report mode: counts, never deletes.
  let supa = fakeSupa({ count: 7 });
  eq(await ret.purgeImageAnalyses({ mode: "report", supa, log: quiet, now }), 7, "report mode returns the count");
  let q = supa.calls.find((c) => c.table === "image_analyses");
  eq([q.op, q.options], ["select", { count: "exact", head: true }], "report mode only counts");
  eq(q.filters, [["lt", "created_at", "2025-11-17T03:40:00.000Z"]], "only rows older than the cut-off");

  // Delete mode: removes the old rows only.
  supa = fakeSupa({ count: 4 });
  eq(await ret.purgeImageAnalyses({ mode: "delete", supa, log: quiet, now }), 4, "delete mode returns the number removed");
  q = supa.calls.find((c) => c.table === "image_analyses");
  eq([q.op, q.options], ["delete", { count: "exact" }], "delete mode deletes");
  eq(q.filters, [["lt", "created_at", "2025-11-17T03:40:00.000Z"]], "a delete always has the age filter");

  // Off: nothing.
  supa = fakeSupa({ count: 9 });
  eq(await ret.purgeImageAnalyses({ mode: "off", supa, log: quiet, now }), 0, "off does nothing");
  eq(supa.calls.length, 0, "off touches no table");

  // Part of the nightly run.
  supa = fakeSupa({ count: 3 });
  let s = await ret.runRetention({ mode: "delete", deps: { supa, deleteOwnedReport: async () => ({ status: 200, body: {} }), log: quiet } });
  eq([s.imageAnalyses, s.failed], [3, 0], "nightly run removes old log rows");

  // A failing log purge is counted and does not stop the case purge.
  const deleted = [];
  supa = fakeSupa({ error: { message: "boom" }, candidates: [{ report_id: "a", user_id: "u1", last_activity: "2025-01-01T00:00:00Z" }] });
  s = await ret.runRetention({ mode: "delete", deps: { supa, deleteOwnedReport: async (id) => { deleted.push(id); return { status: 200, body: {} }; }, log: quiet } });
  eq([s.failed, s.deleted, deleted], [1, 1, ["a"]], "case purge still runs when the log purge fails");

  ok(/T1\.9AP/.test(require("fs").readFileSync(path.join(root, "server/lib/retentionPurge.js"), "utf8")), "rule documented in the job");

  console.log(`OK: T1.9AP photo-suggestion log retention passed (${n} assertions).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
