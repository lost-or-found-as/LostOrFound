// scripts/test-t1-9be.js
// T1.9BE: a database failure while reading a case is a logged server fault with a stable code,
// database faults answered as 400 are logged and reported, and error codes show in every build.
//   node .\scripts\test-t1-9be.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const { isDatabaseFault } = require(path.join(root, "server/lib/sentry.js"));
ok(isDatabaseFault(400, { error: "column report_images.moderation_status does not exist" }), "missing column is a fault");
ok(isDatabaseFault(400, { error: "Could not find the 'custody' column of 'reports' in the schema cache" }), "schema cache is a fault");
ok(!isDatabaseFault(400, { error: "INVALID_CUSTODY" }), "bad input is not a fault");
ok(!isDatabaseFault(404, { error: "Report not found" }), "not found is not a fault");
ok(!isDatabaseFault(500, { error: "column x does not exist" }), "500 is handled by the normal path");

const reports = read("server/routes/reports.js");
ok(/function loadFailed\(res, step, error\) \{[\s\S]*?console\.error[\s\S]*?status\(500\)\.json\(\{ error: "REPORT_LOAD_FAILED", step \}\)/.test(reports), "loadFailed logs and answers 500");
ok(/if \(rErr\) return loadFailed\(res, "report", rErr\);/.test(reports), "report read uses loadFailed");
ok(/if \(result\.error\) return loadFailed\(res, step, result\.error\);/.test(reports), "extra reads use loadFailed");
ok(/images: imagesResult/.test(reports) && /observations: observationsResult/.test(reports), "each step is named");

const sentry = read("server/lib/sentry.js");
ok(/console\.error\(`\[db-fault\]/.test(sentry), "db fault is logged even without Sentry");

const ue = read("src/lib/userError.ts");
ok(/const SHOW_ERROR_CODES = true;/.test(ue), "codes shown in every build");
ok(ue.includes("/^[A-Z][A-Z0-9_.:-]*$/"), "only constant-style codes are shown");
const details = read("app/report-details/[id].tsx");
ok(/withTestCode\(t\("caseDetail\.could\.not\.load\.case"\), loadError\?\.code\)/.test(details), "case screen shows the code");
ok(/import \{ userErrorMessage, withTestCode \}/.test(details), "helper imported");

console.log(`T1.9BE OK (${n} checks)`);
