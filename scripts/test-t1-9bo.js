// scripts/test-t1-9bo.js
// T1.9BO: free preview of matches on an expired case; three new helper levels; hidden badges,
// logo pin, keys nudge and first-return confetti; photo check copes with old or missing files.
//   node .\scripts\test-t1-9bo.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || "test";

// Match preview rules (pure functions from routes/matches.js are checked through the source).
const mr = read("server/routes/matches.js");
ok(/function matchAccess\(match, userId\)/.test(mr) && /return "preview"|\? "full" : "preview"/.test(mr), "access levels");
ok(/title: null, description: null, location_label: null, lat: null, lng: null, custody_place: null/.test(mr), "preview hides text and exact place");
ok(/status === "CONFIRMED" && matchAccess\(match, user\.id\) !== "full"/.test(mr) && /MATCH_PREVIEW_ONLY/.test(mr), "no contact from a preview");
ok(/counterpart_helper: access === "preview" \? null : counterpartHelper/.test(mr), "no helper info in a preview");
let matchesMod = null;
try { matchesMod = require(path.join(root, "server/routes/matches.js")); } catch { matchesMod = null; }
if (matchesMod?.matchAccess) {
  const past = "2020-01-01T00:00:00Z", future = "2099-01-01T00:00:00Z";
  const m = (lostUntil, foundUntil, status = "NEW", lostClosed = null) => ({
    status,
    lost: { user_id: "me", status: "ACTIVE", visible_until: lostUntil, closed_at: lostClosed },
    found: { user_id: "them", status: "ACTIVE", visible_until: foundUntil, description: "secret", location_label: "Gate 1", lat: 59.9, lng: 10.7 },
  });
  eq(matchesMod.matchAccess(m(future, future), "me"), "full", "both active: full");
  eq(matchesMod.matchAccess(m(past, future), "me"), "preview", "own expired: preview");
  eq(matchesMod.matchAccess(m(past, past), "me"), null, "both expired: hidden");
  eq(matchesMod.matchAccess(m(past, future, "NEW", past), "me"), null, "own closed: hidden");
  eq(matchesMod.matchAccess(m(past, future, "CONFIRMED"), "me"), "full", "confirmed before expiry keeps the full view");
  eq(matchesMod.matchAccess(m(future, past), "me"), null, "other side expired: hidden");
  const p = matchesMod.previewMatchForViewer(m(past, future), "me");
  ok(p.preview_only === true && p.found.description === null && p.found.location_label === null && p.found.lat === null, "preview shape");
}
const ra = read("src/lib/reportActivity.ts");
ok(/summary\.possibleMatches > 0 && isReportExpired\(report, now\)/.test(ra) && /export function reactivationAction/.test(ra), "next step and reactivation choice");
const md = read("app/matches/[matchId].tsx");
ok(/showPreviewActions/.test(md) && /action: "activate"/.test(md) && /matchDetail\.preview\.activate/.test(md), "detail: Not mine / Looks like it");
ok(/action !== "activate"/.test(read("app/report-details/[id].tsx")) && /reactivationAction\(data\.report, activity\.summary\)/.test(read("app/report-details/[id].tsx")), "case opens the right reactivation");
ok(/m\.preview_only/.test(read("app/match.tsx")), "list notice");
ok(/MATCH_PREVIEW_ONLY: "match\.previewOnly"/.test(read("src/lib/userError.ts")), "error text");

// Levels.
const hb = require(path.join(root, "server/lib/helperBonus.js"));
eq([1, 5, 15, 99, 100, 250, 500].map(hb.helperLevel), ["HELPER", "SUPER_HELPER", "MASTER_HELPER", "MASTER_HELPER", "LEGEND", "MYTHIC_FINDER", "DIVINE_FINDER"], "levels");
eq([15, 30, 90, 99, 100, 600].map(hb.helperStars), [0, 1, 5, 5, 0, 0], "stars only for Mesterhjelper");
eq(hb.nextStep(0), { kind: "LEVEL", level: "HELPER", at: 1 }, "first level");
eq(hb.nextStep(29), { kind: "STAR", stars: 1, at: 30 }, "first star");
eq(hb.nextStep(95), { kind: "LEVEL", level: "LEGEND", at: 100 }, "after five stars: Legende");
eq(hb.nextStep(120), { kind: "LEVEL", level: "MYTHIC_FINDER", at: 250 }, "then Mytisk finner");
eq(hb.nextStep(300), { kind: "LEVEL", level: "DIVINE_FINDER", at: 500 }, "then Guddommelig");
eq(hb.nextStep(500), null, "top");
const appLevels = read("src/lib/helperBonus.ts");
ok(/LEGEND: 90,/.test(appLevels) && /DIVINE_FINDER: "trophy-outline"/.test(appLevels), "app knows the levels");

// Hidden badges.
const ret = (at, category, key) => ({ created_at: at, report: { category, subcategory_key: key } });
eq(hb.hiddenBadges([ret("2026-11-22T01:30:00Z", "BAGS", "WALLET")]), ["NIGHT_WATCH"], "02:30 Oslo is night");
eq(hb.hiddenBadges([ret("2026-11-22T12:00:00Z", "PETS", "DOG"), ret("2026-11-22T12:00:00Z", "PETS", "CAT"), ret("2026-11-22T12:00:00Z", "PETS", "DOG")]), ["DOG_WHISPERER"], "three animals");
eq(hb.hiddenBadges([ret("2026-11-22T12:00:00Z", "PETS", "PET_LEASH"), ret("2026-11-22T12:00:00Z", "CLOTHING", "UMBRELLA")]), ["UMBRELLA_HUNTER"], "leash is not an animal; umbrella");
ok(/badges,/.test(read("server/lib/helperBonus.js")), "summary has badges");

// Easter eggs in the app (pure helpers are TypeScript; checked through the source).
const egg = read("src/lib/easterEggs.ts");
ok(/LOGO_TAPS_FOR_PIN = 7/.test(egg) && /m === 9 && date\.getDate\(\) === 31/.test(egg) && /m === 11/.test(egg), "pin and seasons");
ok(/onLogoPress/.test(read("app/(tabs)/index.tsx")) && /keysNudge\(query\)/.test(read("app/(report)/register.tsx")), "logo and keys");
const bonusScreen = read("app/bonus.tsx");
ok(/lof\.egg\.firstReturnConfetti\./.test(bonusScreen) && /<Confetti/.test(bonusScreen) && /isReduceMotionEnabled/.test(read("src/ui/Confetti.tsx")), "confetti once, respects reduced motion");

// Photo check.
const im = require(path.join(root, "server/lib/imageModeration.js"));
eq(im.storedImageLocation("report-images/reports/a/b.jpg", {}), { bucket: "report-images", objectPath: "reports/a/b.jpg" }, "normal path");
eq(im.storedImageLocation("reports/a/b.jpg", {}), { bucket: "report-images", objectPath: "reports/a/b.jpg" }, "old path without bucket");
ok(/file missing, held/.test(read("server/lib/imageModeration.js")) && /await storedFileMissing\(supa, bucket, objectPath\)/.test(read("server/lib/imageModeration.js")), "missing file (confirmed by listing) stops the retries");
const listSupa = (files, error = null) => ({ storage: { from: () => ({ list: async () => ({ data: error ? null : files, error }) }) } });
(async () => {
  eq(await im.storedFileMissing(listSupa([{ name: "b.jpg" }]), "report-images", "reports/a/b.jpg"), false, "file there");
  eq(await im.storedFileMissing(listSupa([]), "report-images", "reports/a/b.jpg"), true, "file gone");
  eq(await im.storedFileMissing(listSupa(null, { message: "Bucket not found" }), "report-images", "reports/a/b.jpg"), false, "access problem never holds photos");
  console.log(`T1.9BO OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });

for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["matchDetail.preview.title", "matchDetail.preview.activate", "caseDetail.next.previewMatchesTitle", "match.previewOnly", "bonus.level.LEGEND", "bonus.level.MYTHIC_FINDER", "bonus.level.DIVINE_FINDER", "bonus.badgesTitle", "bonus.badge.NIGHT_WATCH", "bonus.badgeHow.UMBRELLA_HUNTER", "home.egg.pin", "home.egg.christmas", "register.egg.keys"])
    ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
