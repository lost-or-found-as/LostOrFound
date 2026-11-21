// scripts/test-t1-9bf.js
// T1.9BF: wide recipient ranges, what bonus is for, nearby notices headed by the item,
// «Mark all as read» under the title, and the area-alert info says «roughly».
//   node .\scripts\test-t1-9bf.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const p = require(path.join(root, "server/lib/geoAlertPricing.js"));
const band = (c) => { const b = p.recipientBand(c); return [b.kind, b.min ?? null, b.max ?? null]; };
eq(band(0), ["NONE", null, null], "none");
eq(band(9), ["FEW", null, null], "few");
eq(band(10), ["ABOUT", 10, 50], "10 is 10–50");
eq(band(37), ["ABOUT", 10, 50], "37 is 10–50");
eq(band(50), ["ABOUT", 50, 100], "50 is 50–100");
eq(band(249), ["ABOUT", 100, 250], "249 is 100–250");
eq(band(499), ["ABOUT", 250, 500], "499 is 250–500");
eq(band(5000), ["ABOUT", 500, null], "large is over 500");
ok(typeof p.recipientBand(37).value === "number", "old builds still get a value");

const preview = read("src/lib/geoAlertPreview.ts");
ok(/export function recipientRange/.test(preview) && /export function rangeText/.test(preview), "app helpers");
ok(/rangeText\(result\.quote\.recipients, t, "areaAlertCreate\.recipients\.range", "areaAlertCreate\.recipients\.over"\)/.test(read("app/geo-alert-create.tsx")), "alert screen shows a range");
ok(/rangeText\(quote\.recipients, t, "areaVisibility\.followersRange", "areaVisibility\.followersOver"\)/.test(read("app/area-visibility-create.tsx")), "visibility screen shows a range");

const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
for (const key of ["areaAlertCreate.recipients.range", "areaAlertCreate.recipients.over", "areaVisibility.followersRange", "areaVisibility.followersOver", "bonus.useTitle", "bonus.use.extend", "bonus.use.reopen", "bonus.use.visibility", "bonus.useNot", "notifications.nearbyHeading"]) {
  ok(no.includes(`"${key}"`) && en.includes(`"${key}"`), `${key} in both languages`);
}
ok(/omtrent hvor mange som får varselet/.test(no) && /roughly how many people get the alert/.test(en), "info says roughly");

const bonus = read("app/bonus.tsx");
ok(/\["extend", "reopen", "visibility"\]/.test(bonus) && /t\("bonus\.useNot"\)/.test(bonus), "bonus use card");

const notes = read("app/notifications.tsx");
ok(/const itemFirst = selectedTab === "nearby" && !!fullCaseLabel;/.test(notes), "nearby card headed by the item");
ok(/t\("notifications\.nearbyHeading"\)/.test(notes), "heading once above the list");
ok(!/headerRight}>\s*\{unreadCount/.test(notes), "mark all read moved out of the header");

console.log(`T1.9BF OK (${n} checks)`);
