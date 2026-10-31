"use strict";
// T1.9M behavior test: report and block in chat, automatic suspension, admin list, extension price.
//   node .\scripts\test-t1-9m.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};
const eq = (a, b, label) => {
  assert.deepStrictEqual(a, b, `${label}: got ${JSON.stringify(a)}`);
  n++;
};

// 1. Rules.
const cs = require(path.join(root, "server", "lib", "chatSafety.js"));
eq(cs.normalizeReport({ reason: "scam", details: "  ba om   kortnummer " }).value, { reason: "SCAM", details: "ba om kortnummer", block: true }, "report is cleaned, block by default");
eq(cs.normalizeReport({ reason: "SPAM", block: false }).value.block, false, "block can be left out");
eq(cs.normalizeReport({ reason: "NOPE" }).error, "INVALID_REPORT_REASON", "unknown reason refused");
eq(cs.normalizeReport({ reason: "OTHER", details: "x".repeat(1001) }).error, "INVALID_REPORT_DETAILS", "long details refused");
eq([cs.contextType("match"), cs.contextType("OBSERVATION"), cs.contextType("x")], ["MATCH", "OBSERVATION", null], "chat kinds");

const msgs = Array.from({ length: 60 }, (_, i) => ({ sender_id: i % 2 ? "bad" : "me", body: `m${i}`, created_at: `t${i}` }));
const snap = cs.snapshotMessages(msgs, "me");
eq([snap.length, snap[0].body, snap[49].body, snap[49].from, snap[48].from], [50, "m10", "m59", "REPORTED", "REPORTER"], "evidence keeps the last 50 messages with sender role");

const NOW = Date.parse("2026-10-31T12:00:00Z");
const day = (d) => new Date(NOW - d * 864e5).toISOString();
ok(cs.shouldAutoSuspend([{ reporter_id: "a", created_at: day(1) }, { reporter_id: "b", created_at: day(2) }, { reporter_id: "c", created_at: day(29) }], NOW), "three people within 30 days suspend");
ok(!cs.shouldAutoSuspend([{ reporter_id: "a", created_at: day(1) }, { reporter_id: "a", created_at: day(2) }, { reporter_id: "b", created_at: day(3) }], NOW), "the same person twice does not count twice");
ok(!cs.shouldAutoSuspend([{ reporter_id: "a", created_at: day(1) }, { reporter_id: "b", created_at: day(2) }, { reporter_id: "c", created_at: day(31) }], NOW), "reports older than 30 days do not count");
ok(!cs.shouldAutoSuspend([{ reporter_id: "a", created_at: day(1) }, { reporter_id: "b", created_at: day(2) }, { reporter_id: "c", created_at: day(3), status: "NO_ACTION" }], NOW), "handled reports do not count");

eq(cs.chatState({ me: "me", other: "x", blocks: [{ blocker_id: "me", blocked_id: "x" }] }), { blockedByMe: true, selfSuspended: false, closed: true }, "my block");
eq(cs.chatState({ me: "me", other: "x", blocks: [{ blocker_id: "x", blocked_id: "me" }] }), { blockedByMe: false, selfSuspended: false, closed: true }, "the other's block only shows as closed");
eq(cs.chatState({ me: "me", other: "x", suspendedUserIds: ["x"] }).closed, true, "chat with a suspended account is closed");
eq(cs.chatState({ me: "me", other: "x", suspendedUserIds: ["me"] }).selfSuspended, true, "own suspension is shown");
eq(cs.chatState({ me: "me", other: "x" }).closed, false, "open chat");

const ADMIN = "11111111-2222-3333-4444-555555555555";
const env = { ADMIN_USER_IDS: ` ${ADMIN.toUpperCase()} , not-an-id` };
eq(cs.adminUserIds(env), [ADMIN], "admin ids are read and checked");
ok(cs.isAdmin(ADMIN, env) && !cs.isAdmin("someone", env) && !cs.isAdmin(ADMIN, {}), "admin check");

// 2. Admin e-mail (optional) and texts.
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith("userNotify") || request.endsWith("supabaseClient")) return { notifyUser: async () => ({}), supaAdmin: {} };
  return realLoad.call(this, request, parent, isMain);
};
const { adminEmailRequest } = require(path.join(root, "server", "lib", "adminAlert.js"));
Module._load = realLoad;
eq(adminEmailRequest({ reason: "SCAM" }, {}), null, "no e-mail without configuration");
const mail = adminEmailRequest({ reason: "SCAM", details: null, autoSuspended: true }, { RESEND_API_KEY: "k", ADMIN_ALERT_EMAIL: "a@x.no", ADMIN_ALERT_FROM: "Lost or Found <varsel@x.no>" });
const mailBody = JSON.parse(mail.init.body);
ok(mail.url === "https://api.resend.com/emails" && mail.init.headers.Authorization === "Bearer k", "e-mail via Resend");
ok(/Svindel eller ber om penger/.test(mailBody.text) && /stengt automatisk/.test(mailBody.text) && /\(ingen\)/.test(mailBody.text), "e-mail text names reason and suspension");
for (const lang of ["no", "en"]) {
  const loc = JSON.parse(read(`server/locales/${lang}.json`));
  for (const r of cs.REPORT_REASONS) ok(!!loc[`safety.reason.${r}`], `server text ${lang} ${r}`);
}

// 3. Database.
const sql = read("supabase/migrations/20261031150000_t1_9m_chat_reports_and_blocks.sql");
ok(/with check \([\s\S]*is_conversation_participant\(conversation_id\)[\s\S]*can_send_chat_message\(conversation_id\)/.test(sql), "messages from the app are checked in the database");
ok(/users_blocked_either_way[\s\S]*is_account_suspended\(p\.lost_user_id\)[\s\S]*is_account_suspended\(p\.found_user_id\)/.test(sql), "blocks both ways and suspensions close the chat");
ok(/interval '1 minute'\) < 30[\s\S]*interval '24 hours'\) < 500/.test(sql), "message limits also apply to direct writes");
for (const tbl of ["user_blocks", "account_suspensions", "chat_reports"]) ok(new RegExp(`alter table public\\.${tbl} enable row level security`).test(sql), `${tbl} locked for clients`);
ok(/create unique index if not exists chat_reports_one_open_idx[\s\S]*where status = 'OPEN'/.test(sql), "one open report per person");
ok(!/create (table|index|unique index) (?!if not exists)/i.test(sql) && /drop policy if exists "messages_insert_participant"[\s\S]*create policy "messages_insert_participant"/.test(sql), "repeatable");

// 4. Server wiring.
const index = read("server/index.js");
ok(/app\.use\("\/safety", safetyRoutes\)/.test(index), "safety routes mounted");
const safety = read("server/routes/safety.js");
ok(/suspendIfReportedByMany\(other\)/.test(safety) && /notifyAdmins\(/.test(safety), "report suspends on the third person and tells the admins");
ok(/router\.get\("\/admin\/reports", requireUser, requireAdmin/.test(safety) && /"\/admin\/users\/:userId\/restore", requireUser, requireAdmin/.test(safety), "admin routes need an admin");
ok(/status: "NO_ACTION"[\s\S]*\.eq\("reported_user_id", userId\)[\s\S]*\.eq\("status", "OPEN"\)/.test(safety), "restore closes open reports so they do not suspend again");
ok(/isChatClosed\(req\.user\.id, otherUser\)/.test(read("server/routes/matches.js")), "match chat route checks blocks");
ok(/isChatClosed\(userId, otherId\)/.test(read("server/routes/observationChat.js")), "observation chat checks blocks");
ok(/isSuspended\(user\.id\)[\s\S]{0,80}ACCOUNT_SUSPENDED/.test(read("server/routes/reports.js")), "suspended accounts cannot create reports");
ok(/isSuspended\(userId\)[\s\S]{0,80}ACCOUNT_SUSPENDED/.test(read("server/routes/observations.js")), "suspended accounts cannot send observations");
ok(/type === "SAFETY_REPORT"[\s\S]{0,120}isAdmin\(userId\)/.test(read("server/routes/notifications.js")), "admin notices open the report list");

// 5. App.
const chat = read("app/chat/[matchId].tsx");
ok(/<ChatSafetyMenu[\s\S]*kind="match"/.test(chat) && /safety\.state\.closed \? \(\s*<ChatClosedBar/.test(chat), "match chat: menu and closed bar");
ok(/const state = await safety\.reload\(\);/.test(chat), "match chat explains a refused message");
const obs = read("app/observation-chat/[id].tsx");
ok(/<ChatSafetyMenu kind="observation"/.test(obs) && /safety\.state\.closed\?<ChatClosedBar/.test(obs), "observation chat: menu and closed bar");
ok(/router\.push\("\/safety-reports"\)/.test(read("app/(tabs)/profile.tsx")) && /isAdmin/.test(read("app/(tabs)/profile.tsx")), "admin entry in Profile");
ok(/safetyReports/.test(read("app/notifications.tsx")) && /safety_report/.test(read("src/lib/pushNotifications.ts")), "admin notices open the list");
const ue = requireTs(path.join(root, "src/lib/userError.ts"), { "./sentry": { reportHandledError: () => {} } });
for (const code of ["CHAT_CLOSED", "ACCOUNT_SUSPENDED", "REPORT_ALREADY_OPEN"]) ok(ue.knownErrorKey({ code }) != null, `text for ${code}`);
const appSafety = requireTs(path.join(root, "src/lib/chatSafety.ts"), {
  "./config": { API_BASE_URL: "" },
  "./supabase": { supabase: {} },
  "./userError": { codedError: (c) => Object.assign(new Error(c), { code: c }) },
});
eq([...appSafety.REPORT_REASONS], cs.REPORT_REASONS, "app and server agree on reasons");
const noLoc = read("src/i18n/locales/no.ts");
for (const key of Object.values(appSafety.REPORT_REASON_KEYS)) ok(noLoc.includes(`"${key}"`), `app text ${key}`);
eq(appSafety.reportedQuote({ message_snapshot: [{ from: "REPORTED", body: "a" }, { from: "REPORTER", body: "b" }, { from: "REPORTED", body: "c" }, { from: "REPORTER", body: "d" }] }), "c", "quote is the reported person's last message");

// 6. Extension price comes from the catalog.
const life = read("src/lib/reportLifecycle.ts");
ok(!/REACTIVATION_TEST_PRICE/.test(life + read("app/my-reports.tsx") + read("app/report-details/[id].tsx")), "no fixed extension price in the app");
ok(/REPORT_PRODUCT_CODES\.REPORT_REACTIVATION[\s\S]{0,40}\)/.test(life) && /base_price_ore/.test(life), "price read from the catalog");

console.log(`OK: T1.9M checks passed (${n} assertions).`);
