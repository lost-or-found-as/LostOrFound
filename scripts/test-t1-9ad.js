"use strict";
// T1.9AD: the server no longer exposes /__whoami or the old Stripe /payment-sheet route, and it
// starts without STRIPE_SECRET_KEY.
//   node .\scripts\test-t1-9ad.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
const code = src.replace(/\/\/.*$/gm, "");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};
ok(!/__whoami/.test(code), "no /__whoami route");
ok(!/payment-sheet/.test(code), "no /payment-sheet route");
ok(!/require\("stripe"\)/.test(code) && !/STRIPE_SECRET_KEY/.test(code), "server does not need Stripe to start");
ok(/app\.get\("\/", /.test(code), "health check stays");
console.log(`OK: T1.9AD server clean-up passed (${n} assertions).`);
