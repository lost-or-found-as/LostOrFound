"use strict";
// T1.9R: public privacy policy and terms, links in the app, consent before purchases,
// nightly deletion of handled chat reports after 12 months.
//   node .\scripts\test-t1-9r.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};

// 1. Pages.
for (const doc of ["privacy", "terms"])
  for (const lang of ["no", "en"]) {
    const page = read(`server/legal/${doc}.${lang}.html`);
    ok(!/\[[^\]]*\]/.test(page), `${doc}.${lang}: no placeholders left`);
    ok(page.includes("938 439 877") && page.includes("admin@lostorfound.app"), `${doc}.${lang}: company and contact`);
    ok(page.includes('name="viewport"') && page.includes(`lang="${lang === "no" ? "nb" : "en"}"`), `${doc}.${lang}: mobile and language`);
  }
ok(/12 måneder etter at de er behandlet/.test(read("server/legal/privacy.no.html")), "privacy promises 12 months for reports");
ok(/Profil → Slett konto/.test(read("server/legal/privacy.no.html")), "privacy explains account deletion");

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "express") return { Router: () => ({ get() {} }) };
  return realLoad.call(this, request, parent, isMain);
};
const legal = require(path.join(root, "server", "routes", "legal.js"));
Module._load = realLoad;
const pick = legal.pickLanguage;
ok(pick("no", "en") === "no" && pick("en", "nb-NO") === "en", "?lang wins");
ok(pick(undefined, "nb-NO,nb;q=0.9") === "no" && pick(undefined, "nn") === "no", "Norwegian browser gets Norwegian");
ok(pick(undefined, "sv-SE") === "en" && pick(undefined, "") === "en", "English otherwise (stores)");
ok(/app\.use\("\/legal", legalRoutes\)/.test(read("server/index.js")), "pages mounted without sign-in");
ok(!/requireUser/.test(read("server/routes/legal.js")), "public pages");

// 2. App links.
ok(/openLegal\("privacy", language\)[\s\S]{0,200}openLegal\("terms", language\)/.test(read("app/(tabs)/profile.tsx")), "Profile links");
ok(/t\("legal\.privacy"\), t\("legal\.terms"\)/.test(read("app/(tabs)/profile.tsx")), "guests see the links too");
ok(/openLegal\("terms", language\)[\s\S]{0,300}openLegal\("privacy", language\)/.test(read("app/(auth)/login.tsx")), "sign-in links");
ok(/\/legal\/\$\{doc\}\?lang=\$\{language\}/.test(read("src/lib/legal.ts")), "link format");

// 3. Consent before every purchase.
ok(/<WithdrawalConsent checked=\{consent\}[\s\S]{0,1200}disabled=\{!quote \|\| loading \|\| !consent\}/.test(read("src/ui/LongTermSheet.tsx")), "historic case");
ok(/confirmDisabled=\{confirm === "reactivate" && !consent\}/.test(read("app/report-details/[id].tsx")) && /\{confirm === "reactivate" && <WithdrawalConsent/.test(read("app/report-details/[id].tsx")), "extension from the case");
ok(/disabled=\{confirmDialog\?\.kind === "reactivateLost" && !consent\}/.test(read("app/my-reports.tsx")), "extension from My cases");
ok(/disabled=\{activating \|\| !consent( \|\||\})/.test(read("app/geo-alert-create.tsx")), "area alert");
ok(/children\?: React\.ReactNode;\s*confirmDisabled\?: boolean;/.test(read("src/ui/kit/ConfirmSheet.tsx")), "ConfirmSheet takes a consent");

// 4. Deletion after 12 months.
const sql = read("supabase/migrations/20261101120000_t1_9r_purge_handled_chat_reports.sql");
ok(/r\.status <> 'OPEN'[\s\S]*r\.handled_at < now\(\) - interval '12 months'/.test(sql), "only handled reports older than 12 months");
ok(/cron\.schedule\('lost-or-found-purge-chat-reports', '17 3 \* \* \*'/.test(sql), "nightly named job (repeatable)");
ok(/revoke execute on function public\.purge_handled_chat_reports\(\) from public, anon, authenticated/.test(sql), "clients cannot run it");

for (const lang of ["no", "en"]) ok(read(`src/i18n/locales/${lang}.ts`).includes('"purchase.withdrawalConsent"'), `${lang} consent text`);

console.log(`OK: T1.9R checks passed (${n} assertions).`);
