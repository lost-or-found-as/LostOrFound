"use strict";
// T1.9G behavior test: case activity, "Neste steg", notification display and singular texts.
//   node .\scripts\test-t1-9g.js
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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-30T12:00:00Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

// 1. Server: activity summary and timeline (pure builder).
const { buildReportActivity } = require(path.join(root, "server", "lib", "reportActivity.js"));
const owner = "user-owner";
const built = buildReportActivity({
  report: { id: "r1", user_id: owner, type: "LOST", created_at: iso(-5 * DAY), closed_at: null, last_extended_at: null },
  matches: [
    { id: "m1", status: "NEW", score: 88, created_at: iso(-2 * DAY) },
    { id: "m2", status: "SEEN", score: 60, created_at: iso(-1 * DAY) },
    { id: "m3", status: "DISMISSED", score: 90, created_at: iso(-1 * DAY) },
    { id: "m4", status: "CONFIRMED", score: 75, created_at: iso(-3 * DAY) },
  ],
  confirmations: [{ entity_id: "m4", created_at: iso(-3 * DAY + 1000) }],
  lastMessages: [{ conversation_id: "m4", sender_id: "user-finder", created_at: iso(-60 * 60 * 1000) }],
  unreadByMatch: { m4: 2 },
  observations: [{ id: "o1", observation_type: "SEEN", status: "NEW", created_at: iso(-4 * DAY) }],
  campaigns: [{ id: "c1", radius_m: 1000, activated_at: iso(-4.5 * DAY) }],
  orders: [{ product_code: "REPORT_REACTIVATION", paid_at: null }],
});
eq(built.summary.possibleMatches, 2, "open matches exclude dismissed and confirmed");
eq(built.summary.strongMatches, 1, "strong matches from score 70");
eq(built.summary.bestScore, 88, "best open score");
eq(built.summary.confirmedMatches, 1, "confirmed matches");
eq(built.summary.unreadMessages, 2, "unread messages summed");
eq(built.summary.chatMatchId, "m4", "chat to open");
eq(built.summary.newObservations, 1, "new observations");
eq(
  built.events.map((e) => e.type),
  ["MESSAGE", "MATCHES_FOUND", "MATCH_CONFIRMED", "OBSERVATION", "AREA_ALERT_SENT", "CREATED"],
  "timeline newest first, unpaid orders left out",
);
const message = built.events[0];
ok(message.fromMe === false && message.unread === 2 && message.matchId === "m4", "message event from the other party");
ok(built.events[1].count === 2 && built.events[1].strong === 1, "matches event counts");
const quiet = buildReportActivity({ report: { id: "r2", user_id: owner, type: "FOUND", created_at: iso(-DAY) } });
eq(quiet.events.map((e) => e.type), ["CREATED"], "a new case only has the created event");
eq(quiet.summary.chatMatchId, null, "no chat without a confirmed match");

// 2. Server wiring.
const activityRoute = read("server/routes/reportsActivity.js");
ok(/router\.get\("\/:id\/activity", requireUser/.test(activityRoute), "activity route requires an account");
ok(/\.eq\("user_id", userId\)[\s\S]*?\.is\("deleted_at", null\)/.test(activityRoute), "activity only for the owner's live case");
ok(/from\("conversation_reads"\)[\s\S]*?\.eq\("user_id", userId\)/.test(activityRoute), "unread uses the caller's own read time");
const matchesRoute = read("server/routes/matches.js");
ok(/module\.exports\.loadReportMatches = loadReportMatches/.test(matchesRoute), "match list and activity share one loader");
ok(/const loaded = await loadReportMatches\(reportId, user\.id\)/.test(matchesRoute), "match list uses the shared loader");

// 3. App: Neste steg and timeline texts (real TypeScript).
const stubs = {
  "./config": { API_BASE_URL: "http://test" },
  "./supabase": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "./reportCommerce": { createReportOrder: async () => ({}), activateTestReportOrder: async () => ({}) },
};
const activity = requireTs(path.join(root, "src/lib/reportActivity.ts"), stubs);
const { nextStep, activityText, activityTarget, EMPTY_ACTIVITY } = activity;
const sum = (over) => ({ ...EMPTY_ACTIVITY.summary, ...over });
const active = (type, days = 20, extra = {}) => ({ id: "r", type, status: "ACTIVE", visible_until: iso(days * DAY), ...extra });

eq(nextStep(active("LOST", 20, { closed_at: iso(-DAY) }), sum({ possibleMatches: 3 }), NOW).kind, "closed", "closed wins");
const unread = nextStep(active("LOST"), sum({ confirmedMatches: 1, chatMatchId: "m4", unreadMessages: 2, possibleMatches: 3 }), NOW);
ok(unread.kind === "unreadChat" && unread.action === "openChat" && unread.params.count === 2, "unread chat before matches");
eq(nextStep(active("LOST"), sum({ confirmedMatches: 1, chatMatchId: "m4" }), NOW).kind, "chat", "confirmed match opens chat");
const matches = nextStep(active("LOST"), sum({ possibleMatches: 3, strongMatches: 1 }), NOW);
ok(matches.kind === "matches" && matches.bodyKey === "caseDetail.next.matchesBodyLostStrong" && matches.action === "openMatches", "lost case with a strong match");
eq(nextStep(active("FOUND"), sum({ possibleMatches: 1 }), NOW).bodyKey, "caseDetail.next.matchesBodyFound", "finder waits for the owner");
const expiredLost = nextStep(active("LOST", -1), sum({}), NOW);
ok(expiredLost.kind === "expired" && expiredLost.action === "extendLost", "expired lost case can be extended");
const expiredFoundLimit = nextStep(active("FOUND", -1, { extension_count: 2 }), sum({}), NOW);
ok(expiredFoundLimit.kind === "expired" && expiredFoundLimit.action === null, "found case at the extension limit has no action");
const expiring = nextStep(active("FOUND", 3), sum({}), NOW);
ok(expiring.kind === "expiring" && expiring.action === "extendFound" && expiring.params.count === 3, "found case can be extended in the last week");
eq(nextStep(active("FOUND", 20), sum({}), NOW).titleKey, "caseDetail.next.searchingTitleFound", "found case is searching");
eq(nextStep(active("LOST", 5), sum({}), NOW).titleKey, "caseDetail.next.searchingTitleLost", "lost case is searching");

eq(activityText({ type: "MESSAGE", at: iso(0), matchId: "m", fromMe: false, unread: 1 }, "LOST"), { key: "caseDetail.activity.messageFromFinder", params: {}, tone: "new" }, "message from the finder");
eq(activityText({ type: "MESSAGE", at: iso(0), matchId: "m", fromMe: false, unread: 0 }, "FOUND").key, "caseDetail.activity.messageFromOwner", "message from the owner");
eq(activityText({ type: "MATCHES_FOUND", at: iso(0), count: 4, strong: 0 }, "LOST").params, { count: 4 }, "matches count");
eq(activityTarget({ type: "OBSERVATION", at: iso(0), observationId: "o1", kind: "SEEN", isNew: true }), { kind: "observation", id: "o1" }, "observation opens");
eq(activityTarget({ type: "CREATED", at: iso(0) }), null, "created is informational");

// Every key the rules can return exists in both languages.
const { en } = requireTs(path.join(root, "src/i18n/locales/en.ts"));
const { no } = requireTs(path.join(root, "src/i18n/locales/no.ts"));
const appSource = read("src/lib/reportActivity.ts");
const usedKeys = [...new Set([...appSource.matchAll(/"((?:caseDetail)\.[\w.]+)"/g)].map((m) => m[1]))];
ok(usedKeys.length > 30, "found the keys used by the rules");
for (const key of usedKeys) ok(key in en && key in no, `key exists: ${key}`);

// 4. Singular forms.
const { translate } = requireTs(path.join(root, "src/i18n/translate.ts"));
eq(translate("no", "caseDetail.next.matchesTitle", { count: 1 }), "1 mulig treff", "Norwegian singular");
eq(translate("no", "caseDetail.next.matchesTitle", { count: 3 }), "3 mulige treff", "Norwegian plural");
eq(translate("en", "caseDetail.next.matchesTitle", { count: 1 }), "1 possible match", "English singular");
eq(translate("no", "notifications.unread.count", { count: 1 }), "1 ulest", "unread singular");
eq(translate("no", "cases.active.days.left", { count: 1 }), "Aktiv · 1 d igjen", "keys without a singular form are unchanged");
const oneKeys = Object.keys(en).filter((k) => k.endsWith("_one"));
ok(oneKeys.every((k) => k.slice(0, -4) in en), "every singular form has a base key");

// 5. Notification display and grouping.
const display = requireTs(path.join(root, "src/lib/notificationDisplay.ts"));
eq(display.notificationIcon("MATCH_CONFIRMED"), { icon: "checkmark", tone: "success" }, "confirmed icon");
eq(display.notificationIcon("unknown").icon, "notifications-outline", "fallback icon");
const today = new Date(NOW);
today.setHours(8, 0, 0, 0);
const yesterday = new Date(today.getTime() - DAY);
const grouped = display.groupByDay(
  [{ id: "a", created_at: today.toISOString() }, { id: "b", created_at: yesterday.toISOString() }, { id: "c", created_at: "bad" }],
  NOW,
);
eq([grouped.today.map((x) => x.id), grouped.earlier.map((x) => x.id)], [["a"], ["b", "c"]], "I dag and Tidligere");

// 6. Screens.
const details = read("app/report-details/[id].tsx");
ok(/fetchReportActivity\(String\(id\)\)/.test(details) && /nextStep\(r, activity\.summary\)/.test(details), "Saksdetaljer shows Neste steg");
ok(/icon="ellipsis-horizontal"/.test(details) && /caseDetail\.menu\.delete/.test(details), "case actions in the ⋯ menu");
ok(!/caseDetail\.additional\.services|caseDetail\.edit\.report/.test(details), "empty cards and the big edit button are gone");
const notifications = read("app/notifications.tsx");
ok(!/AuthHeaderAction/.test(notifications), "no log-out button in Varsler");
ok(/icon="trash-outline"/.test(notifications) && /\/notifications\/read-all/.test(notifications), "trash button and mark all as read");
ok(!/Alert\.alert/.test(notifications) && !/Alert\.alert/.test(details), "no system dialogs");
ok(/from "\.\.\/src\/lib\/reportLifecycle"/.test(read("app/my-reports.tsx")), "My cases uses the shared lifecycle rules");

console.log(`OK: T1.9G checks passed (${n} assertions).`);
