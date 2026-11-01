"use strict";
// T1.9S: new sign-in screen, forgot password, page after e-mail confirmation, e-mails in the
// user's language, 8-character passwords.
//   node .\scripts\test-t1-9s.js
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

const login = read("app/(auth)/login.tsx");
ok(/router\.canGoBack\(\) \? router\.back\(\) : router\.replace\("\/"/.test(login), "back button always goes somewhere");
ok(!/\bAlert\b/.test(login), "no system alerts");
ok(!/remember\.me|setRemember/.test(login), "no 'remember me' that does nothing");
ok(/const SHOW_GOOGLE = Platform\.OS === "android";/.test(login) && !/provider: "apple"|apple\.coming/.test(login), "Google on Android only, no dead Apple button");
ok(/resetPasswordForEmail\(forgotEmail\.trim\(\), \{ redirectTo: recoveryRedirect \}\)/.test(login), "forgot password sends a link");
ok(/createURL\("auth-callback", \{ queryParams: \{ next: "new-password" \} \}\)/.test(login), "the link opens the new-password screen");
ok(/supabase\.auth\.resend\(\{ type: "signup"/.test(login), "confirmation can be sent again");
ok(/signin\.guestTitle[\s\S]{0,200}signin\.guestBody/.test(login) && /guestTitle: \{ fontSize: 17/.test(login), "guest option is prominent");
ok(/if \(lostIntent\) \{\s*setError\(t\("signin\.guestLostBlocked"\)\)/.test(login), "lost reports still need an account");
ok(/await rememberGuestForClaim\(\);\s*\n\s*const res/.test(login), "guest reports follow an OAuth sign-in");

const cb = read("app/(auth)/auth-callback.tsx");
ok(/next === "new-password" \|\| hash\.type === "recovery"/.test(cb) && /\/\(auth\)\/new-password/.test(cb), "reset link leads to new password");
ok(!/URL: \{prettyUrl\}/.test(cb), "no technical URL shown to users");
const np = read("app/(auth)/new-password.tsx");
ok(/supabase\.auth\.updateUser\(\{ password \}\)/.test(np) && /password !== repeat/.test(np) && /MIN_PASSWORD_LENGTH/.test(np), "new password is checked and saved");

const ctx = read("src/contexts/AuthContext.tsx");
ok(/export const MIN_PASSWORD_LENGTH = 8;/.test(ctx) && /password\.length < MIN_PASSWORD_LENGTH/.test(ctx), "8 characters");
ok(/options: \{ data: \{ language \} \}/.test(ctx), "language saved at sign-up");
ok(/updateUser\(\{ data: \{ language \} \}\)/.test(ctx) && /user_metadata as any\)\?\.language === language\) return;/.test(ctx), "language kept up to date");

for (const lang of ["no", "en"]) {
  const page = read(`server/legal/confirmed.${lang}.html`);
  ok(/href="lostorfound:\/\/"/.test(page) && /\/error\/\.test\(location\.hash\+location\.search\)/.test(page), `confirmed.${lang}: open app, shows used/expired link`);
  for (const doc of ["privacy", "terms"]) ok(/class="lang"/.test(read(`server/legal/${doc}.${lang}.html`)), `${doc}.${lang}: language switch`);
}
const pages = read("server/routes/authPages.js");
ok(/router\.get\("\/confirmed"/.test(pages) && !/requireUser/.test(pages), "public confirmation page");
ok(/app\.use\("\/auth", authPageRoutes\)/.test(read("server/index.js")), "mounted");
const { pickLanguage } = require(path.join(root, "server", "lib", "pageLanguage.js"));
ok(pickLanguage(undefined, "nb-NO") === "no" && pickLanguage("en", "nb") === "en" && pickLanguage(undefined, "de") === "en", "page language");
for (const lang of ["no", "en"]) {
  const loc = read(`src/i18n/locales/${lang}.ts`);
  for (const k of ["signin.guestTitle", "signin.forgot.sent", "signin.newPassword.title", "signin.check.resend"]) ok(loc.includes(`"${k}"`), `${lang} ${k}`);
  ok(!/"auth\.login\.remember\.me\.on\.this\.device"/.test(loc), `${lang}: old unused texts removed`);
}

console.log(`OK: T1.9S checks passed (${n} assertions).`);
