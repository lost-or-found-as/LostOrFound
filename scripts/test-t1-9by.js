// scripts/test-t1-9by.js
// T1.9BY: sign-in never hangs (auth requests time out, the guest step has a time limit, Apple's
// sheet opens first), clearer network errors, a cleaner Home with a sign-in card, Profile that
// says "not signed in", and the password-reset page that hands the link to the app.
//   node .\scripts\test-t1-9by.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// Sign-in never hangs.
const supa = read("src/lib/supabase.ts");
ok(/global: \{ fetch: fetchWithAuthTimeout \}/.test(supa), "Supabase uses the timed fetch");
ok(/includes\("\/auth\/v1\/"\)/.test(supa) && /AUTH_REQUEST_TIMEOUT_MS = 15_000/.test(supa), "only auth requests are timed");
const guest = read("src/lib/guestClaim.ts");
ok(/Promise\.race\(\[rememberGuestNow\(\), limit\]\)/.test(guest), "guest step has a time limit");
const social = read("src/lib/socialSignIn.ts");
const apple = social.slice(social.indexOf("export async function signInWithApple"));
ok(apple.indexOf("AppleAuthentication.signInAsync") < apple.indexOf("rememberGuestForClaim()"), "Apple sheet opens before the guest step");
ok(apple.indexOf("rememberGuestForClaim()") < apple.indexOf("signInWithIdToken"), "guest remembered before the new sign-in");
const err = read("src/lib/userError.ts");
ok(/AuthRetryableFetchError: "errors\.networkBody"/.test(err) && /load failed/.test(err), "network failures get the network text");

// Home.
const home = read("app/(tabs)/index.tsx");
ok(/logo: \{ width: 60, height: 60/.test(home) && /brand: \{[^}]*fontSize: 28/.test(home), "bigger logo and name");
ok(!/howCard/.test(home) && !/home\.nearbyBody/.test(home) && !/home\.messagesBody/.test(home), "steps card, nearby and messages rows removed");
ok(/!hasAccount && \(\s*<Pressable[\s\S]*home\.signedOut\.title/.test(home), "sign-in card when signed out");
ok(/<InfoButton title=\{t\("profile\.how"\)\}>/.test(home), "steps behind the info button");

// Profile.
const profile = read("app/(tabs)/profile.tsx");
ok(/\{!user \? \(\s*<Pressable[\s\S]*profile\.signedOut\.title/.test(profile), "Profile card opens sign-in when signed out");

// Texts in both languages.
for (const lang of ["no", "en"]) {
  const s = read(`src/i18n/locales/${lang}.ts`);
  for (const key of ["home.signedOut.title", "home.signedOut.body", "profile.signedOut.title", "profile.signedOut.body"]) ok(s.includes(`"${key}":`), `${key} in ${lang}`);
}

// Reset link sent from Supabase opens the app's "choose a new password".
for (const lang of ["no", "en"]) {
  const page = read(`server/legal/confirmed.${lang}.html`);
  ok(/type=recovery/.test(page) && /lostorfound:\/\/auth-callback\?next=new-password#/.test(page), `recovery handed to the app (${lang})`);
  ok(/history\.replaceState/.test(page), `tokens removed from the address bar (${lang})`);
}

console.log(`OK: T1.9BY ${n} checks`);
