// scripts/test-t1-9at.js
// T1.9AT: fixes from the first phone test of expo-58 (19.11.2026).
//   node .\scripts\test-t1-9at.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "app/(report)/register.tsx"), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// 1. The missing-fields list follows the form once it is shown.
ok(/useEffect\(\(\) => \{\s*setMissing\(\(prev\) => \(prev\.length \? missingFields\(draft, rewardEnabled\) : prev\)\);\s*\}, \[draft, rewardEnabled\]\);/.test(src),
  "missing list is recomputed when the draft changes");
ok(/const submit = async[\s\S]*?const list = missingFields\(draft, rewardEnabled\);\s*setMissing\(list\);/.test(src), "Send still sets the list");

// 2. Brand is not asked for animals and never filled from a photo for them.
ok(/\{!animal && \(\s*<View style=\{s\.field\}>\s*<Text style=\{s\.label\}>\s*\{t\("register\.details\.brand"\)\}/.test(src), "brand field hidden for animals");
ok(/suggestion\?\.brand && !isAnimal\(draft\.category, draft\.subcategoryKey\)/.test(src), "photo suggestion never fills brand for animals");

// 3. Poster: a toolbar with a print hint on screen, hidden when printed; a sheet with margins on phones.
const poster = fs.readFileSync(path.join(root, "server/lib/sharePage.js"), "utf8");
ok(/<div class="bar"><p>\$\{esc\(message\(lang, "share\.posterHint"\)\)\}<\/p><button class="print"/.test(poster), "print button sits in a toolbar with a hint");
ok(/@media print\{\.bar\{display:none\}\}/.test(poster) && !/position:fixed/.test(poster), "toolbar hidden on paper; no floating button over the poster");
ok(/@media screen\{body\{background:#E5E7EB\}\.page\{background:#FFFFFF;margin:0 12px 24px/.test(poster), "poster shown as a sheet with margins on screen");
for (const l of ["no", "en", "de"]) ok(!!require(path.join(root, `server/locales/${l}.json`))["share.posterHint"], `posterHint in ${l}`);

// 4. New sightings: opening marks them seen; the case card counts the unseen ones.
const obs = fs.readFileSync(path.join(root, "server/routes/observations.js"), "utf8");
ok(/report_owner_user_id===userId&&q\.data\.status==="NEW"\)\{const a=await supaAdmin\.from\("area_alert_observations"\)\.update\(\{status:"ACKNOWLEDGED"/.test(obs), "owner opening a sighting marks it seen");
const act = fs.readFileSync(path.join(root, "server/routes/reportsActivity.js"), "utf8");
ok(/\.eq\("report_owner_user_id", user\.id\)\s*\.eq\("status", "NEW"\)/.test(act) && (act.match(/newObservations/g) || []).length >= 4, "my cases returns unseen sightings per case");
const cases = fs.readFileSync(path.join(root, "app/my-reports.tsx"), "utf8");
ok(/newObs > 0 &&[\s\S]*t\("cases\.newObservations", \{ count: newObs \}\)/.test(cases), "case card shows new sightings");
const detail = fs.readFileSync(path.join(root, "app/observation/[id].tsx"), "utf8");
ok(/status === "NEW" \|\| status === "ACKNOWLEDGED"/.test(detail), "seen-but-unrated shows as new, never the raw status");

console.log(`OK: T1.9AT phone-test fixes passed (${n} assertions).`);
