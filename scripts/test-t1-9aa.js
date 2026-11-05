"use strict";
// T1.9AA: "Varsle meg der jeg er" defaults to "until I turn it off" and keeps its end time when
// the app refreshes the position; the Home case card no longer pops in late.
//   node .\scripts\test-t1-9aa.js
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

// 1. Default and refresh behaviour for the current-location area.
const areas = requireTs(path.join(root, "src/lib/alertAreas.ts"));
ok(areas.DEFAULT_EXPIRY_HOURS === 0 && areas.DEFAULT_CURRENT_SETTINGS.expiryHours === 0, "default is until turned off");
ok(areas.EXPIRIES.includes(0), "until turned off is a choice");
const screen = read("app/alert-areas.tsx");
ok(/keepExpiry: silent/.test(screen), "a silent refresh asks the server to keep the end time");
const route = read("server/routes/alertAreas.js");
ok(/req\.body\?\.expiryHours \?\? 0/.test(route), "server default is until turned off");
ok(/if \(keepExpiry && existing\.data\?\.id\)/.test(route) && /delete values\.expires_at/.test(route), "server keeps expires_at on a refresh");
ok(/endsAt <= Date\.now\(\)\) return res\.json\(\{ area: null, expired: true \}\)/.test(route), "an expired area is not brought back by opening the app");

// 2. Home card: cached counts and a same-size placeholder.
const home = read("app/(tabs)/index.tsx");
ok(/readCachedHomeSummary\(user\.id\)/.test(home) && /writeCachedHomeSummary\(userId, value\)/.test(home), "counts are cached per user");
ok(/hasAccount && !summaryKnown &&/.test(home), "placeholder until the counts are known");
const lib = read("src/lib/homeSummary.ts");
ok(/const CACHE_PREFIX = "lof\.homeSummary\.v1\."/.test(lib), "cache key per user");
for (const lang of ["no", "en"]) ok(read(`src/i18n/locales/${lang}.ts`).includes(`"home.summary.loading":`), `placeholder label in ${lang}`);

console.log(`OK: T1.9AA alert-area expiry and Home card checks passed (${n} assertions).`);
