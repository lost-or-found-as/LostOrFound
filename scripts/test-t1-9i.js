"use strict";
// T1.9I behavior test: extend a LOST case before it expires (30 days, twice), then historic case.
//   node .\scripts\test-t1-9i.js
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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

// 1. Server rules.
const lt = require(path.join(root, "server", "lib", "longTermWatch.js"));
const lost = (days, extra = {}) => ({ id: "r", type: "LOST", status: "ACTIVE", visible_until: iso(days * DAY), ...extra });
const order = (extra = {}) => ({ product_code: "REPORT_REACTIVATION", status: "ACTIVE", paid_at: iso(-DAY), ...extra });

eq(lt.lostExtensionEligibility(lost(5), {}, NOW).error, "LOST_EXTENSION_TOO_EARLY", "not while more than three days are left");
eq(lt.lostExtensionEligibility(lost(2), {}, NOW), { ok: true }, "allowed in the last three days");
eq(lt.lostExtensionEligibility(lost(-4, { status: "EXPIRED" }), {}, NOW), { ok: true }, "allowed after it has ended");
eq(lt.lostExtensionEligibility(lost(2), { paidExtensions: 2 }, NOW).error, "LOST_EXTENSION_LIMIT", "at most two");
eq(
  lt.lostExtensionEligibility(lost(2), { watch: { status: "ACTIVE", current_period_end: iso(100 * DAY) } }, NOW).error,
  "LONG_TERM_ACTIVE",
  "not while a historic period runs",
);
eq(lt.lostExtensionEligibility({ ...lost(2), type: "FOUND" }, {}, NOW).error, "LOST_EXTENSION_REQUIRES_LOST_REPORT", "found cases use extend-found");
eq(lt.lostExtensionEligibility(lost(2, { closed_at: iso(-DAY) }), {}, NOW).error, "REPORT_CLOSED", "closed cases cannot be extended");
eq(lt.lostExtensionEnd(lost(2), NOW), iso(32 * DAY), "days left are kept");
eq(lt.lostExtensionEnd(lost(-4), NOW), iso(30 * DAY), "an ended case gets 30 days from now");
eq(lt.paidExtensionCount([order(), order({ refunded_at: iso(0) }), order({ paid_at: null }), order({ status: "PENDING" })]), 1, "only paid extensions count");

// 2. Server wiring.
const commerce = read("server/routes/reportCommerce.js");
ok(/productCode === "REPORT_REACTIVATION"\) \{[\s\S]{0,300}lostExtensionEligibility\(report, context\)/.test(commerce), "rules checked when the order is created");
ok(/lostExtensionEligibility\(report, context, now\.getTime\(\)\)[\s\S]{0,200}lostExtensionEnd\(report, now\.getTime\(\)\)/.test(commerce), "rules checked again on activation, days added");
ok(!/periodEnd = new Date\(now\.getTime\(\) \+ 30 \* 86400000\)/.test(commerce), "extension no longer replaces the days left");
const activity = read("server/routes/reportsActivity.js");
ok(/rep\.paid_extensions = paidExtensionCount/.test(activity) && /rep\.long_term_until =/.test(activity), "My cases gets the lifecycle facts");

// 3. App rules.
const stubs = {
  "./config": { API_BASE_URL: "http://test" },
  "./supabase": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "./reportCommerce": { createReportOrder: async () => ({}), activateTestReportOrder: async () => ({}) },
};
const life = requireTs(path.join(root, "src/lib/reportLifecycle.ts"), stubs);
ok(!life.canExtendLost(lost(5), {}, NOW) && life.canExtendLost(lost(2), {}, NOW), "app uses the same window");
ok(!life.canExtendLost(lost(2), { paidExtensions: 2 }, NOW), "app stops after two");
ok(!life.canExtendLost(lost(2), { longTermUntil: iso(50 * DAY) }, NOW), "app: not while historic");
eq(life.LOST_EXTENSION_WINDOW_DAYS, lt.LOST_EXTENSION_WINDOW_DAYS, "same window on server and app");
eq(life.LOST_MAX_EXTENSIONS, lt.LOST_MAX_EXTENSIONS, "same limit on server and app");

const { nextStep, EMPTY_ACTIVITY } = requireTs(path.join(root, "src/lib/reportActivity.ts"), stubs);
const sum = (over) => ({ ...EMPTY_ACTIVITY.summary, ...over });
const soon = nextStep(lost(2, { occurred_at: iso(-5 * DAY) }), sum({}), NOW);
ok(soon.kind === "expiring" && soon.action === "extendLost" && soon.params.count === 2, "last days: extend");
const soonFinal = nextStep(lost(2, { occurred_at: iso(-5 * DAY) }), sum({ paidExtensions: 2 }), NOW);
ok(soonFinal.action === "longTerm" && soonFinal.bodyKey === "caseDetail.next.expiringBodyLostFinal", "last days after two extensions: historic");
eq(nextStep(lost(6, { occurred_at: iso(-1 * DAY) }), sum({}), NOW).kind, "searching", "no offer before the window");
ok(nextStep(lost(2), sum({ possibleMatches: 1 }), NOW).kind === "matches", "matches still come first");

const { translate } = requireTs(path.join(root, "src/i18n/translate.ts"));
eq(translate("no", "caseDetail.next.expiringBodyLost", { count: 1 }).startsWith("Saken utløper om 1 dag."), true, "singular day");

// 4. Error texts and screens.
const userError = read("src/lib/userError.ts");
ok(/LOST_EXTENSION_LIMIT: "errors\.lostExtensionLimit"/.test(userError) && /LOST_EXTENSION_TOO_EARLY/.test(userError), "server codes have texts");
const myReports = read("app/my-reports.tsx");
ok(/canExtendLost\(r, lostFacts\)/.test(myReports) && /<LongTermSheet/.test(myReports), "My cases offers extend, then historic");
ok(/canExtendLost\(r, activity\.summary\)/.test(read("app/report-details/[id].tsx")), "Saksdetaljer menu uses the same rule");

console.log(`OK: T1.9I checks passed (${n} assertions).`);
