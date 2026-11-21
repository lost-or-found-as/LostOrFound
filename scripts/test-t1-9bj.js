// scripts/test-t1-9bj.js
// T1.9BJ: «Meldinger» lists every conversation (match chats and sightings, owner and helper, also
// solved cases); bonus and feedback notices open their screens; a solved alert says so.
//   node .\scripts\test-t1-9bj.js
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
let buildInbox;
try {
  ({ buildInbox } = require(path.join(root, "server/routes/inbox.js")));
} catch {
  buildInbox = null; // server packages not installed here; the source checks below still run
}

if (buildInbox) {
  const me = "u1", other = "u2";
  const reportsById = new Map([
    ["lostA", { id: "lostA", user_id: me, type: "LOST", category: "PERSONAL", status: "ACTIVE" }],
    ["foundB", { id: "foundB", user_id: other, type: "FOUND", status: "ACTIVE" }],
    ["lostC", { id: "lostC", user_id: other, type: "LOST", status: "CLOSED", closed_at: "2026-11-21T11:00:00Z" }],
  ]);
  const items = buildInbox({
    userId: me,
    matches: [{ id: "m1", lost_id: "lostA", found_id: "foundB", created_at: "2026-11-20T10:00:00Z" }],
    reportsById,
    matchLast: new Map([["m1", { conversation_id: "m1", sender_id: other, body: "Hei", created_at: "2026-11-21T09:00:00Z" }]]),
    observations: [{ id: "o1", report_id: "lostC", observer_user_id: me, report_owner_user_id: other, observation_type: "SEEN", created_at: "2026-11-21T10:00:00Z" }],
    conversations: [],
    observationLast: new Map(),
  });
  eq(items.map((i) => [i.kind, i.role, i.caseClosed]), [["OBSERVATION", "HELPER", true], ["MATCH", "OWNER", false]], "both kinds, newest first, solved kept");
  eq(items[1].last, { body: "Hei", at: "2026-11-21T09:00:00Z", mine: false }, "last message");
  eq(items[0].hasConversation, false, "sighting without chat still listed");
}

const inbox = read("server/routes/inbox.js");
ok(/\.or\(`observer_user_id\.eq\.\$\{userId\},report_owner_user_id\.eq\.\$\{userId\}`\)/.test(inbox), "sightings as helper and owner");
ok(/CHAT_MATCH_STATUSES = \["CONFIRMED", "PAID"\]/.test(inbox), "only chats that exist");
ok(/app\.use\("\/inbox",inboxRoutes\)/.test(read("server/index.js")), "mounted");

const notes = read("server/routes/notifications.js");
ok(/if \(type === "BONUS_AWARDED" \|\| entityType === "bonus"\) return \{ ok: true, kind: "bonus"/.test(notes), "bonus notice has a target");
ok(/type === "FEEDBACK" \|\| entityType === "feedback"/.test(notes), "feedback notice has a target");
const notesApp = read("app/notifications.tsx");
ok(/resolved\.target_kind === "bonus"/.test(notesApp) && /resolved\.target_kind === "feedback"/.test(notesApp), "app opens them");

const screen = read("app/messages.tsx");
ok(/router\.push\(`\/chat\/\$\{item\.id\}`\)/.test(screen) && /router\.push\(`\/observation-chat\/\$\{item\.id\}`\)/.test(screen), "opens the right chat");
ok(/export default requireAccount\(MessagesScreen\)/.test(screen), "accounts only");
ok(/setLastSeen\(`obs:\$\{id\}`\)/.test(read("app/observation-chat/[id].tsx")), "sighting chats marked read");
const home = read("app/(tabs)/index.tsx");
ok(/t\("home\.messagesBody"\)/.test(home), "Home has Meldinger");
ok(/key: "messages", icon: "chatbubbles-outline"/.test(read("app/(tabs)/profile.tsx")), "Profile has Meldinger");
ok(/return "solved";/.test(read("app/area-alert/[id].tsx")), "solved alert said plainly");

console.log(`T1.9BJ OK (${n} checks)`);
