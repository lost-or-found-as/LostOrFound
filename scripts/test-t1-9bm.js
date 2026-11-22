// scripts/test-t1-9bm.js
// T1.9BM: chats about a solved case stay open 7 days, then read-only (app, server and database);
// closed cases offer no possible matches; the created sheet shows both reach choices as buttons.
//   node .\scripts\test-t1-9bm.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const { solvedChatState } = require(path.join(root, "server/lib/chatAfterSolved.js"));
const day = 86400000, now = Date.parse("2026-11-22T12:00:00Z");
eq(solvedChatState([{ status: "ACTIVE" }], now), null, "open case: nothing");
eq(solvedChatState([{ status: "CLOSED", closed_at: new Date(now - 2 * day).toISOString() }], now), { closesAt: new Date(now + 5 * day).toISOString(), closed: false }, "2 days after: 5 days left");
eq(solvedChatState([{ status: "CLOSED", closed_at: new Date(now - 8 * day).toISOString() }, { status: "ACTIVE" }], now).closed, true, "8 days after: read-only");

const sql = read("supabase/migrations/20261122100000_t1_9bm_chat_after_solved.sql");
ok(/before insert on public\.messages/.test(sql) && /raise exception 'CHAT_CLOSED_AFTER_SOLVED'/.test(sql), "database refuses late messages");
ok(/interval '7 days'/.test(sql) && /if not exists \(select 1 from pg_trigger/.test(sql), "7 days, repeatable");
const oc = read("server/routes/observationChat.js");
ok(/if \(solved\?\.closed\) return res\.status\(403\)\.json\(\{ error: "CHAT_CLOSED_AFTER_SOLVED"/.test(oc) && /solved: await solvedState\(o\)/.test(oc), "observation chat too");

ok(/solvedChatState\(\[match\.lost as any, match\.found as any\]\)/.test(read("app/chat/[matchId].tsx")), "match chat knows");
for (const f of ["app/chat/[matchId].tsx", "app/observation-chat/[id].tsx"]) ok(/<SolvedChatBar/.test(read(f)) && /solved\?\.closed \? null :/.test(read(f)), `${f} hides the composer when read-only`);
ok(/CHAT_CLOSED_AFTER_SOLVED: "chat\.solvedClosed"/.test(read("src/lib/userError.ts")), "error text");

const my = read("app/my-reports.tsx");
ok(/const offerMatches = count > 0 && !caseClosed;/.test(my) && /\{offerMatches && \(/.test(my), "no possible matches on closed cases");
const det = read("app/report-details/[id].tsx");
ok(/label=\{t\("caseDetail\.created\.visibilityOnlyButton"\)\}/.test(det) && /label=\{t\("caseDetail\.created\.areaAlert"\)\}/.test(det), "both reach choices as buttons");
for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["chat.solvedOpenUntil", "chat.solvedClosed", "caseDetail.created.reachTitle", "caseDetail.created.visibilityOnlyButton"]) ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
console.log(`T1.9BM OK (${n} checks)`);
