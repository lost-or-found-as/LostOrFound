// scripts/test-t1-9bs.js
// T1.9BS: QR tags. A finder scans, writes on a web page without the app, and the owner answers in
// the app. Neither sees the other's contact details; the tag's label is never public.
//   node .\scripts\test-t1-9bs.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const tags = require(path.join(root, "server/lib/itemTags.js"));
const tp = require(path.join(root, "server/lib/tagPage.js"));

// Codes: eight characters without look-alikes; typing is forgiving about case, spaces and dashes.
for (let i = 0; i < 200; i++) {
  const c = tags.newCode();
  ok(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(c), `code ${c} uses the safe alphabet`);
}
eq(tags.normalizeCode("abcd-2345"), "ABCD2345", "lowercase with dash");
eq(tags.normalizeCode(" ABCD 2345 "), "ABCD2345", "spaces");
eq(tags.normalizeCode("ABCD0345"), null, "zero is not in the alphabet");
eq(tags.normalizeCode("ABCDI345"), null, "I is not in the alphabet");
eq(tags.normalizeCode("ABC2345"), null, "too short");
eq(tags.formatCode("ABCD2345"), "ABCD-2345", "shown with a dash");

// Finder token: random, only the hash is stored.
const tok = tags.newFinderToken();
ok(tags.validToken(tok) && tok.length >= 32, "token is long and url-safe");
ok(tags.hashToken(tok) !== tok && /^[0-9a-f]{64}$/.test(tags.hashToken(tok)), "token hash is sha256 hex");
ok(!tags.validToken("short") && !tags.validToken("../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "bad tokens are refused");

// Input.
eq(tags.normalizeKind("keys"), "KEYS", "kind upper-cased");
eq(tags.normalizeKind("ROCKET"), "OTHER", "unknown kind becomes OTHER");
eq(tags.normalizeLabel("   "), null, "empty label");
eq(tags.normalizeLabel("x".repeat(60)).length, tags.LIMITS.labelMax, "label cut");
eq(tags.normalizeMessage(" a ").ok, false, "too short");
eq(tags.normalizeMessage("x".repeat(1001)).code, "TAG_MESSAGE_TOO_LONG", "too long");
eq(tags.normalizeMessage("Hei\r\n\n\n\nder\u0007").body, "Hei\n\nder", "line breaks kept, control characters removed");

// States and unread.
eq(tags.tagState(null), "UNKNOWN", "no tag");
eq(tags.tagState({ owner_id: null, active: true }), "UNCLAIMED", "printed, not claimed");
eq(tags.tagState({ owner_id: "u", active: false }), "PAUSED", "paused");
eq(tags.tagState({ owner_id: "u", active: true }), "ACTIVE", "active");
ok(tags.ownerUnread({ owner_read_at: null, last_message_at: "2026-11-23T10:00:00Z" }, "FINDER"), "never read");
ok(!tags.ownerUnread({ owner_read_at: "2026-11-23T11:00:00Z", last_message_at: "2026-11-23T10:00:00Z" }, "FINDER"), "read after");
ok(!tags.ownerUnread({ owner_read_at: null, last_message_at: "2026-11-23T10:00:00Z" }, "OWNER"), "own reply is not unread");

// Public pages: escaping, no label, states.
const active = tp.renderTagPage({ lang: "no", state: "ACTIVE", kind: "KEYS", code: "ABCD2345", action: "https://x/t/ABCD2345?lang=no" });
ok(/Takk for at du skannet/.test(active) && /Nøkler/.test(active) && /ABCD-2345/.test(active), "active page in Norwegian");
ok(/<form method="post" action="https:\/\/x\/t\/ABCD2345\?lang=no">/.test(active) && /maxlength="1000"/.test(active), "form posts to the tag");
for (const [state, text] of [["UNCLAIMED", "not in use yet"], ["PAUSED", "paused"], ["UNKNOWN", "Unknown tag"]]) {
  const html = tp.renderTagPage({ lang: "en", state });
  ok(html.includes(text) && !/<form/.test(html), `${state}: no form`);
}
const thread = tp.renderThreadPage({ lang: "en", messages: [{ sender: "FINDER", body: "<script>x</script>" }, { sender: "OWNER", body: "Thanks!" }], status: "OPEN", action: "a", justStarted: true });
ok(!/<script>x/.test(thread) && /&lt;script&gt;/.test(thread), "messages are escaped");
ok(/Sent! The owner has been told/.test(thread) && /Save this page/.test(thread), "finder is told to keep the link");
ok(!/has not replied yet/.test(thread), "no waiting text after a reply");
ok(!/<form/.test(tp.renderThreadPage({ lang: "en", messages: [], status: "CLOSED", action: "a" })), "closed: no form");
const sheet = tp.renderPrintSheet({ lang: "no", code: "ABCD2345", qrSvg: "<svg></svg>" });
eq((sheet.match(/class="big"/g) || []).length, tp.BIG_STICKERS, "six large stickers");
eq((sheet.match(/class="small"/g) || []).length, tp.SMALL_STICKERS, "fifteen small stickers");
ok(/Skriv ut arket/.test(sheet), "print button");

// Server wiring.
const pages = read("server/routes/tagPages.js");
ok(/finder_token_hash: tags\.hashToken\(token\)/.test(pages), "only the token hash is stored");
ok(/redirect\(303/.test(pages), "post/redirect/get");
ok(/threadsPerVisitorPerDay/.test(pages) && /threadsPerTagPerDay/.test(pages) && /finderMessagesPerThreadPerDay/.test(pages), "limits are used");
ok(/BLOCKING_REASONS/.test(pages) && !/NAMED_PERSON"\]/.test(pages), "text check blocks insults, not names");
ok(!/\.label\b/.test(read("server/lib/tagPage.js")) && !/renderTagPage\([^)]*label/.test(pages), "the tag label never reaches a public page");
const api = read("server/routes/tags.js");
ok(/\.is\("owner_id", null\)/.test(api), "a printed code can only be claimed once");
ok(/TAG_CODE_UNAVAILABLE/.test(api), "unknown and taken codes look the same");
ok(/requireUser/.test(api) && !/requireUserOrGuest/.test(api), "accounts only");
const index = read("server/index.js");
ok(/app\.use\("\/tags",tagRoutes\)/.test(index) && /app\.use\("\/t",tagPageRoutes\)/.test(index), "routes mounted");
ok(/type === "TAG_MESSAGE" \|\| entityType === "tag_thread"/.test(read("server/routes/notifications.js")), "notification opens the conversation");
ok(/"tag_threads", "owner_id", \["finder_token_hash", "visitor_key"\]/.test(read("server/lib/privacyExport.js")), "privacy export without finder secrets");
ok(/tag_messages/.test(read("server/lib/privacyExport.js")), "privacy export has the messages");

// Migration.
const sql = read("supabase/migrations/20261124100000_t1_9bs_item_tags.sql");
for (const tbl of ["item_tags", "tag_threads", "tag_messages"]) {
  ok(new RegExp(`create table if not exists public\\.${tbl}`).test(sql), `${tbl} created`);
  ok(new RegExp(`alter table public\\.${tbl} enable row level security`).test(sql), `${tbl} RLS`);
  ok(new RegExp(`revoke all on table public\\.${tbl} from anon, authenticated`).test(sql), `${tbl} server only`);
}
ok(/create unique index if not exists item_tags_code_unique/.test(sql), "codes are unique");

// Locales: server no/en/de and app no/en.
const loc = (l) => JSON.parse(read(`server/locales/${l}.json`));
const keys = (o) => Object.keys(o).filter((k) => k.startsWith("tag.") || k.startsWith("push.tag")).sort();
eq(keys(loc("no")), keys(loc("en")), "server no/en tag keys");
eq(keys(loc("de")), keys(loc("en")), "server de/en tag keys");
for (const k of ["KEYS", "BAG", "WALLET", "PHONE", "BIKE", "PET", "OTHER"]) ok(loc("en")[`tag.kind.${k}`], `server kind ${k}`);
const app = (f) => (read(f).match(/"tags\.[^"]+"/g) || []).sort();
eq([...new Set(app("src/i18n/locales/no.ts"))], [...new Set(app("src/i18n/locales/en.ts"))], "app no/en tag keys");

// App wiring.
ok(/router\.push\("\/tags"\)/.test(read("app/(tabs)/profile.tsx")), "Profile links to QR tags");
ok(/tagThread/.test(read("app/notifications.tsx")), "in-app notification opens the conversation");
ok(/kind === "tag_thread"/.test(read("src/lib/pushNotifications.ts")), "push opens the conversation");
for (const f of ["app/tags.tsx", "app/tag-details.tsx", "app/tag-thread.tsx"]) ok(/export default requireAccount\(Screen\)/.test(read(f)), `${f} needs an account`);

console.log(`OK: T1.9BS ${n} checks`);
