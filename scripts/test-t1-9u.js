"use strict";
// T1.9U: reviewed item list, match groups, folded colours, item advice, area-alert confirmation
// and a case screen that loads in one go.
//   node .\scripts\test-t1-9u.js
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
const eq = (a, b, label) => {
  assert.deepStrictEqual(a, b, `${label}: got ${JSON.stringify(a)}`);
  n++;
};

const catalog = requireTs(path.join(root, "src/i18n/catalog.ts"));
const migration = read("supabase/migrations/20261103100000_t1_9u_item_list_and_match_groups.sql");
const { LEGACY_ITEM_KEYS, canonicalItemKey } = require(path.join(root, "server/lib/itemKeys.js"));
const colorKeys = require(path.join(root, "server/lib/colorKeys.js"));

// 1. One list of current item keys; the same legacy map in the app, the server and the database.
const itemKeys = new Set();
const entryByKey = new Map();
for (const [cat, list] of Object.entries(catalog.ITEM_CATALOG)) {
  for (const e of list) {
    if (entryByKey.has(e.key)) ok(entryByKey.get(e.key) === e, `${e.key} in ${cat} is the same entry as in its home category`);
    entryByKey.set(e.key, e);
    itemKeys.add(e.key);
  }
}
const sqlMap = Object.fromEntries([...migration.matchAll(/when '([A-Z_]+)' then '([A-Z_]+)'/g)].map((m) => [m[1], m[2]]));
eq(catalog.LEGACY_ITEM_KEYS, { ...LEGACY_ITEM_KEYS }, "app and server legacy maps agree");
eq(sqlMap, { ...LEGACY_ITEM_KEYS }, "database legacy map agrees");
for (const [oldKey, newKey] of Object.entries(LEGACY_ITEM_KEYS)) {
  ok(!itemKeys.has(oldKey), `${oldKey} is no longer in the list`);
  ok(itemKeys.has(newKey), `${oldKey} maps to an existing item (${newKey})`);
}
const updateList = [...migration.slice(migration.indexOf("upper(btrim(subcategory_key)) in (")).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
eq([...new Set(updateList)].sort(), Object.keys(LEGACY_ITEM_KEYS).sort(), "existing reports are moved for every legacy key");
const groupBlock = migration.slice(migration.indexOf("from (values"), migration.indexOf(") as g(level, items)"));
for (const m of groupBlock.matchAll(/'([A-Z_]+)'/g)) ok(itemKeys.has(m[1]), `match group item ${m[1]} exists`);
ok(itemKeys.size >= 195 && itemKeys.size <= 210, `about 200 items after the review (${itemKeys.size})`);
for (const key of ["CARD_HOLDER", "RETAINER", "WALKING_AID", "VAPE", "SMART_RING", "SINGLE_EARBUD", "NECK_GAITER", "HEADBAND", "BLAZER", "SWIMWEAR",
  "KIDS_RAINWEAR", "CHILD_SEAT", "STROLLER_FOOTMUFF", "LICENSE_PLATE", "WHEEL_RIM", "SKATEBOARD", "ICE_SKATES", "HOCKEY_STICK", "BINOCULARS",
  "THERMOS", "YOGA_MAT", "KAYAK_CANOE", "SLED", "INSTRUMENT_CASE", "KEEPSAKE"])
  ok(itemKeys.has(key), `new item ${key}`);
eq(canonicalItemKey(" keychain "), "KEYS", "server maps an old key");
eq(canonicalItemKey("WALLET"), "WALLET", "server keeps a current key");
eq(canonicalItemKey(""), null, "empty key is null");
eq(catalog.itemName("KEYCHAIN", "no"), "Nøkler", "old reports show the new name");
eq(catalog.itemName("WATER_BOTTLE", "en", "CHILDREN_FAMILY"), "Water bottle", "shared item in a second category");
ok(Object.values(catalog.METAL_COMPOUND_NAMES.no).every((byKey) => Object.keys(byKey).every((k) => itemKeys.has(k))), "metal names only for current items");

// 2. Colours: lime, cyan and magenta folded into green, turquoise and pink everywhere.
eq(catalog.LEGACY_COLOR_KEYS, { ...colorKeys.LEGACY_COLOR_KEYS }, "app and server colour maps agree");
const catalogColors = catalog.COLOR_CATALOG.map((c) => c.key);
ok(["lime", "cyan", "magenta"].every((k) => !catalogColors.includes(k) && !colorKeys.COLOR_KEYS.includes(k)), "folded colours are gone");
const constraint = [...migration.match(/secondary_color in \(([\s\S]*?)\)/)[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
eq([...constraint].sort(), [...catalogColors].sort(), "new constraint equals the catalog");
eq([colorKeys.normalizeSecondaryColor("Lime"), colorKeys.normalizeMainColor("magenta"), colorKeys.normalizeMainColor("red")], ["green", "pink", "red"], "server maps old colours");
eq(catalog.colorName("cyan", "no"), "Turkis", "old colour shows the new name");
const sw = requireTs(path.join(root, "src/ui/colorSwatches.ts"));
ok(!sw.ALL_COLOR_KEYS.includes("lime") && !sw.COLOR_SWATCHES.magenta, "swatches follow the catalog");

// 3. Server stores current keys.
const reports = read("server/routes/reports.js");
ok(/patch\.subcategory_key = canonicalItemKey\(input\.subcategory_key\)/.test(reports), "update maps old item keys");
ok(/subcategory_key: canonicalItemKey\(subcategory_key\)/.test(reports), "create maps old item keys");
ok(/patch\.color = normalizeMainColor\(input\.color\)/.test(reports) && /color: normalizeMainColor\(color\)/.test(reports), "main colour is mapped");

// 4. Registration: search shows a shared item once; advice for some items.
const form = requireTs(path.join(root, "src/lib/registerForm.ts"), { "../contexts/ReportDraftContext": {} });
const bottles = form.searchItems("drikkeflaske", "no", 20).filter((h) => h.key === "WATER_BOTTLE");
eq(bottles.length, 1, "shared item appears once in search");
eq(bottles[0].category, "SPORT_OUTDOOR", "shared item is shown in its home category");
ok(form.searchItems("nøkkelknippe", "no")[0].key === "KEYS", "old names are search words");
eq(form.itemHintKey("BICYCLE", "FOUND"), "register.hint.bicycleFound", "frame number advice for a found bike");
eq(form.itemHintKey("E_SCOOTER", "FOUND"), "register.hint.eScooterFound", "rental scooter advice");
eq(form.itemHintKey("MEDICATION", "LOST"), null, "no advice where none is set");
eq(form.itemHintKey("WALLET", "LOST"), null, "most items have no advice");
const body = form.reportBody(
  { type: "LOST", category: "PERSONAL", subcategoryKey: "KEYCHAIN", color: "black", location: { latitude: 1, longitude: 1, radiusMeters: 100 } },
  { language: "no", rewardEnabled: false, clientRequestId: "report-1234567890" },
);
eq(body.subcategory_key, "KEYS", "a draft with an old key sends the new key");
const reg = read("app/(report)/register.tsx");
ok(/itemHintKey\(draft\.subcategoryKey, type\)/.test(reg) && /t\(hintKey\)/.test(reg), "registration shows the advice");

// 5. Texts exist in both languages.
const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
const keys = [...read("src/lib/registerForm.ts").matchAll(/"(register\.hint\.[A-Za-z]+)"/g)].map((m) => m[1]);
keys.push("caseDetail.next.eyebrowNews", "caseDetail.next.eyebrowSuggestion", "caseDetail.next.eyebrowStatus", "areaAlertCreate.sentTitle", "areaAlertCreate.sentBody");
for (const k of new Set(keys)) ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);
ok(!/"caseDetail\.next\.eyebrow":/.test(no + en), "old Neste steg label removed");

// 6. Case screen and area-alert screen.
const detail = read("app/report-details/[id].tsx");
ok(/Promise\.all\(\[activityPromise, geoPromise\]\)/.test(detail), "case, timeline and area-alert status load together");
ok(detail.indexOf("setActivityReady(true)") < detail.indexOf("if (!quiet) setLoading(false)"), "screen shows after the timeline is in");
ok(/t\(stepEyebrowKey\(step\)\)/.test(detail), "card label depends on the card");
const activity = requireTs(path.join(root, "src/lib/reportActivity.ts"), {
  "./supabase": { supabase: {} },
  "./config": { API_BASE_URL: "" },
});
eq(
  [
    activity.stepEyebrowKey({ kind: "historic", action: null }),
    activity.stepEyebrowKey({ kind: "historicOffer", action: "longTerm" }),
    activity.stepEyebrowKey({ kind: "matches", action: "openMatches" }),
  ],
  ["caseDetail.next.eyebrowStatus", "caseDetail.next.eyebrowSuggestion", "caseDetail.next.eyebrowNews"],
  "labels",
);
const area = read("app/geo-alert-create.tsx");
const success = area.indexOf("if (activatedUntil) {");
ok(success > 0 && success < area.indexOf("areaAlertCreate.calculate.reach.and.price"), "after activation the form is replaced by a confirmation");

console.log(`OK: T1.9U item list, colours, advice and screen checks passed (${n} assertions).`);
