"use strict";
const fs = require("fs"),
  p = require("path"),
  r = (f) => fs.readFileSync(p.join(process.cwd(), f), "utf8");
const push = r("app/push-settings.tsx"),
  area = r("app/geo-alert-create.tsx"),
  server = r("server/routes/reportCommerce.js");
if (push.includes('Alert.alert(t("pushSettings.done")'))
  throw Error("Native success alert remains");
// T1.9W: success feedback is an in-screen InlineNotice (tone "success") instead of a custom card.
if (/Alert\.alert/.test(push)) throw Error("Native alert remains on push settings");
for (const v of [
  'tone: "success"',
  "<InlineNotice",
  "pushSettings.enabledSuccessBody",
  "pushSettings.testSuccessBody",
])
  if (!push.includes(v))
    throw Error(`Missing professional push feedback: ${v}`);
for (const v of [
  "areaAlertErrorMessage",
  "areaAlertCreate.testActivationNotAvailable",
  "areaAlertCreate.genericActivationError",
])
  if (!area.includes(v)) throw Error(`Missing area alert error mapping: ${v}`);
if (!area.includes("areaAlertErrorMessage(language, e)"))
  throw Error("Area alert activation still exposes a raw technical error");
for (const v of [
  "geoAlertTestModeAllowed",
  "isGeoAlertOrder",
  "activationAllowed",
])
  if (!server.includes(v))
    throw Error(`Missing geo test activation rule: ${v}`);
const keys = (s) =>
    new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])),
  a = keys(r("src/i18n/locales/en.ts")),
  b = keys(r("src/i18n/locales/no.ts"));
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw Error("Locale parity failed");
console.log(`OK: T1.8E.5B checks passed. ${a.size} keys in both locales.`);
