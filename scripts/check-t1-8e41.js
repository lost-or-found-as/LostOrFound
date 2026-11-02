"use strict";

const fs = require("fs");
const path = require("path");

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

const checks = {
  "app/alert-areas.tsx": [
    "mapCard",
    "fitOverview",
    "map-outline",
    "onMapReady",
    "statusBoxOff",
    "locationStorageFailed",
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

for (const [relativePath, expectedValues] of Object.entries(checks)) {
  const source = read(relativePath);
  for (const expectedValue of expectedValues) {
    if (!source.includes(expectedValue)) {
      throw new Error(`Missing ${expectedValue} in ${relativePath}`);
    }
  }
}

const en = read("src/i18n/locales/en.ts");
const no = read("src/i18n/locales/no.ts");

const translationKeys = (source) =>
  new Set(
    [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]),
  );

const enKeys = translationKeys(en);
const noKeys = translationKeys(no);
const missingInNorwegian = [...enKeys].filter((key) => !noKeys.has(key));
const missingInEnglish = [...noKeys].filter((key) => !enKeys.has(key));

if (missingInNorwegian.length || missingInEnglish.length) {
  throw new Error(
    `Locale parity failed. Missing in Norwegian: ${missingInNorwegian.join(", ") || "none"}. Missing in English: ${missingInEnglish.join(", ") || "none"}.`,
  );
}

console.log(
  `OK: T1.8E.4.1 checks passed. ${enKeys.size} keys in both locales.`,
);
