// scripts/test-t1-9bi.js
// T1.9BI: the reward can only go up once someone has been in touch; the finder sees it in the
// chat; a running «Synlig i nærheten» is paused while an area alert runs and goes on afterwards.
//   node .\scripts\test-t1-9bi.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

async function main() {
  // 1. Reward lock.
  const lock = require(path.join(root, "server/lib/rewardLock.js"));
  eq([lock.lowersLockedReward(50000, 0, true), lock.lowersLockedReward(50000, 20000, true), lock.lowersLockedReward(50000, 70000, true), lock.lowersLockedReward(50000, 0, false)], [true, true, false, false], "only lowering a locked reward is refused");
  const fake = (counts) => ({
    from: (table) => {
      const q = { _t: table, _f: {} };
      q.select = () => q; q.in = () => q;
      q.eq = (k, v) => { q._f[k] = v; return q; };
      q.then = (res) => res({ count: table === "matches" ? (q._f.lost_id ? counts.lost : counts.found) : counts.obs, error: null });
      return q;
    },
  });
  eq(await lock.hasContact(fake({ lost: 0, found: 0, obs: 0 }), "r"), false, "no contact");
  eq(await lock.hasContact(fake({ lost: 1, found: 0, obs: 0 }), "r"), true, "confirmed match is contact");
  eq(await lock.hasContact(fake({ lost: 0, found: 0, obs: 2 }), "r"), true, "a sighting is contact");
  const reports = read("server/routes/reports.js");
  ok(/if \(lowersLockedReward\(existing\.reward_ore, patch\.reward_ore, locked\)\) \{\s*return res\.status\(409\)\.json\(\{ error: "REWARD_LOCKED"/.test(reports), "PATCH refuses a lower reward");
  ok(/reward_locked: confirmedMatches\.length > 0 \|\| \(observationsResult\.data \|\| \[\]\)\.length > 0/.test(reports), "case tells the app");
  ok(/from\("report_edits"\)\.insert/.test(reports), "changes are logged");

  // 2. Visibility pause.
  const vis = require(path.join(root, "server/lib/areaVisibility.js"));
  const day = 86400000, now = Date.parse("2026-11-21T12:00:00Z");
  eq(vis.pausedVisibilityEnd(now + 4 * day, now + 7 * day, now), now + 11 * day, "4 days left resume after the 7-day alert");
  eq(vis.pausedVisibilityEnd(now - 1, now + 7 * day, now), null, "ended visibility is left alone");
  const commerce = read("server/routes/reportCommerce.js");
  ok(/if \(!visibilityOrder\) \{\s*try \{\s*await pauseVisibilityForAlert\(supaAdmin, order\.report_id, periodEnd\.toISOString\(\), now\.getTime\(\)\);/.test(commerce), "alert pauses visibility");
  ok(/\.from\("report_entitlements"\)\s*\.update\(\{ current_period_end: endsAt/.test(read("server/lib/areaVisibility.js")), "entitlement follows");

  // 3. App.
  const reg = read("app/(report)/register.tsx");
  ok(/setRewardFloor\(j\.reward_locked === true/.test(reg) && /const below = rewardFloor !== null && amount < rewardFloor;/.test(reg), "lower amounts disabled");
  ok(/register\.reward\.lockedBody/.test(reg), "lock explained");
  ok(/REWARD_LOCKED: "register\.reward\.lockedError"/.test(read("src/lib/userError.ts")), "error text");
  ok(/!youOwnLost && Number\(match\?\.lost\?\.reward_ore \|\| 0\) > 0/.test(read("app/chat/[matchId].tsx")), "finder sees the reward in the chat");
  ok(/visibilityDaysLeft > 0 &&/.test(read("app/geo-alert-create.tsx")), "pause explained before buying");
  for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
    for (const k of ["register.reward.lockedTitle", "register.reward.lockedBody", "register.reward.lockedError", "areaAlertCreate.visibilityPauseTitle", "areaAlertCreate.visibilityPauseBody", "chat.rewardLine"])
      ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
  console.log(`T1.9BI OK (${n} checks)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
