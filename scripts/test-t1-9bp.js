// scripts/test-t1-9bp.js
// T1.9BP: control question with several tries, safe handover with the owner's code, and
// thank-you cards.
//   node .\scripts\test-t1-9bp.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const tr = require(path.join(root, "server/lib/trust.js"));
// Questions: one open at a time, three per chat.
eq(tr.canAsk([]), "ok", "first question");
eq(tr.canAsk([{ status: "ASKED" }]), "QUESTION_OPEN", "one open at a time");
eq(tr.canAsk([{ status: "NO_MATCH" }, { status: "CONFIRMED" }]), "ok", "new question after a closed one");
eq(tr.canAsk([{ status: "NO_MATCH" }, { status: "NO_MATCH" }, { status: "NO_MATCH" }]), "QUESTION_LIMIT", "three per chat");
// Several tries: you can remember wrong.
eq(tr.judge({ status: "ANSWERED", attempts: 1 }, false), { status: "ASKED", attempts: 1 }, "wrong first answer: try again");
eq(tr.judge({ status: "ANSWERED", attempts: 2 }, false), { status: "ASKED", attempts: 2 }, "wrong second answer: try again");
eq(tr.judge({ status: "ANSWERED", attempts: 3 }, false), { status: "NO_MATCH", attempts: 3 }, "third wrong: no match");
eq(tr.judge({ status: "ANSWERED", attempts: 2 }, true), { status: "CONFIRMED", attempts: 2 }, "right on the second try");
eq(tr.judge({ status: "ASKED", attempts: 0 }, true).error, "QUESTION_NOT_ANSWERED", "nothing to judge yet");
eq(tr.MAX_ANSWER_TRIES, 3, "three tries");
// Hand-in place hidden while the latest question is not confirmed.
eq(tr.custodyLocked([]), false, "no question: nothing hidden");
eq(tr.custodyLocked([{ status: "ASKED" }]), true, "open question hides the place");
eq(tr.custodyLocked([{ status: "CONFIRMED" }, { status: "NO_MATCH" }]), false, "confirmed latest shows it");
// Code.
ok(/^\d{4}$/.test(tr.newCode()), "four digits");
eq(tr.newCode(() => 7), "0007", "leading zeros kept");
const row = { code: "4719", failed_attempts: 0, locked_until: null, used_at: null };
eq(tr.checkCode(row, "4719").result, "ok", "right code");
eq(tr.checkCode(row, "47 19").result, "ok", "spaces ignored");
eq(tr.checkCode(row, "1111"), { result: "CODE_WRONG", failed: 1, lockedUntil: null }, "wrong code counted");
const fifth = tr.checkCode({ ...row, failed_attempts: 4 }, "1111", 1000);
ok(fifth.result === "CODE_WRONG" && fifth.lockedUntil === new Date(1000 + tr.CODE_LOCK_MS).toISOString(), "fifth wrong locks for 15 minutes");
eq(tr.checkCode({ ...row, locked_until: new Date(5000).toISOString() }, "4719", 1000).result, "CODE_LOCKED", "locked even with the right code");
eq(tr.checkCode({ ...row, locked_until: new Date(500).toISOString(), failed_attempts: 0 }, "4719", 1000).result, "ok", "lock runs out");
eq(tr.checkCode({ ...row, used_at: "x" }, "4719").result, "CODE_USED", "used once");

// Server wiring.
const route = read("server/routes/trust.js");
for (const p of ['"/thanks/me"', '"/:kind/:id"', '"/:kind/:id/question"', '"/question/:qid/answer"', '"/question/:qid/judge"', '"/:kind/:id/handover"', '"/:kind/:id/thanks"'])
  ok(route.includes(p), `route ${p}`);
ok(route.indexOf('"/thanks/me"') < route.indexOf('router.get("/:kind/:id"'), "thanks list before the generic route");
ok(/c\.role !== "HELPER"/.test(route) && /c\.role !== "OWNER"/.test(route), "only the helper asks and types the code; only the owner thanks");
ok(/code: c\.role === "OWNER" && !isResolved \? code\?\.code/.test(route), "only the owner sees the code");
ok(/await closeAndAward\(c\.kind, c\.id, c\.p, now\)/.test(route) && /status: "ACCEPTED"/.test(route), "code solves the case like both confirming");
ok(/modelProblems\(\[message\]\)/.test(route), "thank-you text is checked");
const res = read("server/routes/resolutions.js");
ok(/await closeAndAward\(q\.data\.context_type,q\.data\.context_id,p,now\)/.test(res) && !/awardSafely/.test(res), "resolutions use the shared core");
const core = read("server/lib/resolutionCore.js");
ok(/event: "RETURN_CONFIRMED"/.test(core) && /SIGHTING_RESOLVED/.test(core) && /GEO_ALERT_TIER_\*/.test(core), "core keeps close and bonus rules");
ok(/app\.use\("\/trust",trustRoutes\)/.test(read("server/index.js")), "mounted");
ok(/custodyLocked\(cq\.data \|\| \[\]\)/.test(read("server/routes/matches.js")), "hand-in place hidden while the question is open");
ok(/kind: "thanks"/.test(read("server/routes/notifications.js")) && /type\.startsWith\("TRUST_"\)/.test(read("server/routes/notifications.js")), "notices open the right place");
const exp = read("server/lib/privacyExport.js");
ok(/\["thank_you_cards", "to_user", \["from_user"\]\]/.test(exp) && /\.\.\.\(out\.tables\[table\] \|\| \[\]\)/.test(exp), "privacy export");
const mig = read("supabase/migrations/20261123100000_t1_9bp_trust_handover_thanks.sql");
ok(/attempts between 0 and 3/.test(mig) && /code ~ '\^\[0-9\]\{4\}\$'/.test(mig) && (mig.match(/enable row level security/g) || []).length === 3, "migration");

// Server texts in all languages.
for (const l of ["no", "en", "de"]) {
  const m = require(path.join(root, `server/locales/${l}.json`));
  for (const k of ["trustQuestion", "trustAnswer", "trustConfirmed", "trustRetry", "trustNoMatch", "trustHandedOver", "thanksReceived"])
    ok(m[`push.${k}.title`] && m[`push.${k}.body`], `push.${k} in ${l}`);
}

// App.
ok(/<TrustPanel kind="MATCH"/.test(read("app/chat/[matchId].tsx")) && /<TrustPanel kind="OBSERVATION"/.test(read("app/observation-chat/[id].tsx")), "panel in both chats");
const panel = read("src/ui/TrustPanel.tsx");
ok(/trust\.retryOwner/.test(panel) && /triesLeft/.test(panel), "owner sees tries left");
ok(/keyboardType="number-pad"/.test(panel) && /maxLength=\{4\}/.test(panel), "code field");
ok(/router\.push\("\/thanks"\)/.test(read("app/notifications.tsx")) && /key: "thanks"/.test(read("app/(tabs)/profile.tsx")), "Takkekort reachable");
for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["trust.title", "trust.askTitle", "trust.retryOwner", "trust.codeHint", "trust.codeLocked", "trust.thanksTitle", "trust.err.codeWrong", "trust.quoted", "thanks.title", "profile.thanks", "trust.placeQuery.police"])
    ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
// Test round 23.11: counts follow the match list; Home counts tips too; the keys nudge stands out.
const ra = require(path.join(root, "server/lib/reportActivity.js"));
eq([{ status: "NEW", score: 80 }, { status: "SEEN", score: 55 }, { status: "NEW", score: 40 }, { status: "DISMISSED", score: 90 }, { status: "CONFIRMED", score: 90 }].filter(ra.isShownOpenMatch).length, 2, "only open matches the list shows");
const act = read("server/routes/reportsActivity.js");
ok(/possibleMatchCounts\[rid\] = n/.test(act) && /loadReportMatches\(rid, user\.id\)/.test(act) && (act.match(/select\("id, status, score, lost_id/g) || []).length === 2, "server counts with the list's rules");
ok(/possibleCounts \? Number\(possibleCounts\[r\.id\] \|\| 0\)/.test(read("app/my-reports.tsx")), "My cases uses the count");
const hs = read("src/lib/homeSummary.ts");
ok(/openMatches: sum\(counts\) \+ sum\(tips\)/.test(hs) && /tipsReportId/.test(hs) && /home\.summary\.matchesTips/.test(read("app/(tabs)/index.tsx")), "Home counts matches and tips");
ok(/s\.eggNudge/.test(read("app/(report)/register.tsx")), "keys nudge visible");
console.log(`T1.9BP OK (${n} checks)`);
