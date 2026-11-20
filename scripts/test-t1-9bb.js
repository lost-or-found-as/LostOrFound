// scripts/test-t1-9bb.js
// T1.9BB: admin screen with sections Chat, Saker (reported cases) and Bonus (bonus checks).
//   node .\scripts\test-t1-9bb.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const screen = read("app/safety-reports.tsx");
ok(/\(\["chat", "cases", "bonus"\] as const\)/.test(screen), "three sections");
ok(/Promise\.all\(\[fetchAdminReports\(tab\), fetchReportedCases\(\), fetchBonusFlags\(\)\]\)/.test(screen), "counts loaded at once");
ok(/<ReportedCasesList items=\{cases\}/.test(screen) && /<BonusFlagsList flags=\{flags\}/.test(screen), "lists shown in their sections");
ok(/requireAccount\(Screen\)/.test(screen), "still needs an account (server checks admin)");

const cases = read("src/ui/admin/ReportedCasesList.tsx");
ok(/restoreCase\(id\)/.test(cases) && /hideCase\(id\)/.test(cases) && /closeCaseReports\(id\)/.test(cases), "show again, hide, close");
ok(/admin\.content\.keep/.test(cases) && /admin\.content\.noAction/.test(cases), "keep hidden / no action");
ok(/<ConfirmSheet/.test(cases), "every action confirmed");
const bonus = read("src/ui/admin/BonusFlagsList.tsx");
ok(/revokeBonusRow\(pending\)/.test(bonus) && /destructive/.test(bonus), "withdraw a bonus row, confirmed");
ok(/shortId\(f\.userId\)/.test(bonus) && !/email/i.test(bonus), "accounts by a short id only");

const lib = read("src/lib/contentAdmin.ts");
ok(/"\/admin\/content"/.test(lib) && /\/close`/.test(lib) && /"\/admin\/bonus-flags"/.test(lib), "app calls the admin routes");
const safety = read("server/routes/safety.js");
ok(/router\.post\("\/admin\/content\/:reportId\/close", requireUser, requireAdmin/.test(safety), "close route for admins only");
ok(/CLOSE_CONTENT_REPORTS/.test(safety), "admin action logged");
const cr = require(path.join(root, "server/lib/contentReports.js"));
ok(typeof cr.closeReports === "function", "close helper");
ok(!/user_id\)/.test(read("server/lib/contentReports.js").match(/reports\(id,type[^)]*\)/)[0]), "list does not send the owner's id");

const no = read("src/i18n/locales/no.ts");
for (const k of ["admin.section.cases", "admin.content.restore", "admin.content.keep", "admin.bonus.revoke", "admin.bonus.reason.RECIPROCAL"]) ok(no.includes(`"${k}":`), `text ${k}`);

console.log(`T1.9BB OK (${n} checks)`);
