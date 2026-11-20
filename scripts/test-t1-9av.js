// scripts/test-t1-9av.js
// T1.9AV: test accounts without the daily photo-analysis limit.
//   node .\scripts\test-t1-9av.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const lib = require(path.join(root, "server/lib/imageAnalysis.js"));
const route = fs.readFileSync(path.join(root, "server/routes/imageAnalysis.js"), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const env = { IMAGE_ANALYSIS_UNLIMITED_USER_IDS: " u-1 , u-2,," };
ok(lib.unlimitedUser("u-1", env) && lib.unlimitedUser("u-2", env), "listed accounts are unlimited");
ok(!lib.unlimitedUser("u-3", env), "other accounts keep the limit");
ok(!lib.unlimitedUser("u-1", {}), "empty list: nobody is unlimited");
ok(!lib.unlimitedUser("", env) && !lib.unlimitedUser(null, env), "no user id: not unlimited");
ok(!lib.unlimitedUser("u", env), "no partial matches");
ok(/if \(isGuest \|\| !analysis\.unlimitedUser\(userId\)\) \{/.test(route), "guests always keep the limit");
ok(route.indexOf("analysisEnabled()") < route.indexOf("unlimitedUser"), "the switch is still checked first");
assert.deepStrictEqual(lib.DAILY_LIMIT, { account: 10, guest: 3 }); n++;

console.log(`T1.9AV OK (${n} checks)`);
