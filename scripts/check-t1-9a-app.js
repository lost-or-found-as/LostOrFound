"use strict";
// T1.9A step 3 static checks: guest mode in the app.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const errors = [];
const check = (ok, code) => { if (!ok) errors.push(code); };

// Screens that need a registered account must be wrapped by requireAccount().
const GATED = [
  "app/my-reports.tsx", "app/notifications.tsx", "app/alert-areas.tsx", "app/alert-area-editor.tsx",
  "app/push-settings.tsx", "app/match.tsx", "app/premium-status.tsx", "app/geo-alert-create.tsx",
  "app/observation-create.tsx", "app/payment.tsx", "app/commerce-test.tsx", "app/geo-alert-test.tsx",
  "app/area-alert/[id].tsx", "app/chat/[matchId].tsx", "app/match-comparison/[matchId].tsx",
  "app/matches/[matchId].tsx", "app/observation-chat/[id].tsx", "app/observation/[id].tsx",
  "app/report-details/[id].tsx", "app/(report)/mine.tsx",
];
for (const f of GATED) {
  const s = read(f);
  check(/^export default requireAccount\(\w+\);\s*$/m.test(s), `SCREEN_NOT_GATED: ${f}`);
  check(!/^export default function/m.test(s), `SCREEN_EXPORTED_UNGATED: ${f}`);
}

const gate = read("src/ui/AccountRequired.tsx");
check(gate.includes('t("guest.requiredTitle")') && gate.includes('mode: "signup"'), "ACCOUNT_REQUIRED_VIEW_INCOMPLETE");

const auth = read("src/contexts/AuthContext.tsx");
check((auth.match(/await rememberGuestForClaim\(\);\s*\n\s*await signOutIfAnonymousSession\(\);/g) || []).length === 2, "GUEST_NOT_REMEMBERED_BEFORE_EMAIL_LOGIN");
check(/claimPendingGuestReports\(nextSession\.access_token\)/.test(auth), "CLAIM_NOT_RUN_AFTER_LOGIN");
check(/await rememberGuestForClaim\(\);\s*\n\s*const res = \(await withTimeout<OAuthStartResult>/.test(read("app/(auth)/login.tsx")), "GUEST_NOT_REMEMBERED_BEFORE_OAUTH");

const claim = read("src/lib/guestClaim.ts");
check(claim.includes("/account/claim-guest-reports"), "CLAIM_ENDPOINT_MISSING");

const create = read("app/(report)/create-report.tsx");
check(/pathname: "\/found-receipt"/.test(create) && (create.match(/await showSaved\(\);/g) || []).length === 2, "GUEST_RECEIPT_NOT_USED");
check(fs.existsSync(path.join(root, "app/found-receipt.tsx")), "RECEIPT_SCREEN_MISSING");

const tabs = read("app/(tabs)/_layout.tsx");
check(/if \(!session \|\| isGuest\)/.test(tabs), "GUEST_UNREAD_FETCH_NOT_SKIPPED");

const header = read("src/ui/AuthHeaderAction.tsx");
check(/if \(!session \|\| isGuest\)/.test(header) && !/"Logg ut"|"Log out"/.test(header), "GUEST_CAN_LOG_OUT_FROM_HEADER");
check(/\{isGuest \? null : user \?/.test(read("app/(tabs)/profile.tsx")), "GUEST_CAN_LOG_OUT_FROM_PROFILE");
check(/await rememberGuestForClaim\(\);\s*\n\s*const \{ error \} = await supabase\.auth\.signOut\(\);/.test(auth), "GUEST_NOT_REMEMBERED_ON_SIGN_OUT");

// No user-facing literals in the new guest screens.
for (const f of ["src/ui/AccountRequired.tsx", "app/found-receipt.tsx"]) {
  const s = read(f);
  check(!/<Text[^>]*>\s*[A-Za-zÆØÅæøå][^<{]*</.test(s), `HARDCODED_TEXT: ${f}`);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`OK: T1.9A app guest-mode checks passed (${GATED.length} gated screens).`);
