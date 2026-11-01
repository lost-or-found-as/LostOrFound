"use strict";
// T1.9Q: colours in rainbow order; one row of quick choices for when (no precision bar).
//   node .\scripts\test-t1-9q.js
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

const sw = requireTs(path.join(root, "src/ui/colorSwatches.ts"), {});
const catalog = read("src/i18n/catalog.ts");
const block = catalog.slice(catalog.indexOf("export const COLOR_CATALOG"), catalog.indexOf("];", catalog.indexOf("export const COLOR_CATALOG")));
const keys = [...block.matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
ok(sw.ALL_COLOR_KEYS.length === keys.length && keys.every((k) => sw.ALL_COLOR_KEYS.includes(k)), "Flere farger shows every catalog colour once");
ok(new Set(sw.ALL_COLOR_KEYS).size === sw.ALL_COLOR_KEYS.length, "no colour twice");
ok(sw.COMMON_COLOR_KEYS.join(",") === "red,orange,yellow,green,blue,purple,pink,brown,black,gray,white", "common colours in rainbow order, neutrals last");
const order = (k) => sw.ALL_COLOR_KEYS.indexOf(k);
ok(order("navy") === order("blue") + 1 && order("light-blue") === order("blue") - 1 && order("burgundy") === order("red") - 1, "similar colours sit together");
for (const k of [...sw.COMMON_COLOR_KEYS, ...sw.ALL_COLOR_KEYS]) ok(!!sw.COLOR_SWATCHES[k], `swatch for ${k}`);

const reg = read("app/(report)/register.tsx");
ok(/allColors \? ALL_COLOR_KEYS : COMMON_COLOR_KEYS/.test(reg), "registration uses the ordered list");
ok(!/s\.segment|register\.when\.precision|register\.when\.yesterday/.test(reg), "no precision bar and no I går");
ok(/accessibilityState=\{\{ selected: precision === "YEAR" \}\}[\s\S]{0,400}setDate\(d, "YEAR"\)/.test(reg), "Mer enn ett år siden switches to year only");
ok(/"register\.when\.longAgo":\s*"Mer enn ett år siden"/.test(read("src/i18n/locales/no.ts")), "Norwegian label");

console.log(`OK: T1.9Q checks passed (${n} assertions).`);
