// scripts/test-t1-9af.js
// T1.9AF: the old "Lost Plus" subscription code is gone. The app sells one-time services per case
// through RevenueCat (src/lib/storePurchases.ts); no subscription, offering or entitlement code is left,
// and the unused Stripe payment-intent helper and the old hard-coded Supabase config are gone.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

for (const f of [
  "src/lib/revenueCatService.ts",
  "src/lib/revenueCatIntegration.ts",
  "src/lib/revenueCatAccess.ts",
  "src/lib/revenueCatConfig.ts",
  "src/hooks/useRevenueCatState.ts",
  "src/lib/stripeConfig.ts",
  "src/lib/billingCatalog.ts",
  "src/lib/monetization.ts",
  "src/lib/payments.ts",
  "src/lib/supabaseConfig.ts",
]) ok(!fs.existsSync(path.join(root, f)), `REMOVED_FILE_PRESENT: ${f}`);

for (const f of ["src/lib/storePurchases.ts", "src/lib/revenueCatInit.ts", "src/lib/revenueCatEnv.ts"])
  ok(fs.existsSync(path.join(root, f)), `STORE_FILE_MISSING: ${f}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const rel = path.relative(root, f);
  ok(!/Lost Plus|lost_plus|getOfferings|"premium\./.test(text), `LOST_PLUS_LEFT: ${rel}`);
}

const keys = (f) => new Set([...fs.readFileSync(path.join(root, f), "utf8").matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
const no = keys("src/i18n/locales/no.ts");
const en = keys("src/i18n/locales/en.ts");
ok([...no].every((k) => en.has(k)) && [...en].every((k) => no.has(k)), "locale key parity");

console.log(`OK: T1.9AF checks passed (${n} assertions).`);
