"use strict";
// T1.9V: private identifiers on reports (matching only) and feedback from the app.
//   node .\scripts\test-t1-9v.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};
const eq = (a, b, label) => {
  assert.deepStrictEqual(a, b, `${label}: got ${JSON.stringify(a)}`);
  n++;
};

// 1. Identifier rules on the server.
const ident = require(path.join(root, "server/lib/reportIdentifier.js"));
eq(ident.normalizeIdentifier({ kind: "frame_number", value: " wtu 123-c 4567 " }), { kind: "FRAME_NUMBER", value: "WTU123C4567" }, "normalized");
eq(ident.normalizeIdentifier(null), null, "nothing given");
eq(ident.normalizeIdentifier({ kind: "IMEI", value: "  " }), null, "empty value clears");
assert.throws(() => ident.normalizeIdentifier({ kind: "PASSWORD", value: "12345" }), /INVALID_IDENTIFIER/); n++;
assert.throws(() => ident.normalizeIdentifier({ kind: "OTHER", value: "12" }), /INVALID_IDENTIFIER/); n++;

// 2. Database: the value never reaches clients; same value matches, a different one of the same kind rules out.
const migration = read("supabase/migrations/20261103110000_t1_9v_identifiers_and_feedback.sql");
ok(/revoke all on table public\.report_identifiers from anon, authenticated/.test(migration), "identifiers are server only");
ok(/revoke all on table public\.app_feedback from anon, authenticated/.test(migration), "feedback is server only");
const kindsSql = [...migration.match(/kind in \(([^)]*)\)/)[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
eq(kindsSql, [...ident.IDENTIFIER_KINDS], "same kinds in database and server");
ok(/public\.report_identifier_relation\(r\.id,o\.id\)=1\n\s+or \(r\.type='LOST'/.test(migration), "same identifier matches outside the search area");
ok(/within_radius=true and identifier_relation>=0/.test(migration), "different identifier rules the pair out");
ok(/brand_match\*7\+case when identifier_relation=1 then 40 else 0 end/.test(migration), "same identifier raises the score");
ok(/jsonb_build_object\('k','identifier_match','v',identifier_relation\)/.test(migration), "reason tells the app, without the value");
ok(!/value_normalized/.test(migration.slice(migration.indexOf("jsonb_build_array"), migration.indexOf("reasons\n"))), "the value is not in the reasons");

// 3. Server wiring.
const reports = read("server/routes/reports.js");
ok(/normalizeIdentifier\(req\.body\?\.identifier\)/.test(reports) && /saveIdentifier\(supaAdmin, data\.id, identifier\)/.test(reports), "create stores the identifier");
ok(/"identifier" in req\.body/.test(reports), "edit can change or clear it");
ok(/identifier: await loadIdentifier\(supaAdmin, reportId\)/.test(reports), "only the owner's GET returns it");
ok(!/identifier/.test(read("server/routes/matches.js")), "match data never carries the value");

// 4. App: field for relevant items, sent in the body, comparison row.
const form = requireTs(path.join(root, "src/lib/registerForm.ts"), { "../contexts/ReportDraftContext": {} });
eq(form.identifierKindsFor("BICYCLE"), ["FRAME_NUMBER", "SERIAL_NUMBER", "OTHER"], "bike kinds");
eq(form.identifierKindsFor("CAT")[0], "CHIP_NUMBER", "pet chip");
eq(form.identifierKindsFor("WALLET"), [], "no field for a wallet");
eq(form.normalizeIdentifierValue("wtu 123-c"), ident.normalizeIdentifierValue("wtu 123-c"), "same normalization as the server");
const base = { type: "FOUND", category: "VEHICLE_TRANSPORT", subcategoryKey: "BICYCLE", color: "blue", location: { latitude: 1, longitude: 1, radiusMeters: 10 } };
const opts = { language: "no", rewardEnabled: false, clientRequestId: "report-1234567890" };
eq(form.reportBody({ ...base, identifierValue: "wtu 123 c" }, opts).identifier, { kind: "FRAME_NUMBER", value: "WTU123C" }, "default kind");
eq(form.reportBody({ ...base, identifierKind: "SERIAL_NUMBER", identifierValue: "ab12" }, opts).identifier, { kind: "SERIAL_NUMBER", value: "AB12" }, "chosen kind");
ok(!("identifier" in form.reportBody({ ...base, identifierValue: "ab" }, opts)), "too short is not sent");
ok(!("identifier" in form.reportBody({ ...base, subcategoryKey: "WALLET", identifierValue: "ABCDE" }, opts)), "not sent for other items");
const reg = read("app/(report)/register.tsx");
ok(/identifierKindsFor\(draft\.subcategoryKey\)/.test(reg) && /register\.identifier\.privacy/.test(reg), "registration shows the field and the privacy note");
ok(/identifier_match/.test(read("app/matches/[matchId].tsx")), "match screen shows the identifier row");

// 5. Feedback.
const fb = require(path.join(root, "server/lib/feedback.js"));
ok(fb.normalizeFeedback({ kind: "idea", message: "Flere områder" }).ok, "valid feedback");
eq(fb.normalizeFeedback({ kind: "SPAM", message: "hei hei" }).error, "INVALID_FEEDBACK_KIND", "unknown kind");
eq(fb.normalizeFeedback({ kind: "BUG", message: "x" }).error, "FEEDBACK_TOO_SHORT", "too short");
eq(fb.normalizeFeedback({ kind: "BUG", message: "x".repeat(2001) }).error, "FEEDBACK_TOO_LONG", "too long");
eq(fb.feedbackEmailRequest({ kind: "IDEA", message: "m" }, {}), null, "no e-mail without settings");
const mail = fb.feedbackEmailRequest({ kind: "BUG", message: "Kartet hopper", platform: "ios" }, { RESEND_API_KEY: "k", ADMIN_ALERT_EMAIL: "a@b.no", ADMIN_ALERT_FROM: "x@y.no" });
ok(/Kartet hopper/.test(mail.init.body) && /Noe er feil/.test(mail.init.body), "e-mail has the message and kind in Norwegian");
const route = read("server/routes/feedback.js");
ok(/router\.post\("\/", requireUserOrGuest/.test(route) && /FEEDBACK_DAILY_LIMIT/.test(route), "guests may send, with a daily limit");
ok(/router\.get\("\/admin", requireUser, requireAdmin/.test(route), "admin list is admin only");
ok(/app\.use\("\/feedback", feedbackRoutes\)/.test(read("server/index.js")), "route mounted");
const serverNo = JSON.parse(read("server/locales/no.json"));
const serverEn = JSON.parse(read("server/locales/en.json"));
for (const k of fb.FEEDBACK_KINDS) ok(serverNo[`feedback.kind.${k}`] && serverEn[`feedback.kind.${k}`], `server text for ${k}`);
const screen = read("app/feedback.tsx");
ok(/sendFeedback\(/.test(screen) && !/Alert\.alert/.test(screen), "feedback screen sends without system dialogs");
ok(/router\.push\("\/feedback"\)/.test(read("app/(tabs)/profile.tsx")) && /\/feedback-admin/.test(read("app/(tabs)/profile.tsx")), "profile links to feedback and the admin list");

console.log(`OK: T1.9V identifier and feedback checks passed (${n} assertions).`);
