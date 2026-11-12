"use strict";
// T1.9Y: area-alert push in one language, and PostGIS move preparation.
//   node .\scripts\test-t1-9y.js
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

// 1. The server item catalog is generated from the app catalog and up to date.
const { buildServerCatalog } = require("./build-server-catalog");
const stored = JSON.parse(read("server/data/itemCatalog.json"));
eq(stored, buildServerCatalog(), "server/data/itemCatalog.json matches src/i18n/catalog.ts (run scripts/build-server-catalog.js)");

// 2. Item text in the recipient's language, from keys, never the stored title.
const { reportItemText: t } = require(path.join(root, "server/lib/reportItemText.js"));
const ball = { category: "SPORT_OUTDOOR", subcategory_key: "BALL", color: "yellow", brand: "Wilson", title: "Lost • Sports and outdoors • Ball" };
eq(t(ball, "no"), "Ball (gul, Wilson)", "Norwegian");
eq(t(ball, "en"), "Ball (yellow, Wilson)", "English");
eq(t(ball, "fr"), "Ball (gul, Wilson)", "unknown language falls back to Norwegian");
eq(t(ball, "de"), "Ball (gelb, Wilson)", "German item names (T1.9AH)");
eq(t({ subcategory_key: "KEYCHAIN", color: "cyan" }, "no"), "Nøkler (turkis)", "old item and colour keys");
eq(t({ subcategory_key: "CUSTOM", subcategory_custom: "  rød   termos " }, "en"), "Rød termos", "own text is kept as written");
eq(t({ category: "ELECTRONICS", color: "unknown" }, "en"), t({ category: "ELECTRONICS" }, "en"), "unknown colour is left out");
eq(t({}, "no"), "", "nothing usable gives empty text");
eq(t(null, "en"), "", "no report gives empty text");

// 3. The dispatch uses it, and no longer puts reports.title in the push.
const dispatch = read("server/lib/geoAlertDispatch.js");
ok(/item: reportItemText\(report, candidate\.language\)/.test(dispatch), "push body uses the localized item text");
ok(!/item: candidate\.report_title/.test(dispatch), "push body does not use the stored title");
ok(/\.select\("category,subcategory_key,subcategory_custom,color,brand"\)/.test(dispatch), "report keys are loaded once per campaign");
const no = JSON.parse(read("server/locales/no.json"));
const en = JSON.parse(read("server/locales/en.json"));
for (const k of ["push.areaAlert.title", "push.areaAlert.body", "push.areaAlert.itemFallback"]) ok(no[k] && en[k], `${k} in both languages`);

// 4. PostGIS move: pinned search paths get extensions, and new migrations keep it.
const mig = read("supabase/migrations/20261104100000_t1_9y_search_path_with_extensions.sql");
ok(/alter routine %s set search_path = %s, extensions/.test(mig), "functions and procedures get extensions in their path");
ok(/continue when current_path ~\* '\(\^\|\[\\s,"\]\)extensions/.test(mig), "already updated functions are skipped (repeatable)");
ok(/SEARCH_PATH_WITHOUT_EXTENSIONS/.test(read("scripts/check-migrations.js")), "migration check guards new pinned paths");

console.log(`OK: T1.9Y push language and PostGIS preparation checks passed (${n} assertions).`);
