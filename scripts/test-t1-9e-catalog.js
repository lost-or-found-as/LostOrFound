"use strict";
// T1.9E behavior test: the language layer.
//  - every catalog entry (category, item, colour) has a name in every app language
//  - distances follow the device unit, money uses the stored currency, times are translated
//  - known error codes become translated text; unknown errors get the fallback and go to Sentry
//   node .\scripts\test-t1-9e-catalog.js

const { runTsModules, I18N_MODULES, EXPO_LOCALIZATION_STUB } = require("./lib/ts-modules");

const SENTRY_STUB = `
export const reported = [];
export function init() {}
export function withScope(fn) { fn({ setTag() {}, setLevel() {}, setFingerprint() {} }); }
export function captureException(e) { reported.push(e); }
export function captureMessage() {}
export function flush() { return Promise.resolve(true); }
export function wrap(c) { return c; }
export function reactNavigationIntegration() { return {}; }
`;

const runner = `
import assert from "node:assert";
import { SUPPORTED_LANGUAGES, translate } from "@/src/i18n/translate";
import { CATEGORY_CATALOG, ITEM_CATALOG, COLOR_CATALOG, METAL_COMPOUND_NAMES, categoryName, itemName, colorName, itemSearchText } from "@/src/i18n/catalog";
import { formatDistance, formatMoney, formatTimeAgo, formatArea } from "@/src/i18n/formatters";
import { knownErrorKey, userErrorMessage, codedError } from "@/src/lib/userError";
import { reported } from "@sentry/react-native";

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n++; };
const eq = (got, want, label) => { assert.strictEqual(got, want, label + ": got " + JSON.stringify(got)); n++; };

// Catalog completeness.
const lists = { category: CATEGORY_CATALOG, colour: COLOR_CATALOG, ...Object.fromEntries(Object.entries(ITEM_CATALOG).map(([k, v]) => ["items " + k, v])) };
const missing = [];
const seen = new Map();
for (const [listName, list] of Object.entries(lists)) {
  for (const e of list) {
    for (const lang of SUPPORTED_LANGUAGES) if (!String(e.names?.[lang] ?? "").trim()) missing.push(listName + "/" + e.key + "/" + lang);
    if (listName.startsWith("items")) {
      ok(!seen.has(e.key), "item key " + e.key + " appears in both " + seen.get(e.key) + " and " + listName);
      seen.set(e.key, listName);
    }
  }
}
eq(missing.join(", "), "", "every catalog entry has a name in every language");
for (const cat of Object.keys(ITEM_CATALOG)) ok(CATEGORY_CATALOG.some((c) => c.key === cat), "item category " + cat + " exists");
for (const byMetal of Object.values(METAL_COMPOUND_NAMES)) for (const items of Object.values(byMetal)) for (const key of Object.keys(items)) ok(seen.has(key), "metal compound item " + key + " exists");
ok(Object.keys(ITEM_CATALOG).length === CATEGORY_CATALOG.length, "every category has items");

// Catalog lookups.
eq(categoryName("PERSONAL", "en"), "Personal belongings", "category EN");
eq(itemName("KEYS", "no", "PERSONAL"), "Nøkler", "item NO");
eq(itemName("KEYS", "en"), "Keys", "item EN without category");
eq(colorName("grey", "en"), "Gray", "old colour spelling");
eq(colorName("navy", "no"), "Mørkeblå", "colour NO");
eq(itemName("SOME_NEW_KEY", "en"), "Some new key", "unknown key is readable");
ok(/nøkler/.test(itemSearchText("KEYS")) && /keys/.test(itemSearchText("KEYS")), "search text has both languages");

// Formatting.
const t = (lang) => (k, p) => translate(lang, k, p);
eq(formatDistance(350, "no", t("no"), "metric"), "350 m", "metres");
eq(formatDistance(1500, "no", t("no"), "metric"), "1,5 km", "km NO decimal comma");
eq(formatDistance(1500, "en", t("en"), "metric"), "1.5 km", "km EN decimal point");
eq(formatDistance(1609.344 * 3, "en", t("en"), "imperial"), "3 mi", "miles");
eq(formatDistance(100, "en", t("en"), "imperial"), "328 ft", "feet");
globalThis.__measurementSystem = "us";
eq(formatDistance(1609.344, "no", t("no")), "1 miles", "device setting picks miles");
globalThis.__measurementSystem = "metric";
eq(formatArea(7070000, "no", t("no"), "metric"), "7,07 km²", "area");
ok(/99/.test(formatMoney(99, "NOK", "no")) && /kr/.test(formatMoney(99, "NOK", "no")), "money NOK in Norwegian");
ok(/NOK|kr/.test(formatMoney(99, "NOK", "en")) && /99/.test(formatMoney(99, "NOK", "en")), "money NOK in English");
ok(/,50/.test(formatMoney(149.5, "NOK", "no")), "decimals only when needed");
eq(formatTimeAgo(new Date(Date.now() - 5 * 60000), t("no")), "5 min", "short time NO");
eq(formatTimeAgo(new Date(Date.now() - 3 * 3600000), t("en"), "long"), "3 h ago", "long time EN");
eq(formatTimeAgo(new Date(Date.now() - 400 * 86400000), t("no"), "long"), "1 år siden", "years NO");

// Errors.
eq(knownErrorKey({ code: "invalid_credentials", message: "Invalid login credentials" }), "errors.auth.invalidCredentials", "Supabase code");
eq(knownErrorKey(new Error("Invalid login credentials")), "errors.auth.invalidCredentials", "Supabase message");
eq(knownErrorKey(new Error("GUEST_NOT_ALLOWED")), "errors.guestNotAllowed", "server code in message");
eq(knownErrorKey({ error: "Report not found" }), "errors.notFound", "plain server text");
eq(knownErrorKey(new TypeError("Network request failed")), "errors.networkBody", "network");
eq(knownErrorKey(codedError("NETWORK_TIMEOUT")), "errors.timeout", "timeout");
eq(knownErrorKey({ status: 503 }), "errors.serviceBody", "5xx");
eq(knownErrorKey(codedError("EMAIL_PASSWORD_REQUIRED")), "errors.auth.emailPasswordRequired", "app code");
eq(userErrorMessage(new Error("Invalid login credentials"), t("no"), "errors.generic"), "Feil e-post eller passord.", "translated to Norwegian");
const before = reported.length;
eq(userErrorMessage(new Error("Something odd: x=1"), t("en"), "errors.generic"), "Something went wrong. Please try again.", "unknown error gets fallback");
eq(reported.length, before, "Sentry is off in tests, nothing captured");
eq(userErrorMessage(new Error("weird"), t("no"), "errors.generic", null), "Noe gikk galt. Prøv igjen.", "null area skips reporting");

console.log("OK: T1.9E language layer tests passed (" + n + " assertions).");
`;

const ok = runTsModules({
  files: [...I18N_MODULES, "src/lib/userError.ts", "src/lib/sentry.ts"],
  stubs: { "expo-localization": EXPO_LOCALIZATION_STUB, "@sentry/react-native": SENTRY_STUB },
  runner,
  prefix: "lof-language-",
});
process.exit(ok ? 0 : 1);
