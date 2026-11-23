// scripts/test-t1-9bq.js
// T1.9BQ: premium feel. Haptics used sparingly, skeletons instead of spinners on the main
// screens, illustrated empty states, a three-screen intro once, counting numbers on Home,
// muted maps, text that grows without breaking, light mode locked until dark mode is built.
//   node .\scripts\test-t1-9bq.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// Haptics.
const h = read("src/lib/haptics.ts");
ok(/selectionAsync/.test(h) && /ImpactFeedbackStyle\.Light/.test(h) && /NotificationFeedbackType\.Success/.test(h) && /NotificationFeedbackType\.Warning/.test(h), "four kinds");
ok(/variant === "primary" \|\| variant === "danger"\) haptic\.press\(\)/.test(read("src/ui/kit/Button.tsx")), "only main buttons tap");
ok(/screenListeners=\{\{ tabPress: \(\) => haptic\.tap\(\) \}\}/.test(read("app/(tabs)/_layout.tsx")), "tabs tick");
ok(/haptic\.success\(\);\n\s*router\.replace\(\{ pathname: "\/report-details\/\[id\]", params: \{ id: reportId, created: "1" \} \}\)/.test(read("app/(report)/register.tsx")), "case sent");
ok(/if \(accept\) haptic\.success\(\)/.test(read("app/chat/[matchId].tsx")) && /if \(accept\) haptic\.success\(\)/.test(read("src/lib/observationResolution.ts")), "case solved");
const tp = read("src/ui/TrustPanel.tsx");
ok(/haptic\.warning\(\);\n\s*setError/.test(tp) && (tp.match(/"success"/g) || []).length >= 4, "trust tools feel right");
ok(/haptic\.success\(\)/.test(read("app/bonus.tsx")), "confetti");

// Skeletons.
const sk = read("src/ui/Skeleton.tsx");
ok(/isReduceMotionEnabled/.test(sk) && /accessibilityRole="progressbar"/.test(sk), "skeleton calm and announced");
for (const f of ["app/my-reports.tsx", "app/messages.tsx", "app/notifications.tsx", "app/match.tsx", "app/report-details/[id].tsx", "app/bonus.tsx", "app/matches/[matchId].tsx", "app/feedback-admin.tsx", "app/thanks.tsx", "app/my-feedback.tsx"]) {
  const s = read(f);
  ok(/<Skeleton(List|Detail)\b/.test(s) && !/<ActivityIndicator\s*\/>|<ActivityIndicator (style|color)=/.test(s.replace(/busy \?[^:]*:/g, "")), `${f} uses a skeleton`);
}

// Empty states, intro, Home numbers.
ok(/styles\.ring/.test(read("src/ui/kit/EmptyState.tsx")) && /maxFontSizeMultiplier/.test(read("src/ui/kit/EmptyState.tsx")), "illustrated empty state");
const intro = read("app/intro.tsx");
ok(/pagingEnabled/.test(intro) && /markIntroSeen/.test(intro) && /intro\.skip/.test(intro), "intro pages, skip, remembered");
ok(/introSeen\(\)\.then/.test(read("app/(tabs)/index.tsx")) && /lof\.intro\.seen\.v1/.test(read("src/lib/intro.ts")), "intro once per install");
ok(/function useCountTo/.test(read("app/(tabs)/index.tsx")) && /\{shown\}/.test(read("app/(tabs)/index.tsx")), "numbers count");

// Maps, text size, light mode.
const maps = ["app/geo-alert-create.tsx", "app/area-visibility-create.tsx", "app/observation-create.tsx", "app/observation/[id].tsx", "app/alert-areas.tsx", "app/sighting-add.tsx", "app/report-details/[id].tsx", "app/(report)/register.tsx", "app/(report)/map.tsx", "src/ui/PetSightingsCard.tsx"];
for (const f of maps) {
  const s = read(f);
  const tags = (s.match(/<MapView\s/g) || []).length;
  const typed = (s.match(/<MapView\s+mapType=\{APP_MAP_TYPE\}/g) || []).length;
  ok(tags > 0 && tags === typed, `${f}: every map muted`);
}
ok(/"mutedStandard"/.test(read("src/lib/mapStyle.ts")), "muted on iOS");
ok(/maxFontSizeMultiplier=\{1\.5\}/.test(read("src/ui/kit/Button.tsx")) && /maxFontSizeMultiplier=\{1\.4\}/.test(read("src/ui/kit/ScreenHeader.tsx")) && /tabBarAllowFontScaling: false/.test(read("app/(tabs)/_layout.tsx")), "text grows without breaking");
ok(require(path.join(root, "app.json")).expo.userInterfaceStyle === "light", "light mode locked");

for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["intro.skip", "intro.next", "intro.start", "intro.step", "intro.lost.title", "intro.found.body", "intro.help.title"]) ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
console.log(`T1.9BQ OK (${n} checks)`);
