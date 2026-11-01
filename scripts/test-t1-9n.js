"use strict";
// T1.9N: registration polish — "Nå" for found items, map before a place is chosen,
// confirmation with the first matches after a case is registered.
//   node .\scripts\test-t1-9n.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};

const reg = read("app/(report)/register.tsx");
ok(/type === "FOUND" && \([\s\S]{0,200}setDate\(new Date\(\), "EXACT"\)[\s\S]{0,120}register\.when\.now/.test(reg), "Nå sets date and time now for found items");
ok(/getForegroundPermissionsAsync\(\)[\s\S]{0,80}if \(!permission\.granted\) return;/.test(reg), "the form never asks for location by itself");
ok(/region=\{here \? \{ \.\.\.here, latitudeDelta: 0\.02, longitudeDelta: 0\.02 \} : NORWAY_REGION\}/.test(reg), "map shows the phone's position, else Norway");
ok(/params: \{ id: reportId, created: "1" \}/.test(reg), "a registered case opens with the confirmation");

const det = read("app/report-details/[id].tsx");
ok(/useState\(created === "1"\)/.test(det) && /visible=\{createdOpen && activityReady\}/.test(det), "confirmation waits for the matches");
ok(/caseDetail\.created\.matches", \{ count: activity\.summary\.possibleMatches \}/.test(det), "shows the number of matches");
ok((det.match(/router\.setParams\(\{ created: undefined \}\)/g) || []).length >= 3, "confirmation shows once");

for (const lang of ["no", "en"]) {
  const loc = read(`src/i18n/locales/${lang}.ts`);
  for (const key of ["register.when.now", "caseDetail.created.title", "caseDetail.created.matches_one", "caseDetail.created.noneBodyFound"])
    ok(loc.includes(`"${key}"`), `${lang} ${key}`);
}

console.log(`OK: T1.9N checks passed (${n} assertions).`);
