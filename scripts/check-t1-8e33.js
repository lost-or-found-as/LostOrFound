"use strict";

const fs = require("fs");
const path = require("path");

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

const app = read("app/my-reports.tsx");
const en = read("src/i18n/locales/en.ts");
const no = read("src/i18n/locales/no.ts");

const requiredAppFeatures = [
  "reactivationSuccessOpen",
  "setReactivationSuccessOpen(true)",
  // T1.9W: shown as a success InlineNotice (was a Modal with successStyles).
  'tone="success"',
  "cases.reactivation.success.close",
];

for (const feature of requiredAppFeatures) {
  if (!app.includes(feature)) {
    throw new Error(`Missing feature: ${feature}`);
  }
}

const obsoleteNativeAlert =
  'Alert.alert(\n        t("cases.reactivation.success.title")';

if (app.includes(obsoleteNativeAlert)) {
  throw new Error("Native reactivation success alert remains");
}

const requiredLocaleKeys = [
  "cases.reactivation.success.title",
  "cases.reactivation.success.body",
  "cases.reactivation.success.close",
];

for (const key of requiredLocaleKeys) {
  if (!en.includes(`"${key}"`) || !no.includes(`"${key}"`)) {
    throw new Error(`Missing locale key: ${key}`);
  }
}

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
  `OK: T1.8E.3.3 checks passed. ${enKeys.size} keys in both locales.`,
);
