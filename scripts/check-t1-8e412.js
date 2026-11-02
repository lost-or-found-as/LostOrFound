"use strict";
const fs = require("fs"),
  p = require("path"),
  r = (f) => fs.readFileSync(p.join(process.cwd(), f), "utf8");
const app = r("app/alert-areas.tsx"),
  server = r("server/routes/alertAreas.js"),
  en = r("src/i18n/locales/en.ts"),
  no = r("src/i18n/locales/no.ts");
for (const v of [
  "current?.active &&",
  'accessibilityLabel={t("alertAreas.notifyWhereIAm")}',
  "mapCard: {",
  "statusBoxOff: {",
])
  if (!app.includes(v)) throw Error(`Missing app feature: ${v}`);
for (const v of [
  '.from("notification_watch_areas")',
  ".insert({ ...values, user_id: req.user.id })",
  ".update(values)",
  'source_type: "CURRENT_LOCATION"',
])
  if (!server.includes(v)) throw Error(`Missing backend feature: ${v}`);
if (server.includes('rpc("upsert_current_location_watch_area_v2"'))
  throw Error("Obsolete RPC remains");
const ks = (s) =>
    new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])),
  a = ks(en),
  b = ks(no);
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw Error("Locale parity failed");
console.log(`OK: T1.8E.4.1.2 checks passed. ${a.size} keys in both locales.`);
