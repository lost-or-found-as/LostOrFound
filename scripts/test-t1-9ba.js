// scripts/test-t1-9ba.js
// T1.9BA: info buttons where a choice needs an explanation, and the same header on the paid screens.
//   node .\scripts\test-t1-9ba.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

ok(!fs.existsSync(path.join(root, "src/ui/PremiumHeader.tsx")), "the old blue header is gone");
const geo = read("app/geo-alert-create.tsx");
ok(!/PremiumHeader/.test(geo) && /<ScreenHeader/.test(geo), "area alert uses the app header");
ok(/right=\{<InfoButton title=\{tr\(language, "areaAlertCreate\.info\.title"\)\} body=\{tr\(language, "areaAlertCreate\.info\.body"\)\} \/>\}/.test(geo), "area alert explains itself");
const vis = read("app/area-visibility-create.tsx");
ok(!/PremiumHeader/.test(vis) && /right=\{<InfoButton title=\{t\("areaVisibility\.info\.title"\)\}/.test(vis), "visibility uses the app header with an explanation");
const form = read("app/(report)/register.tsx");
ok(/<InfoButton title=\{t\("register\.reward\.infoTitle"\)\}/.test(form), "finder's reward explained");
ok(/<InfoButton title=\{t\("register\.custody\.infoTitle"\)\}/.test(form), "where it is now explained");
ok(/<InfoButton title=\{t\("notifications\.info\.title"\)\}/.test(read("app/notifications.tsx")), "notifications explained");
ok(/<InfoButton title=\{t\("pushSettings\.info\.title"\)\}/.test(read("app/push-settings.tsx")), "push settings explained");

const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
for (const k of ["areaAlertCreate.info.body", "areaVisibility.info.body", "register.reward.infoBody", "register.custody.infoBody", "notifications.info.body", "pushSettings.info.body"]) {
  ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);
}
ok(/høyst to ganger/.test(no) && /avhenger av hvor stort området er/.test(no), "area alert text matches the rules (two per case, price by size)");
ok(/ser eieren stedet først når dere har bekreftet treffet/.test(no), "hand-in place only after confirmation");

console.log(`T1.9BA OK (${n} checks)`);
