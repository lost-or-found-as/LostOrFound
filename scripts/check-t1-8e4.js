"use strict";
const fs = require("fs"),
  p = require("path"),
  r = (f) => fs.readFileSync(p.join(process.cwd(), f), "utf8");
const checks = {
  "app/alert-areas.tsx": [
    "NotifyWhereIAm",
    "updateCurrent",
    "AppState.addEventListener",
    "fitToCoordinates",
    "openNew",
    "openEdit",
  ],
  "server/routes/alertAreas.js": [
    "/current-location",
    "upsert_current_location_watch_area",
    "CURRENT_LOCATION_EXPIRIES",
  ],
  "supabase/migrations/20261012_t1_8e4_current_location_watch.sql": [
    "source_type",
    "CURRENT_LOCATION",
    "location_updated_at",
    "expires_at",
  ],
};
for (const [f, a] of Object.entries(checks)) {
  const s = r(f);
  for (const v of a)
    if (!s.toLowerCase().includes(v.toLowerCase()))
      throw Error(`Missing ${v} in ${f}`);
}
const en = r("src/i18n/locales/en.ts"),
  no = r("src/i18n/locales/no.ts"),
  ks = (s) => new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])),
  a = ks(en),
  b = ks(no);
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw Error("Locale parity failed");
console.log(`OK: T1.8E.4 checks passed. ${a.size} keys in both locales.`);
