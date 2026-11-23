// scripts/test-t1-9bk.js
// T1.9BK: a solved observation never asks again; solved cases say «Løst»; a find from an area
// alert that is given back is a return (15); waiting bonus says when; test accounts can test the
// bonus; the created sheet offers «Synlig i nærheten» too.
//   node .\scripts\test-t1-9bk.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

let bonus = null;
try { bonus = require(path.join(root, "server/lib/helperBonus.js")); } catch { /* server packages missing here */ }
if (bonus) {
  const env = { HELPER_BONUS_TEST_USER_IDS: "a, b" };
  ok(bonus.bonusTestPair("a", "b", env) && !bonus.bonusTestPair("a", "c", env) && !bonus.bonusTestPair("a", "b", {}), "test pair only when both are listed");
}
const hb = read("server/lib/helperBonus.js");
ok(/counterpartUserId && !testPair && \(await sharedDevice/.test(hb) && /counterpartUserId && !testPair && PAIR_EVENTS\.has/.test(hb) && /caseReportId && !testPair && CASE_AGE_EVENTS/.test(hb), "test pair skips device, pair and age");
ok(/nextPendingAt,\s*pendingReturns,/.test(hb), "summary says when and how many returns wait");

// T1.9BP: the bonus rules moved to lib/resolutionCore.js.
const res = read("server/routes/resolutions.js") + read("server/lib/resolutionCore.js");
ok(/observation_type==="FOUND"\?"RETURN_CONFIRMED":"SIGHTING_RESOLVED"/.test(res.replace(/\s/g, "").replace('String(p.observation?.observation_type||"").toUpperCase()', "observation_type")), "found and returned is a return");
ok(/campaign_id,observation_type"\)/.test(res), "type loaded");

const act = read("server/routes/reportsActivity.js");
ok(/for \(const rep of reps\) rep\.resolved = solved\.has\(rep\.id\);/.test(act), "solved flag");
ok(/\.eq\("status", "ACCEPTED"\)/.test(act) && /\.eq\("status", "CONFIRMED"\)/.test(act), "both ways of solving");

const hook = read("src/lib/observationResolution.ts");
ok(/useFocusEffect\(\s*useCallback\(\(\) => \{\s*void reload\(\);/.test(hook), "reloads on focus");
ok(/includes\("PROPOSAL_NOT_FOUND"\)\) \{\s*await reload\(\);\s*return;/.test(hook), "already answered shows the current state");
ok(/void load\(true\);/.test(read("app/observation/[id].tsx")), "observation reloads quietly on focus");

const my = read("app/my-reports.tsx");
ok(/solved\s*\? t\("cases\.resolved"\)/.test(my) && /solved \? "active"/.test(my), "Løst in green");
const b = read("app/bonus.tsx");
ok(/bonus\.pendingFrom/.test(b) && /bonus\.pendingReturns/.test(b), "waiting bonus explained");
ok(/openVisibility\(\);/.test(read("app/report-details/[id].tsx")) && /caseDetail\.created\.visibilityOnly/.test(read("app/report-details/[id].tsx")), "created sheet offers visibility");
for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["cases.resolved", "bonus.pendingFrom", "bonus.pendingReturns", "caseDetail.created.visibilityOnly"]) ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
console.log(`T1.9BK OK (${n} checks)`);
