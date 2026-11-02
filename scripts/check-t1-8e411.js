"use strict";
const fs = require("fs"),
  path = require("path");
const read = (f) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const checks = {
  "app/alert-areas.tsx": [
    "mapCard",
    "fitOverview",
    "onMapReady",
    "map-outline",
    "statusBoxOff",
  ],
  "server/routes/alertAreas.js": [
    "upsert_current_location_watch_area_v2",
    "CURRENT_LOCATION_STORAGE_FAILED",
    '.neq("source_type", "CURRENT_LOCATION")',
  ],
  "supabase/migrations/20261012_t1_8e41_current_location_watch_fix.sql": [
    "upsert_current_location_watch_area_v2",
    "select id into v_id",
  ],
};
for (const [file, values] of Object.entries(checks)) {
  const source = read(file);
  for (const value of values)
    if (!source.includes(value)) throw new Error(`Missing ${value} in ${file}`);
}
const en = read("src/i18n/locales/en.ts"),
  no = read("src/i18n/locales/no.ts");
const keys = (s) =>
  new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
const a = keys(en),
  b = keys(no);
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw new Error("Locale parity failed");
console.log(`OK: T1.8E.4.1.1 checks passed. ${a.size} keys in both locales.`);
