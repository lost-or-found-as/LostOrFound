"use strict";
// T1.9H behavior test: historic cases (long-term watch), pricing with credit, matching fixes.
//   node .\scripts\test-t1-9h.js
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
const NOW = Date.parse("2026-10-31T12:00:00Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

// 1. Server pricing and rules.
const lt = require(path.join(root, "server", "lib", "longTermWatch.js"));
eq(lt.longTermProductCode(1, 0), "LONG_TERM_WATCH_1Y", "1 year, no credit");
eq(lt.longTermProductCode(3, 2), "LONG_TERM_WATCH_3Y_C2", "3 years, two credits");
eq(lt.longTermProductCode(2, 7), "LONG_TERM_WATCH_2Y_C2", "credit capped at two");
assert.throws(() => lt.longTermProductCode(4, 0), /INVALID_LONG_TERM_YEARS/);
n++;
ok(lt.isLongTermProduct("LONG_TERM_WATCH_2Y_C1") && !lt.isLongTermProduct("LONG_TERM_WATCH_ANNUAL"), "per-year products only");
eq(lt.yearsOfProduct("LONG_TERM_WATCH_3Y_C1"), 3, "years from code");

const paid = (extra = {}) => ({ product_code: "REPORT_REACTIVATION", status: "ACTIVE", paid_at: iso(-DAY), ...extra });
eq(lt.extensionCredits([paid(), paid({ status: "SUPERSEDED" })], false), 2, "two paid extensions");
eq(lt.extensionCredits([paid(), paid({ refunded_at: iso(0) }), paid({ paid_at: null })], false), 1, "refunded and unpaid do not count");
eq(lt.extensionCredits([paid(), paid(), paid()], false), 2, "at most two credits");
eq(lt.extensionCredits([paid(), paid()], true), 0, "credit is given once");

const lost = { id: "r", type: "LOST", status: "ACTIVE" };
eq(lt.longTermEligibility({ ...lost, type: "FOUND" }, null, NOW).error, "LONG_TERM_REQUIRES_LOST_REPORT", "found cases cannot be historic");
eq(lt.longTermEligibility({ ...lost, closed_at: iso(-DAY) }, null, NOW).error, "REPORT_CLOSED", "closed cases cannot be historic");
eq(lt.longTermEligibility(lost, null, NOW), { ok: true, renew: false }, "first purchase");
const live = { status: "ACTIVE", current_period_end: iso(20 * DAY) };
eq(lt.longTermEligibility(lost, live, NOW), { ok: true, renew: true }, "renewal of a live watch");
eq(lt.longTermPeriod(1, null, NOW), { startsAt: iso(0), endsAt: "2027-10-31T12:00:00.000Z" }, "new period starts now");
eq(lt.longTermPeriod(2, live, NOW).startsAt, iso(20 * DAY), "renewal starts at the end of the running period");
ok(!lt.isLiveWatch({ status: "ACTIVE", current_period_end: iso(-DAY) }, NOW), "ended watch is not live");
const quote = lt.longTermQuote({
  years: 1,
  credits: 2,
  product: { code: "LONG_TERM_WATCH_1Y_C2", base_price_ore: 20100, currency: "NOK" },
  fullYearProduct: { code: "LONG_TERM_WATCH_1Y", base_price_ore: 39900 },
  period: { startsAt: iso(0), endsAt: iso(365 * DAY) },
});
ok(quote.baseAmountOre === 39900 && quote.creditOre === 19800 && quote.amountOre === 20100, "quote shows price, credit and amount");
ok(lt.isHistoricFromStart({ occurred_at: iso(-400 * DAY) }, NOW) && !lt.isHistoricFromStart({ occurred_at: iso(-30 * DAY) }, NOW), "old losses are historic from the start");

// 2. Migration.
const mig = read("supabase/migrations/20261031100000_t1_9h_historic_cases_and_matching.sql");
ok(/or \(opposite='LOST' and public\.report_has_long_term_watch\(o\.id\)\)/.test(mig), "historic lost cases are candidates at any age");
ok(/report_colors_overlap\(r\.color,r\.secondary_color,o\.color,o\.secondary_color\)/.test(mig), "both colours are compared");
ok(!/delete from public\.matches where \(lost_id=r\.id or found_id=r\.id\) and status='NEW';/.test(mig), "matches are no longer deleted before every refresh");
ok(/, kept as \([\s\S]*returning id[\s\S]*m\.id not in \(select id from kept\)/.test(mig), "only matches that no longer qualify are removed");
ok(/revoke execute on function public\.report_has_long_term_watch\(uuid\) from public, anon, authenticated/.test(mig), "helper not callable by clients");
ok(/update of type, category, subcategory_key, title, description, color, secondary_color, brand/.test(mig), "editing the secondary colour refreshes matches");
ok(/generate_series\(1, 3\) y cross join generate_series\(0, 2\) c/.test(mig) && /on conflict \(code\) do nothing/.test(mig), "nine catalog products, added once");

// 3. Server wiring.
const commerce = read("server/routes/reportCommerce.js");
ok(/router\.post\("\/long-term\/quote", requireUser/.test(commerce), "quote route requires an account");
ok(/if \(productCode === LONG_TERM_REQUEST_CODE\)/.test(commerce) && /LONG_TERM_PRODUCT_REQUIRES_YEARS/.test(commerce), "server picks the product variant");
ok(/isLongTermProduct\(order\.product_code\)\s*\?\s*\{ data: \[\], error: null \}/.test(commerce), "historic periods do not supersede each other");
ok(/visible_until: periodEnd\.toISOString\(\),[\s\S]{0,80}long_term_candidate: true/.test(commerce), "case stays active until the watch ends");
ok(/p_max_age_days: 365/.test(commerce), "activation compares with every active find");
ok(/storedColorMatch === true \|\| Number\(storedColorMatch\) === 1/.test(read("server/routes/matches.js")), "colour is not counted twice in the shown score");

const { buildReportActivity } = require(path.join(root, "server", "lib", "reportActivity.js"));
const act = buildReportActivity({
  report: { id: "r", user_id: "u", type: "LOST", created_at: iso(-60 * DAY) },
  orders: [paid({ paid_at: iso(-40 * DAY) }), paid({ paid_at: iso(-10 * DAY) }), { product_code: "LONG_TERM_WATCH_2Y_C2", paid_at: iso(-DAY) }],
  longTermWatch: { status: "ACTIVE", current_period_end: iso(700 * DAY) },
  now: NOW,
});
eq(act.summary.paidExtensions, 2, "paid extensions counted");
eq(act.summary.longTermUntil, iso(700 * DAY), "historic period end");
eq(act.events[0], { type: "LONG_TERM", at: iso(-DAY), years: 2 }, "historic purchase in the timeline");

// 4. App rules.
const stubs = {
  "./config": { API_BASE_URL: "http://test" },
  "./supabase": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "./reportCommerce": { createReportOrder: async () => ({}), activateTestReportOrder: async () => ({}) },
};
const { nextStep, EMPTY_ACTIVITY } = requireTs(path.join(root, "src/lib/reportActivity.ts"), stubs);
const sum = (over) => ({ ...EMPTY_ACTIVITY.summary, ...over });
const report = (days, extra = {}) => ({ id: "r", type: "LOST", status: "ACTIVE", visible_until: iso(days * DAY), occurred_at: iso(-10 * DAY), ...extra });

const historic = nextStep(report(300), sum({ longTermUntil: iso(300 * DAY) }), NOW);
ok(historic.kind === "historic" && historic.action === null && historic.dateIso === iso(300 * DAY), "running historic case");
const ending = nextStep(report(10), sum({ longTermUntil: iso(10 * DAY) }), NOW);
ok(ending.kind === "historic" && ending.action === "longTerm" && ending.bodyKey === "caseDetail.next.historicBodyEnding", "renew in the last month");
ok(nextStep(report(10), sum({ longTermUntil: iso(10 * DAY), possibleMatches: 2 }), NOW).kind === "matches", "matches before the historic notice");
eq(nextStep(report(-1), sum({ paidExtensions: 1 }), NOW).action, "reactivateLost", "second extension still offered");
const final = nextStep(report(-1), sum({ paidExtensions: 2 }), NOW);
ok(final.action === "longTerm" && final.bodyKey === "caseDetail.next.expiredBodyLostFinal", "after two extensions: historic case");
const oldActive = nextStep(report(5, { occurred_at: iso(-800 * DAY) }), sum({}), NOW);
ok(oldActive.kind === "historicOffer" && oldActive.action === "longTerm", "old loss offered as historic from the start");
eq(nextStep(report(-1, { occurred_at: iso(-800 * DAY) }), sum({}), NOW).action, "longTerm", "old expired loss goes straight to historic");
eq(nextStep(report(-1, { type: "FOUND", extension_count: 2 }), sum({}), NOW).action, null, "found cases are never historic");

const { translate } = requireTs(path.join(root, "src/i18n/translate.ts"));
eq(translate("no", "longTerm.credit", { count: 1 }), "Fradrag for 1 forlengelse", "singular credit");
eq(translate("en", "longTerm.years", { count: 3 }), "3 years", "years label");

// 5. Screens.
const details = read("app/report-details/[id].tsx");
ok(/<LongTermSheet/.test(details) && /step\.action === "longTerm"/.test(details), "Saksdetaljer opens the historic sheet");
ok(/caseDetail\.menu\.makeHistoric/.test(details), "historic case in the ⋯ menu");
const sheet = read("src/ui/LongTermSheet.tsx");
ok(/quoteLongTermWatch\(reportId, years\)/.test(sheet) && /buyLongTermRequest\(reportId, years\)/.test(sheet), "sheet quotes and buys");

console.log(`OK: T1.9H checks passed (${n} assertions).`);
