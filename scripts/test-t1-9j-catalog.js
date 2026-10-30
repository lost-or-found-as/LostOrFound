"use strict";
// T1.9J: the catalog seed has every product the server can order, at the prices the server shows.
//   node .\scripts\test-t1-9j-catalog.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261031120000_t1_9j_seed_product_catalog.sql"), "utf8");
const { TIER_PRICES_ORE } = require(path.join(root, "server/lib/geoAlertPricing.js"));
let n = 0;
const rows = new Map([...sql.matchAll(/\('([A-Z0-9_]+)', '[^']*', '[^']*', 'ONE_TIME', '[A-Z]+', \d+, (\d+),/g)].map((m) => [m[1], Number(m[2])]));
for (const [tier, price] of Object.entries(TIER_PRICES_ORE)) {
  assert.strictEqual(rows.get(`GEO_ALERT_TIER_${tier}`), price, `tier ${tier} price`);
  n++;
}
const appPrice = Number(fs.readFileSync(path.join(root, "src/lib/reportLifecycle.ts"), "utf8").match(/REACTIVATION_TEST_PRICE = (\d+)/)[1]);
assert.strictEqual(rows.get("REPORT_REACTIVATION"), appPrice * 100, "extension price matches the app");
n++;
assert.ok(/on conflict \(code\) do nothing/.test(sql), "existing rows are left unchanged");
n++;
console.log(`OK: T1.9J catalog seed checks passed (${n} assertions).`);
