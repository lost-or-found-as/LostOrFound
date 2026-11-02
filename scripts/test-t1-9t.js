"use strict";
// T1.9T: prices, one push product in three sizes, free during the pilot, per-person push
// limits, refund flag when nobody got the push.
//   node .\scripts\test-t1-9t.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

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

// 1. Pricing.
const p = require(path.join(root, "server", "lib", "geoAlertPricing.js"));
eq(p.TIER_PRICES_ORE, { 1: 14900, 2: 24900, 3: 39900 }, "three push prices");
eq([250, 1000, 1500, 3000, 5000, 50000].map(p.tierForRadius), [1, 1, 2, 2, 3, 3], "size decides the tier");
const q = p.calculateGeoAlertQuote({ radiusM: 1500, estimatedEligibleInstallations: 37 }, {});
eq([q.productCode, q.amountOre, q.pilotFree, q.recipients], ["GEO_ALERT_TIER_2", 24900, false, { kind: "ABOUT", value: 40 }], "normal quote");
const pilot = p.calculateGeoAlertQuote({ radiusM: 500, estimatedEligibleInstallations: 3 }, { GEO_ALERT_PILOT_FREE: "true" });
eq([pilot.amountOre, pilot.listPriceOre, pilot.pilotFree, pilot.recipients.kind], [0, 14900, true, "FEW"], "free during the pilot");
eq(p.calculateGeoAlertQuote({ areaSqKm: Math.PI * 9 }, {}).tier, 2, "radius from area");
eq([p.recipientBand(0).kind, p.recipientBand(9).kind, p.recipientBand(14).value], ["NONE", "FEW", 10], "recipient band");
ok(!/eligibleUsers|eligibleInstallations: Number/.test(read("server/routes/geoAlertPreview.js")), "exact counts never sent to the app");

// 2. Per-person limits.
const caps = require(path.join(root, "server", "lib", "areaAlertCaps.js"));
const cand = [
  { recipient_user_id: "a", installation_id: "a1" },
  { recipient_user_id: "a", installation_id: "a2" },
  { recipient_user_id: "b", installation_id: "b1" },
  { recipient_user_id: "c", installation_id: "c1" },
  { recipient_user_id: "d", installation_id: "d1" },
];
const recent = new Map([
  ["b", new Set(["x", "y", "z"])],
  ["c", new Set(["x", "y"])],
]);
const r = caps.applyRecipientCaps(cand, recent, new Set(["d"]));
eq(r.send.map((c) => c.installation_id), ["a1", "a2", "c1"], "three a day, same case not twice in 7 days");
eq(r.skipped.map((c) => [c.installation_id, c.skipReason]), [["b1", "DAILY_CAP"], ["d1", "SAME_CASE"]], "skip reasons");
eq([caps.DAILY_PUSH_CAP, caps.SAME_CASE_DAYS], [3, 7], "limits");
const dispatch = read("server/lib/geoAlertDispatch.js");
ok(/capRecipients\(id, allCandidates\)/.test(dispatch) && /status: "SKIPPED"/.test(dispatch), "dispatch applies the limits and records skipped people");
ok(/recipient-caps-failed/.test(dispatch), "a failed lookup does not stop the alert");

// 3. Orders.
const commerce = read("server/routes/reportCommerce.js");
ok(/amount_ore: pilotFree \? 0 : product\.base_price_ore/.test(commerce), "pilot orders cost nothing");
ok(/pilotFreeOrder;/.test(commerce) && /order\.price_snapshot\?\.pilot_free === true &&\s*Number\(order\.amount_ore \|\| 0\) === 0/.test(commerce), "anyone can start a free pilot alert");
ok(/Number\(areaAlertDispatch\.sent \|\| 0\) === 0 && Number\(order\.amount_ore \|\| 0\) > 0[\s\S]{0,200}refund_reason: "NO_PUSH_RECIPIENTS"/.test(commerce), "refund flag when nobody got it");
ok(/const GEO_ALERT_DURATION_HOURS = 168;/.test(commerce) && /const GEO_ALERT_REMINDER_COUNT = 0;/.test(commerce), "7 days, no reminders");

ok(/function extensionPilotFree\(\)/.test(commerce) && /productCode === "REPORT_REACTIVATION" && extensionPilotFree\(\)/.test(commerce), "extensions free during the pilot");
ok(/order\.product_code === "REPORT_REACTIVATION"\) &&\s*order\.price_snapshot\?\.pilot_free === true/.test(commerce), "anyone can start a free pilot extension");
ok(/if \(row\?\.pilot_free\) return 0;/.test(read("src/lib/reportLifecycle.ts")) && /reactivationPrice === 0 \? t\("areaAlertCreate\.pilotFree"\)/.test(read("app/my-reports.tsx")), "app shows free extension");

// 4. Catalog.
const sql = read("supabase/migrations/20261102100000_t1_9t_prices_and_area_alert_rules.sql");
const prices = Object.fromEntries([...sql.matchAll(/\('([A-Z0-9_]+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])]));
for (const [tier, price] of Object.entries(p.TIER_PRICES_ORE)) eq(prices[`GEO_ALERT_TIER_${tier}`], price, `catalog tier ${tier}`);
eq([prices.LONG_TERM_WATCH_1Y, prices.LONG_TERM_WATCH_2Y, prices.LONG_TERM_WATCH_3Y], [19900, 34900, 44900], "historic case prices");
eq([prices.LONG_TERM_WATCH_1Y_C2, prices.LONG_TERM_WATCH_3Y_C1], [9900, 39900], "credit variants");
ok(/set base_price_ore = 4900, active = true where code = 'REPORT_REACTIVATION'/.test(sql), "extension 49 kr");
ok(/set active = false where code in \('GEO_ALERT_TIER_4', 'GEO_ALERT_TIER_5'\)/.test(sql), "old tiers retired");
ok(/add column if not exists refund_reason/.test(sql), "refund columns");

// 5. App.
const app = read("app/geo-alert-create.tsx");
ok(/areaAlertCreate\.pilotFree/.test(app) && /areaAlertCreate\.recipients\.about/.test(app), "price and recipients shown");
ok(/result\.quote\.recipients\.kind === "NONE"\)/.test(app), "no purchase when nobody follows the area");

console.log(`OK: T1.9T checks passed (${n} assertions).`);
