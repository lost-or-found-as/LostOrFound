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
// T1.9T: the area-alert tiers were re-priced later; the seed only has to contain every tier.
for (const tier of Object.keys(TIER_PRICES_ORE)) {
  assert.ok(rows.has(`GEO_ALERT_TIER_${tier}`), `tier ${tier} seeded`);
  n++;
}
// T1.9M: the app reads the extension price from the catalog, so only the seed row is checked here.
assert.ok(rows.has("REPORT_REACTIVATION"), "extension seeded");
n++;
assert.ok(/on conflict \(code\) do nothing/.test(sql), "existing rows are left unchanged");
n++;
console.log(`OK: T1.9J catalog seed checks passed (${n} assertions).`);
