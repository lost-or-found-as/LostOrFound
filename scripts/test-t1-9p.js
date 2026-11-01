"use strict";
// T1.9P: delete the account from the app.
//   node .\scripts\test-t1-9p.js
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

const reports = read("server/routes/reports.js");
ok(/async function deleteOwnedReport\(reportId, userId\)/.test(reports), "report deletion is shared");
ok(/router\.delete\("\/:id", requireUser, async \(req, res\) => \{\s*const result = await deleteOwnedReport\(req\.params\.id, req\.user\.id\);/.test(reports), "Slett sak uses the shared deletion");
ok(/module\.exports\.deleteOwnedReport = deleteOwnedReport;/.test(reports), "exported for account deletion");
ok(!/\bres\.(json|status)\(/.test(reports.slice(reports.indexOf("async function deleteOwnedReport"), reports.indexOf('router.delete("/:id"'))), "shared deletion never answers the request itself");
ok(/\.eq\("report_id", reportId\)[\s\S]{0,200}if \(Number\(orderCount \|\| 0\) > 0\)/.test(reports), "reports with purchases are kept archived");

const account = read("server/routes/account.js");
ok(/router\.delete\("\/", requireUser,/.test(account), "DELETE /account for registered accounts");
ok(/deleteOwnedReport\(r\.id, userId\)[\s\S]*supaAdmin\.auth\.admin\.deleteUser\(userId\)/.test(account), "reports first, then the sign-in");
ok(/return res\.status\(500\)\.json\(\{ error: "ACCOUNT_DELETE_FAILED" \}\);[\s\S]*deleteUser/.test(account), "a failed report stops before the account is deleted");
for (const t of ["notifications", "report_creation_events"]) ok(account.includes(`table: "${t}"`), `${t} cleaned up`);

const profile = read("app/(tabs)/profile.tsx");
ok(/!!user && !isGuest && \([\s\S]{0,200}profile\.deleteAccount\.button/.test(profile), "Slett konto in Profil for accounts");
ok(/<ConfirmSheet[\s\S]{0,120}profile\.deleteAccount\.title[\s\S]{0,300}destructive/.test(profile), "asks before deleting");
ok(/await deleteAccountRequest\(\);[\s\S]{0,120}await signOut\(\)/.test(profile), "signs out afterwards");
for (const lang of ["no", "en"]) ok(read(`src/i18n/locales/${lang}.ts`).includes('"profile.deleteAccount.body"'), `${lang} text`);

console.log(`OK: T1.9P checks passed (${n} assertions).`);
