// scripts/test-t1-9ax.js
// T1.9AX: bonus screens. Stars after Mesterhjelper, next step, in-app notice (no push) when
// bonus is earned, the other party's level in the match chat, «Din bonus» and the profile row.
//   node .\scripts\test-t1-9ax.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const bonus = require(path.join(root, "server/lib/helperBonus.js"));
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// Fake Supabase: enough for award() and activatePending().
function fakeSupa({ ledger = [], reports = {} } = {}) {
  const make = (table) => {
    const st = { table, filters: [], op: "select" };
    const api = {
      select() { return api; },
      eq(k, v) { st.filters.push((r) => r[k] === v); return api; },
      neq(k, v) { st.filters.push((r) => r[k] !== v); return api; },
      gt(k, v) { st.filters.push((r) => r[k] > v); return api; },
      gte() { return api; },
      in() { return api; },
      is() { return api; },
      lte() { return api; },
      limit() { return api; },
      order() { return api; },
      insert(row) { st.op = "insert"; st.row = { id: `L${ledger.length + 1}`, created_at: new Date().toISOString(), ...row }; return api; },
      update(patch) { st.op = "update"; st.patch = patch; return api; },
      maybeSingle() { return api.then((r) => r); },
      then(resolve) {
        if (table === "helper_bonus_ledger" && st.op === "insert") { ledger.push(st.row); return resolve({ data: { id: st.row.id }, error: null }); }
        if (table === "helper_bonus_ledger" && st.op === "update") { ledger.filter((r) => st.filters.every((f) => f(r))).forEach((r) => Object.assign(r, st.patch)); return resolve({ error: null }); }
        if (table === "helper_bonus_ledger") return resolve({ data: ledger.filter((r) => st.filters.every((f) => f(r))), error: null });
        if (table === "reports") return resolve({ data: reports[st.filters.length ? "x" : "x"] || { id: "r1", created_at: "2020-01-01T00:00:00Z", deleted_at: null }, error: null });
        return resolve({ data: [], error: null });
      },
    };
    return api;
  };
  return {
    ledger,
    from: make,
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, is_anonymous: false } }, error: null }) } },
  };
}

async function main() {
  // 1. Levels, stars and the next step.
  eq([0, 1, 5, 15, 29].map(bonus.helperStars), [0, 0, 0, 0, 0], "no stars before 30 returns");
  eq([30, 44, 45, 90, 200].map(bonus.helperStars), [1, 1, 2, 5, 5], "one star per 15 after Mesterhjelper, at most five");
  eq(bonus.nextStep(0), { kind: "LEVEL", level: "HELPER", at: 1 }, "first return makes a Helper");
  eq(bonus.nextStep(3), { kind: "LEVEL", level: "SUPER_HELPER", at: 5 }, "then Superhjelper at 5");
  eq(bonus.nextStep(14), { kind: "LEVEL", level: "MASTER_HELPER", at: 15 }, "then Mesterhjelper at 15");
  eq(bonus.nextStep(15), { kind: "STAR", stars: 1, at: 30 }, "then the first star at 30");
  eq(bonus.nextStep(46), { kind: "STAR", stars: 3, at: 60 }, "next star");
  eq(bonus.nextStep(90), null, "nothing after five stars");

  // 2. Notices: in the app only, after the award; a pending find is told when it turns active.
  const sent = [];
  const notify = async (x) => { sent.push(x); return { inApp: true, push: 0 }; };
  const env = { HELPER_BONUS_ENABLED: "true" };
  const supa = fakeSupa();
  const quiet = { log() {}, warn() {} };
  const r1 = await bonus.award({ userId: "u1", event: "MATCH_CONFIRMED", counterpartUserId: "u2", sourceId: "m1" }, { supa, env, notify, log: quiet });
  ok(r1.awarded && r1.points === 3, "awarded");
  eq(sent.length, 1, "one notice");
  eq([sent[0].type, sent[0].push, sent[0].entityType, sent[0].userId], ["BONUS_AWARDED", false, "bonus", "u1"], "in-app notice, never push");
  ok(/3/.test(sent[0].titles.no) && /bekreftet treff/i.test(sent[0].bodies.no), "Norwegian text with the points");
  ok(/3/.test(sent[0].titles.en), "English text too");
  const r2 = await bonus.award({ userId: "u1", event: "FOUND_REGISTERED", reportId: "r1", sourceId: "r1" }, { supa, env, notify, log: quiet });
  ok(r2.awarded && r2.reason === "PENDING", "a find waits 24 hours");
  eq(sent.length, 1, "no notice while it waits");
  await bonus.activatePending({ supa, now: Date.now() + 2 * 24 * 3600 * 1000, notify, log: quiet });
  eq(sent.length, 2, "notice when the find turns active");
  ok(/registrert funn/i.test(sent[1].bodies.no), "find text");
  const before = sent.length;
  await bonus.award({ userId: "u1", event: "MATCH_CONFIRMED", counterpartUserId: "u3" }, { supa, env: {}, notify, log: quiet });
  eq(sent.length, before, "no notice while the bonus is off");
  const broken = await bonus.award({ userId: "u9", event: "MATCH_CONFIRMED", counterpartUserId: "u8" }, { supa: fakeSupa(), env, notify: async () => { throw new Error("down"); }, log: quiet });
  ok(broken.awarded, "a failing notice never stops the award");

  const userNotify = read("server/lib/userNotify.js");
  ok(/push = true \}\)/.test(userNotify) && /if \(!push\) return \{ inApp: !inserted\.error, push: 0 \};/.test(userNotify), "notifyUser can skip push");
  for (const l of ["no", "en", "de"]) {
    const m = require(path.join(root, `server/locales/${l}.json`));
    ok(m["bonus.awarded.title"] && ["FOUND_REGISTERED", "SIGHTING_USEFUL", "MATCH_CONFIRMED", "SIGHTING_RESOLVED", "RETURN_CONFIRMED"].every((e) => m[`bonus.awarded.body.${e}`]), `server texts in ${l}`);
  }

  // 3. The other party's level in the match chat: level, stars and returns only, only while on.
  const matches = read("server/routes/matches.js");
  ok(/if \(bonusEnabled\(\)\) \{/.test(matches) && /counterpart_helper: counterpartHelper/.test(matches), "level sent only while the bonus is on");
  ok(/match\.lost\.user_id === user\.id \? match\.found\.user_id : match\.lost\.user_id/.test(matches), "the other party, both directions");
  const statusSrc = bonus.helperStatus.toString();
  ok(!/balance|remaining/.test(statusSrc) && /stars: helperStars\(returns\)/.test(statusSrc), "never the balance");

  // 4. App.
  const screen = read("app/bonus.tsx");
  ok(/!b \|\| !b\.enabled \?/.test(screen), "screen says so when the bonus is off");
  ok(/starText\(b\.stars\)/.test(screen) && /bonus\.nextStar/.test(screen), "stars and next star shown");
  ok(/BONUS_EVENTS\.map/.test(screen) && /bonus\.rules/.test(screen), "how bonus is earned");
  const profile = read("app/(tabs)/profile.tsx");
  ok(/\.\.\.\(bonus\?\.enabled/.test(profile) && /router\.push\("\/bonus"\)/.test(profile), "profile row only while on");
  const chat = read("app/chat/[matchId].tsx");
  ok(/setHelper\(toHelperStatus\(j\?\.counterpart_helper\)\)/.test(chat) && /<HelperBadge helper=\{helper\} \/>/.test(chat), "match chat shows the other party's level");
  const obsChat = read("app/observation-chat/[id].tsx");
  ok(/setHelper\(toHelperStatus\(j\?\.counterpart_helper\)\)/.test(obsChat) && /<HelperBadge helper=\{helper\} \/>/.test(obsChat), "observation chat too");
  const obsRoute = read("server/routes/observationChat.js");
  ok(/if \(!bonusEnabled\(\)\) return null;/.test(obsRoute) && /o\.observer_user_id === userId \? o\.report_owner_user_id : o\.observer_user_id/.test(obsRoute), "observation chat: the other party, only while on");
  ok(/counterpart_helper: await counterpartHelper\(o, userId\)/.test(obsRoute), "sent with the messages");
  ok(!/\.balance|balanceValue/.test(read("src/ui/HelperBadge.tsx")), "badge never shows the balance");
  ok(/notificationType === "BONUS_AWARDED"\) \{\s*router\.push\("\/bonus"\);/.test(read("app/notifications.tsx")), "notice opens «Din bonus»");
  const helper = read("src/lib/helperBonus.ts");
  ok(/RETURN_CONFIRMED: 15/.test(helper) && /FOUND_REGISTERED: 1/.test(helper), "points shown match the server");
  eq(bonus.POINTS.RETURN_CONFIRMED, 15, "server 15 for a return");

  console.log(`T1.9AX OK (${n} checks)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
