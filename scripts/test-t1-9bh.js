// scripts/test-t1-9bh.js
// T1.9BH: the case map (form preview and case screen) draws the search areas instead of one
// circle; each count on the Home card opens what it counts.
//   node .\scripts\test-t1-9bh.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const shapes = read("src/ui/SearchAreaShapes.tsx");
ok(/export function usableAreas/.test(shapes) && /export function areasRegion/.test(shapes) && /export function SearchAreaShapes/.test(shapes), "shared shapes");
ok(/<Polyline/.test(shapes) && /<Polygon/.test(shapes) && /<Circle/.test(shapes), "all three kinds drawn");

const reg = read("app/(report)/register.tsx");
ok(/type === "LOST" && usableAreas\(draft\.searchAreas\)\.length > 0/.test(reg), "form preview uses the areas");
ok(/<SearchAreaShapes areas=\{usableAreas\(draft\.searchAreas\)\} \/>/.test(reg), "form preview draws them");

const det = read("app/report-details/[id].tsx");
ok(/const areas = lost \? usableAreas\(\(r as any\)\.search_areas\) : \[\];/.test(det), "case screen reads the areas");
ok(/areasMapRegion \? <SearchAreaShapes areas=\{areas\} \/>/.test(det), "case screen draws them");
ok(/caseDetail\.areasCount/.test(det), "count instead of radius");

const home = read("app/(tabs)/index.tsx");
ok(/onPress=\{\(\) => router\.push\("\/my-reports"\)\} \/>/.test(home), "active opens My cases");
ok(/openReportMatches\(summary\.matchesReportId\)/.test(home) && /openReportMatches\(summary\.unreadReportId\)/.test(home), "matches and messages open the case");
ok(/accessibilityRole="button"\s*accessibilityLabel=\{`\$\{value\} \$\{label\}`\}/.test(home), "counts are buttons");
const sum = read("src/lib/homeSummary.ts");
ok(/unreadReportId,\s*matchesReportId: onlyReportWithMatches,/.test(sum), "summary names the cases");

for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"]) ok(read(f).includes('"caseDetail.areasCount"'), `text in ${f}`);
console.log(`T1.9BH OK (${n} checks)`);
