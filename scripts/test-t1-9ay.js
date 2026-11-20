// scripts/test-t1-9ay.js
// T1.9AY: public text checks, verified e-mail for alerts, reporting and hiding a case, stricter bonus.
// T1.9AZ: photo check (held photos only for the owner).
//   node .\scripts\test-t1-9ay.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const cs = require(path.join(root, "server/lib/contentSafety.js"));
const cr = require(path.join(root, "server/lib/contentReports.js"));
const im = require(path.join(root, "server/lib/imageModeration.js"));
const bonus = require(path.join(root, "server/lib/helperBonus.js"));
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// Tiny fake for content reports.
function fakeDb(state) {
  const make = (table) => {
    const st = { filters: [], op: "select" };
    const rows = () => (state[table] ||= []);
    const api = {
      select() { return api; },
      eq(k, v) { st.filters.push((r) => r[k] === v); return api; },
      is(k, v) { st.filters.push((r) => (r[k] ?? null) === v); return api; },
      insert(row) { st.op = "insert"; st.row = row; return api; },
      update(p) { st.op = "update"; st.patch = p; return api; },
      maybeSingle() { st.single = true; return api; },
      then(resolve) {
        const hit = rows().filter((r) => st.filters.every((f) => f(r)));
        if (st.op === "insert") {
          if (table === "content_reports" && rows().some((r) => r.report_id === st.row.report_id && r.reporter_key === st.row.reporter_key))
            return resolve({ error: { code: "23505" } });
          rows().push({ ...st.row, handled_at: null });
          return resolve({ error: null });
        }
        if (st.op === "update") { hit.forEach((r) => Object.assign(r, st.patch)); return resolve({ data: st.single ? hit[0] || null : hit, error: null }); }
        return resolve({ data: st.single ? hit[0] || null : hit, error: null });
      },
    };
    return api;
  };
  return { from: make, state };
}

async function main() {
  // 1. Public text.
  eq(cs.ruleProblems("Ring 412 34 567"), ["PHONE"], "phone number");
  eq(cs.ruleProblems("+47 41234567"), ["PHONE"], "phone with country code");
  eq(cs.ruleProblems("kari@example.no"), ["EMAIL"], "e-mail");
  eq(cs.ruleProblems("Mistet 19.11.2026 kl. 14 ved Storo"), [], "dates are fine");
  eq(cs.ruleProblems("Svart sekk, 20 l, merket Bergans"), [], "ordinary text is fine");
  eq((await cs.checkPublicText({ description: "Svart katt" }, { env: {} })).ok, true, "ok without the model");
  eq((await cs.checkPublicText({ description: "ring 99887766" }, { env: {} })).reasons, ["PHONE"], "rule problem without the model");
  const modelSays = (text) => async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text }] }) });
  const on = { IMAGE_ANALYSIS_ENABLED: "true", ANTHROPIC_API_KEY: "x" };
  eq((await cs.checkPublicText({ description: "Ola Nordmann er en tyv" }, { env: on, fetchImpl: modelSays('{"ok":false,"reasons":["NAMED_PERSON","HARASSMENT"]}') })).reasons, ["NAMED_PERSON", "HARASSMENT"], "model finds named person and harassment");
  eq((await cs.checkPublicText({ description: "Grå katt" }, { env: on, fetchImpl: async () => { throw new Error("down"); }, log: { warn() {} } })).ok, true, "a model failure never blocks");
  ok(cs.isVerifiedUser({ email_confirmed_at: "2026-01-01" }) && cs.isVerifiedUser({ app_metadata: { provider: "apple" } }), "confirmed e-mail or Apple/Google");
  ok(!cs.isVerifiedUser({ email: "x@y.no" }) && !cs.isVerifiedUser({ is_anonymous: true, email_confirmed_at: "x" }) && !cs.isVerifiedUser(null), "unconfirmed or guest is not");

  const commerce = read("server/routes/reportCommerce.js");
  ok(/if \(productCode === "GEO_ALERT" \|\| productCode === VISIBILITY_REQUEST_CODE\) \{\s*if \(!isVerifiedUser\(req\.user\)\) return res\.status\(403\)\.json\(\{ error: "EMAIL_NOT_VERIFIED" \}\);/.test(commerce), "alerts need a confirmed account");
  ok(/PUBLIC_TEXT_NOT_ALLOWED/.test(commerce) && /REPORT_HIDDEN/.test(commerce), "alerts need clean text and a visible case");
  const reports = read("server/routes/reports.js");
  ok(/if \(report\.hidden_at\) return res\.status\(403\)\.json\(\{ error: "REPORT_HIDDEN" \}\);\s*const text = await checkPublicText\(report\);/.test(reports), "share checks hidden and text");
  ok(/existing\.share_token && \["description", "location_label", "pet_name", "subcategory_custom"\]/.test(reports), "editing a shared case checks the text");

  // 2. Reporting and hiding.
  eq(cr.normalizeContentReport({ reason: "person" }).reason, "PERSON", "reason upper-cased");
  eq(cr.normalizeContentReport({ reason: "NOPE" }).ok, false, "unknown reason refused");
  ok(cr.visitorKey("1.2.3.4", { env: { CONTENT_REPORT_SALT: "s" }, now: 0 }) !== cr.visitorKey("1.2.3.5", { env: { CONTENT_REPORT_SALT: "s" }, now: 0 }) && !/1\.2\.3\.4/.test(cr.visitorKey("1.2.3.4")), "visitor key is a hash, never the address");
  const db = fakeDb({ reports: [{ id: "r1", user_id: "owner", hidden_at: null, deleted_at: null }], content_reports: [], helper_bonus_ledger: [{ id: "b1", report_id: "r1", status: "PENDING" }] });
  const told = { owner: 0, admins: [] };
  const notify = { owner: async () => { told.owner++; }, admins: async (x) => { told.admins.push(x); } };
  const rep = (key, user) => cr.recordContentReport({ supa: db, reportId: "r1", reporterKey: key, reporterUserId: user, source: "APP", reason: "PERSON", notify });
  eq((await rep("user:owner", "owner")).own, true, "owner cannot report own case");
  eq((await rep("user:a", "a")).hidden, false, "one report: still visible");
  eq(told.admins.length, 1, "admin told at the first report");
  eq((await rep("user:a", "a")).already, true, "same person counts once");
  await rep("user:b", "b");
  eq(db.state.reports[0].hidden_at, null, "two people: still visible");
  const third = await rep("ip:xyz", null);
  ok(third.hidden && !!db.state.reports[0].hidden_at && db.state.reports[0].hidden_reason === "REPORTED", "hidden after three different people");
  eq(told.owner, 1, "owner told");
  eq(db.state.helper_bonus_ledger[0].status, "REVOKED", "waiting bonus from the case withdrawn");
  await cr.restoreReport(db, "r1");
  ok(db.state.reports[0].hidden_at === null && db.state.content_reports.every((r) => r.handled_at), "admin restore shows it again and closes the reports");

  const share = read("server/routes/share.js");
  ok(/!r\.closed_at && !r\.hidden_at;/.test(share), "hidden case: closed share page and poster");
  ok(/router\.post\("\/:token\/report", express\.urlencoded/.test(share) && /source: "SHARE_PAGE"/.test(share), "share page can be reported without sign-in");
  ok(/x-forwarded-for/.test(share), "visitor counted by the client address (hashed)");
  ok(/if \(report\?\.hidden_at\) return res\.status\(404\)/.test(read("server/routes/geoAlertDelivery.js")), "hidden case: area-alert view gone");
  const safety = read("server/routes/safety.js");
  for (const r of ['"/content/:reportId/report", requireUser', '"/admin/content", requireUser, requireAdmin', '"/admin/content/:reportId/restore", requireUser, requireAdmin', '"/admin/content/:reportId/hide", requireUser, requireAdmin', '"/admin/bonus-flags", requireUser, requireAdmin', '"/admin/bonus/:ledgerId/revoke", requireUser, requireAdmin'])
    ok(safety.includes(r), `route ${r.split(",")[0]}`);
  const mig = read("supabase/migrations/20261120110000_t1_9ay_content_safety.sql");
  ok(/revoke all on table public\.content_reports from anon, authenticated/.test(mig) && /content_reports_one_per_reporter/.test(mig), "reports: server only, one per reporter");

  // 3. Bonus: returns wait a week, the same pair once ever, never for area alerts, admin flags.
  eq(bonus.HOLD_MS.RETURN_CONFIRMED, 7 * 24 * 3600e3, "a return waits 7 days");
  eq(bonus.HOLD_MS.SIGHTING_RESOLVED, 7 * 24 * 3600e3, "a solving sighting waits 7 days");
  eq(bonus.PAIR_DAYS, null, "same pair only once, ever");
  ok(!bonus.canSpendBonusOn("GEO_ALERT") && !bonus.canSpendBonusOn("GEO_ALERT_TIER_2"), "never for an area alert");
  ok(bonus.canSpendBonusOn("REPORT_REACTIVATION") && bonus.canSpendBonusOn("AREA_VISIBILITY_TIER_1"), "extension and visibility allowed");
  const ledger = [
    { id: "1", user_id: "a", counterpart_user_id: "b", event_type: "RETURN_CONFIRMED", points: 15, status: "ACTIVE", created_at: new Date().toISOString() },
    { id: "2", user_id: "b", counterpart_user_id: "a", event_type: "RETURN_CONFIRMED", points: 15, status: "PENDING", created_at: new Date().toISOString() },
    { id: "3", user_id: "c", counterpart_user_id: "d", event_type: "MATCH_CONFIRMED", points: 3, status: "ACTIVE", created_at: new Date().toISOString() },
  ];
  const q = { select() { return q; }, not() { return q; }, neq() { return q; }, gte() { return q; }, limit() { return Promise.resolve({ data: ledger, error: null }); } };
  const flags = await bonus.bonusFlags({ supa: { from: () => q } });
  eq(flags.map((f) => [f.userId, f.reasons]), [["a", ["RECIPROCAL"]], ["b", ["RECIPROCAL"]]], "friends giving each other bonus are flagged; others not");

  // 4. Photos (T1.9AZ).
  eq(im.parseVerdict('{"public_ok":true,"reason":null}'), { status: "OK", reason: null }, "ok photo");
  eq(im.parseVerdict('{"public_ok":false,"reason":"PERSON"}'), { status: "HELD", reason: "PERSON" }, "person held");
  eq(im.parseVerdict('{"public_ok":false,"reason":"weird"}'), { status: "HELD", reason: "OTHER" }, "unknown reason still held");
  eq(im.parseVerdict("nonsense"), null, "no answer: try again later");
  ok(/main subject/.test(im.moderationPrompt()) && /background behind the item or animal are fine/.test(im.moderationPrompt()), "a person in the background is fine");
  const match = { lost: { user_id: "me", report_images: [{ id: 1, moderation_status: "HELD" }] }, found: { user_id: "other", report_images: [{ id: 2, moderation_status: "HELD" }, { id: 3, moderation_status: "OK" }, { id: 4, moderation_status: null }] } };
  im.dropHeldImages(match, "me");
  eq(match.lost.report_images.map((i) => i.id), [1], "own held photo kept");
  eq(match.found.report_images.map((i) => i.id), [3, 4], "the other side's held photo removed");
  ok(match.found.report_images.every((i) => !("moderation_status" in i)), "status not sent to the app");
  ok(/\.eq\("moderation_status", "OK"\)/.test(share), "public page and poster: checked photos only");
  const storage = read("server/routes/storage.js");
  ok(/IMAGE_HELD/.test(storage) && /heldPathsForOthers\(supaAdmin, req\.user\.id/.test(storage), "signed links refused for others' held photos");
  ok(/void moderateImageRow\(data, \{ supa: supaAdmin, notifyHeld: notifyImageHeld \}\)/.test(read("server/routes/reportImages.js")), "checked right after upload");
  ok(/scheduleImageModeration\(/.test(read("server/index.js")) && /\[BOOT\] imageModeration=/.test(read("server/index.js")), "hourly check of the rest");
  ok(/report_images_moderation_status_check/.test(mig) && /report_images_unchecked/.test(mig), "photo status in the database");

  // 5. App.
  ok(/<ContentReportButton reportId=\{String\(report\.id\)\} \/>/.test(read("app/area-alert/[id].tsx")), "report button on the area alert");
  const detail = read("app/report-details/[id].tsx");
  ok(/caseDetail\.hiddenTitle/.test(detail) && /caseDetail\.imageHeldTitle/.test(detail), "owner sees hidden case and held photo");
  const ue = read("src/lib/userError.ts");
  for (const c of ["EMAIL_NOT_VERIFIED", "PUBLIC_TEXT_NOT_ALLOWED", "REPORT_HIDDEN", "CANNOT_REPORT_OWN_CASE"]) ok(ue.includes(`${c}:`), `error text for ${c}`);

  console.log(`T1.9AY OK (${n} checks)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
