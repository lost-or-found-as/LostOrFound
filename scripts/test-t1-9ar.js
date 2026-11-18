// scripts/test-t1-9ar.js
// T1.9AR: the owner's statistics report counts correctly and never shows a single case.
//   node .\scripts\test-t1-9ar.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

const lib = require(path.join(root, "server/lib/statsReport.js"));
const now = Date.parse("2026-11-18T08:00:00Z");
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

eq(lib.townFromLabel("Storgata 1, 0155 Oslo"), "Oslo", "town from address");
eq(lib.townFromLabel("Torget, 7011 Trondheim, Norge"), "Trondheim", "country dropped");
eq(lib.townFromLabel(""), null, "empty label");
eq(new Date(lib.weekStart(Date.parse("2026-11-18T08:00:00Z"))).toISOString(), "2026-11-16T00:00:00.000Z", "week starts Monday");

const oslo = Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, type: i < 4 ? "LOST" : "FOUND", status: "ACTIVE", created_at: daysAgo(i), lat: 59.913 + i * 0.001, lng: 10.752, location_label: "Karl Johans gate 1, 0154 Oslo" }));
const lonely = { id: "x1", type: "LOST", status: "ACTIVE", created_at: daysAgo(3), lat: 69.65, lng: 18.95, location_label: "Storgata 5, 9008 Tromsø" };
const deleted = { id: "d1", type: "LOST", status: "ACTIVE", created_at: daysAgo(1), deleted_at: daysAgo(0), lat: 59.913, lng: 10.752 };
const raw = {
  users: [{ created_at: daysAgo(2), is_anonymous: false }, { created_at: daysAgo(40), is_anonymous: false }, { created_at: daysAgo(1), is_anonymous: true }],
  reports: [...oslo, lonely, deleted],
  matches: [{ lost_id: "o0" }, { lost_id: "o1" }],
  resolutions: [{ context_type: "MATCH", status: "ACCEPTED", responded_at: daysAgo(2) }, { context_type: "OBSERVATION", status: "ACCEPTED", responded_at: daysAgo(5) }, { context_type: "MATCH", status: "REJECTED", responded_at: daysAgo(1) }],
  orders: [
    { product_code: "REPORT_REACTIVATION", status: "PAID", amount_ore: 3900, paid_at: daysAgo(3) },
    { product_code: "REPORT_REACTIVATION", status: "ACTIVE", amount_ore: 3900, paid_at: daysAgo(60) },
    { product_code: "GEO_ALERT_TIER_1", status: "REFUNDED", amount_ore: 9900, paid_at: daysAgo(5), refunded_at: daysAgo(4) },
    { product_code: "GEO_ALERT_TIER_1", status: "PENDING", amount_ore: 9900 },
  ],
};
const s = lib.buildStats(raw, { now });
eq([s.kpi.accounts, s.kpi.guests, s.kpi.newAccounts30], [2, 1, 1], "accounts, guests, new");
eq([s.kpi.activeLost, s.kpi.activeFound], [5, 2], "active cases without deleted ones");
eq([s.kpi.returned, s.kpi.viaSighting], [1, 1], "only accepted resolutions count");
eq(s.kpi.matchRate90, 40, "2 of 5 lost cases matched");
eq([s.revenue, s.revenue30, s.refunds], [78, 39, 1], "paid revenue, last 30 days, refunds");
eq(s.products.map((p) => [p.product, p.count]), [["REPORT_REACTIVATION", 2]], "pending and refunded orders left out");
eq(s.weeks.length, 12, "twelve weeks");
eq(s.weeks[11].returned, 1, "delivery in the current week");

eq(s.areas.map((a) => [a.town, a.count]), [["Oslo", 6]], "Oslo cell shown");
eq(s.towns, [{ town: "Oslo", count: 6 }], "list per town");
eq(s.hiddenCases, 1, "Tromsø case hidden (cell under 5)");
ok(s.areas.every((a) => !oslo.some((r) => r.lat === a.lat && r.lng === a.lng)), "cell centre is never a case position");

const html = lib.renderStatsHtml(s);
ok(!/Tromsø/.test(html), "hidden area not named anywhere");
ok(!/Karl Johans gate|0154/.test(html), "no addresses in the report");
ok(!/https?:\/\//.test(html), "report loads nothing from the network");
ok(/Vis som tabell/.test(html), "table view for the chart");
ok(/<title>Mistet, uke fra/.test(html), "hover text on points");
ok(/Forlengelse <span class="code">REPORT_REACTIVATION/.test(html), "product shown by name");
ok(/<title>Oslo: 6 saker<\/title>/.test(html), "hover text on place bars");

const script = fs.readFileSync(path.join(root, "server/scripts/stats-report.js"), "utf8");
ok(/--out must be outside the repository/.test(script), "report written outside the repository");
ok(/action: "VIEW_STATS_REPORT"/.test(script), "run is logged");
ok(!/\bemail\b/.test(script), "script never reads e-mail addresses");
ok(fs.readFileSync(path.join(root, ".gitignore"), "utf8").includes("statistikk-*.html"), "report files ignored by git");

console.log(`OK: T1.9AR statistics report passed (${n} assertions).`);
