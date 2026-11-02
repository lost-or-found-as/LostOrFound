"use strict";
// T1.9W: screen round 2. Every reworked screen uses the shared header, shows errors in the screen
// instead of system dialogs, and the new registration is the default.
//   node .\scripts\test-t1-9w.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const exists = (f) => fs.existsSync(path.join(root, f));
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};

const SCREENS = [
  "app/my-reports.tsx",
  "app/(tabs)/index.tsx",
  "app/(tabs)/profile.tsx",
  "app/found-receipt.tsx",
  "app/language.tsx",
  "app/how.tsx",
  "app/(report)/map.tsx",
  "app/area-alert/[id].tsx",
  "app/premium-status.tsx",
  "app/push-settings.tsx",
  "app/alert-areas.tsx",
  "app/observation-create.tsx",
  "app/observation/[id].tsx",
  "app/observation-chat/[id].tsx",
  "app/feedback.tsx",
  "app/feedback-admin.tsx",
  "app/start.tsx",
];

// 1. No system dialogs and no old header on the reworked screens.
for (const f of SCREENS) {
  const src = read(f);
  ok(!/Alert\.alert\(/.test(src), `${f}: no Alert.alert`);
  ok(!/PremiumHeader/.test(src), `${f}: no old header`);
}

// 2. Screens with a header use the shared one; info buttons where they help a new user.
for (const f of ["app/my-reports.tsx", "app/area-alert/[id].tsx", "app/premium-status.tsx", "app/push-settings.tsx", "app/alert-areas.tsx",
  "app/observation-create.tsx", "app/observation/[id].tsx", "app/observation-chat/[id].tsx", "app/language.tsx", "app/how.tsx", "app/feedback.tsx"])
  ok(/ScreenHeader/.test(read(f)), `${f}: ScreenHeader`);
for (const f of ["app/my-reports.tsx", "app/(report)/map.tsx", "app/area-alert/[id].tsx", "app/premium-status.tsx", "app/alert-areas.tsx",
  "app/observation-create.tsx", "app/(tabs)/index.tsx"])
  ok(/InfoButton/.test(read(f)), `${f}: info button`);

// 3. Load failures are not shown as an empty list; destructive actions are confirmed.
ok(/InlineNotice/.test(read("app/my-reports.tsx")) && /RefreshControl/.test(read("app/my-reports.tsx")), "my cases: error notice and pull to refresh");
ok(/ConfirmSheet/.test(read("app/my-reports.tsx")) && !/<Modal/.test(read("app/my-reports.tsx")), "my cases: sheets, not modals");
ok(/ConfirmSheet/.test(read("app/alert-areas.tsx")), "alert areas: delete is confirmed");
ok(!exists("app/alert-area-editor.tsx"), "alert areas are one screen");
ok(/ConfirmSheet/.test(read("app/push-settings.tsx")), "push: turning off is confirmed");
ok(/ConfirmSheet/.test(read("app/(tabs)/profile.tsx")), "profile: log out and delete are confirmed");
ok(!/Testpris|Fullfør testbetaling/.test(read("app/my-reports.tsx")), "my cases: no test text");
ok(!/cases\.test\.price/.test(read("app/report-details/[id].tsx")), "case: no test price label");

// 4. Observation resolution is shared, and the chat checks the sign-in token.
ok(exists("src/lib/observationResolution.ts") && exists("src/ui/ObservationResolution.tsx"), "shared resolution");
ok(/ObservationResolution/.test(read("app/observation/[id].tsx")) && /ObservationResolution/.test(read("app/observation-chat/[id].tsx")), "both screens use it");
ok(!/if\s*\(\s*!t\s*\)\s*return/.test(read("app/observation-chat/[id].tsx")), "chat guard no longer tests the translate function");

// 5. New registration for everyone; the old screen only edits.
ok(/pathname: "\/\(report\)\/register"/.test(read("src/lib/newRegistration.ts")) && !/create-report"/.test(read("src/lib/newRegistration.ts").replace(/\/\/.*$/gm, "")), "register route always the new screen");
ok(!/newRegistration|Prøv ny registrering|register\.tryNew/.test(read("app/(tabs)/profile.tsx")), "no registration switch in profile");
const edit = read("app/(report)/create-report.tsx");
ok(/report\.create\.edit\.found\.report/.test(edit), "edit title for a found case");
ok(/\{!isEditMode && \(/.test(edit), "type cannot change while editing");
for (const f of ["app/(tabs)/index.tsx", "app/start.tsx", "src/ui/RegisterChoice.tsx"])
  ok(!/pathname: "\/\(report\)\/create-report"/.test(read(f)), `${f}: new reports never open the old screen`);

console.log(`OK: T1.9W screen round checks passed (${n} assertions).`);
