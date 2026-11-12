"use strict";
// T1.9X: test round fixes. Time picker in registration, date/time labels, lost above found on the
// home screen, and "Mine kjøp" built from the server orders with plain restore errors.
//   node .\scripts\test-t1-9x.js
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

// 1. Registration: the iOS picker is remounted per mode and the time spinner has a fixed height.
const reg = read("app/(report)/register.tsx");
ok(/key=\{picker\}/.test(reg), "picker remounts when switching date/time");
ok(/timeSpinner: \{ height: 216/.test(reg), "time spinner has a fixed height");
ok(/register\.when\.dateLabel/.test(reg) && /register\.when\.timeLabel/.test(reg), "date and time fields have labels");

// 2. Home: lost tile above found tile, steps on the page.
const home = read("app/(tabs)/index.tsx");
ok(/\{lostTile\}\s*\{foundTile\}/.test(home), "lost above found");
ok(/howCard/.test(home), "steps card on the home screen");

// 3. Mine kjøp: server orders, pilot-free shown, restore errors in plain text.
const screen = read("app/premium-status.tsx");
ok(/fetchMyPurchases\(\)/.test(screen), "purchases come from the server");
ok(/restoreErrorKey\(err\)/.test(screen) && !/err\.message/.test(screen), "no raw store error text");
ok(/purchases\.sectionHistory/.test(screen), "TIDLIGERE section");
ok(/"\/my-purchases"/.test(read("src/lib/reportCommerce.ts")), "client calls /my-purchases");
const mp = requireTs(path.join(root, "src/lib/myPurchases.ts"));
eq(
  ["GEO_ALERT_TIER_2", "LONG_TERM_WATCH_ANNUAL", "LONG_TERM_WATCH_3Y", "REPORT_REACTIVATION", "X"].map(mp.productNameKey),
  ["purchases.areaAlert", "purchases.historicCase", "purchases.historicCase", "purchases.extension", "purchases.otherService"],
  "product names",
);
eq(mp.isFreePurchase({ amountOre: 0 }), true, "0 øre is free");
eq(mp.isFreePurchase({ amountOre: 4900 }), false, "paid");
eq(
  mp.visibleHistory([{ status: "PENDING" }, { status: "FAILED" }, { status: "EXPIRED" }, { status: "refunded" }]).map((x) => x.status),
  ["EXPIRED", "refunded"],
  "unpaid orders are hidden",
);
eq(mp.restoreErrorKey({ code: 16, message: "There was an unknown backend error." }), "purchases.storeNotReady", "code 16");
eq(mp.restoreErrorKey({ message: "Secret API keys should not be used in your app." }), "purchases.storeNotReady", "secret key");
eq(mp.restoreErrorKey({ code: 10, message: "Network error" }), "purchases.restoreNetwork", "network");
eq(mp.restoreErrorKey(new Error("boom")), "purchases.restoreGeneric", "other");

// 4. Texts in both languages.
const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
for (const k of ["register.when.dateLabel", "register.when.timeLabel", "purchases.sectionHistory", "purchases.extension", "purchases.otherService",
  "purchases.expired", "purchases.freeInPilot", "purchases.caseGone", "purchases.storeNotReady", "purchases.restoreNetwork", "purchases.restoreGeneric"])
  ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);

console.log(`OK: T1.9X test round fixes passed (${n} assertions).`);
