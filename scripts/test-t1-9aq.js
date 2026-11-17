// scripts/test-t1-9aq.js
// T1.9AQ: account deletion shared by the app and the admin script for requests by e-mail
// (lostorfound.app/slett-konto).
//   node .\scripts\test-t1-9aq.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

function fakeSupa({ reports = [], authError = null, users = [] } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, op: "select", filters: [] };
    const api = {
      select() { return api; },
      delete() { q.op = "delete"; return api; },
      eq(c, v) { q.filters.push(["eq", c, v]); return api; },
      is(c, v) { q.filters.push(["is", c, v]); return api; },
      then(res, rej) {
        calls.push(q);
        return Promise.resolve({ data: table === "reports" ? reports : null, error: null }).then(res, rej);
      },
    };
    return api;
  };
  const auth = { admin: {
    deleteUser: async (id) => { calls.push({ authDelete: id }); return { error: authError }; },
    getUserById: async (id) => ({ data: { user: users.find((u) => u.id === id) || null }, error: null }),
    listUsers: async () => ({ data: { users }, error: null }),
  } };
  return { calls, from, auth };
}
const quiet = { log() {}, warn() {}, error() {} };

(async () => {
  const lib = require(path.join(root, "server/lib/accountDeletion.js"));

  // Happy path: every case, then leftovers, then the sign-in.
  const deleted = [];
  let supa = fakeSupa({ reports: [{ id: "r1" }, { id: "r2" }] });
  const out = await lib.deleteAccount("u1", { supa, deleteOwnedReport: async (id) => { deleted.push(id); return { status: 200, body: {} }; }, log: quiet });
  eq(out, { deletedReports: 2 }, "both cases deleted");
  eq(deleted, ["r1", "r2"], "each case through the shared case deletion");
  ok(supa.calls.some((c) => c.table === "reports" && c.filters.some((f) => f[0] === "is" && f[1] === "deleted_at")), "only cases not already deleted");
  eq(supa.calls.filter((c) => c.op === "delete").map((c) => c.table), ["notifications", "report_creation_events"], "leftover rows removed");
  const authIndex = supa.calls.findIndex((c) => c.authDelete === "u1");
  ok(authIndex === supa.calls.length - 1, "sign-in deleted last");

  // A failing case stops everything before the sign-in.
  supa = fakeSupa({ reports: [{ id: "r1" }] });
  await assert.rejects(lib.deleteAccount("u1", { supa, deleteOwnedReport: async () => ({ status: 500, body: { error: "X" } }), log: quiet }), /ACCOUNT_DELETE_FAILED/); n++;
  ok(!supa.calls.some((c) => c.authDelete), "sign-in kept when a case fails, so a retry is safe");

  // A case already gone (404) does not block.
  supa = fakeSupa({ reports: [{ id: "r1" }] });
  eq((await lib.deleteAccount("u1", { supa, deleteOwnedReport: async () => ({ status: 404, body: {} }), log: quiet })).deletedReports, 1, "404 case counts as gone");

  // Sign-in failure is reported.
  supa = fakeSupa({ authError: { message: "nope" } });
  await assert.rejects(lib.deleteAccount("u1", { supa, deleteOwnedReport: async () => ({ status: 200 }), log: quiet }), /ACCOUNT_DELETE_FAILED/); n++;

  // Finding the account.
  supa = fakeSupa({ users: [{ id: "u1", email: "Kari@Example.no" }] });
  eq((await lib.findAccount(supa, { email: " kari@example.no " }))?.id, "u1", "e-mail match ignores case and spaces");
  eq(await lib.findAccount(supa, { email: "" }), null, "empty e-mail finds nobody");

  // Route and scripts use the same code.
  const route = read("server/routes/account.js");
  ok(/require\("\.\.\/lib\/accountDeletion"\)/.test(route) && !/auth\.admin\.deleteUser/.test(route), "app route has no own copy of the deletion");
  const script = read("server/scripts/delete-account.js");
  ok(/if \(!confirm\) \{[\s\S]*DRY_RUN/.test(script), "dry run unless --confirm");
  ok(/deleteAccount\(user\.id, \{ supa, deleteOwnedReport/.test(script), "script uses the shared deletion");
  ok(/action: "DELETE_USER_ACCOUNT"/.test(script), "deletion is logged in the admin log");
  ok(!/metadata: \{[^}]*email/.test(script), "the log keeps no e-mail address");
  ok(/require\("\.\.\/lib\/accountDeletion"\)/.test(read("server/scripts/privacy-export.js")), "export finds accounts the same way");

  console.log(`OK: T1.9AQ shared account deletion and admin script passed (${n} assertions).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
