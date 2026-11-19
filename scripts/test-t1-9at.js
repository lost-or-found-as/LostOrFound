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

console.log(`OK: T1.9AT phone-test fixes passed (${n} assertions).`);
