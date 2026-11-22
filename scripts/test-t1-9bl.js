// scripts/test-t1-9bl.js
// T1.9BL: Meldinger gets a filter, active and folded solved sections, the item's photo (never a
// held one), the other person's helper level and an unread count.
//   node .\scripts\test-t1-9bl.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const inbox = read("server/routes/inbox.js");
ok(/loadThumbnailUrls\(supaAdmin, \[\.\.\.new Set\(items\.map\(\(i\) => i\.photoReportId\)\.filter\(Boolean\)\)\], \{ skipHeld: true \}\)/.test(inbox), "photos without held ones");
ok(/if \(bonusEnabled\(\)\)/.test(inbox) && /helperStatus\(\{ supa: supaAdmin, userId: id \}\)/.test(inbox), "helper level only while bonus is on");
ok(/\(\{ counterpartId, photoReportId, \.\.\.item \}\)/.test(inbox), "other person's id is not sent");
const thumbs = read("server/lib/reportThumbnails.js");
ok(/String\(r\.moderation_status \|\| ""\)\.toUpperCase\(\) !== "HELD"/.test(thumbs), "held photos skipped");

const lib = read("src/lib/inbox.ts");
ok(/export function inboxFilter/.test(lib) && /i\.role === "OWNER"/.test(lib) && /i\.role !== "OWNER"/.test(lib), "filter");
const screen = read("app/messages.tsx");
ok(/<SectionList/.test(screen) && /data: showSolved \? solved : \[\]/.test(screen), "solved folded away");
ok(/accessibilityRole="tablist"/.test(screen) && /messages\.filter\.helping/.test(screen), "filter tabs");
ok(/item\.thumbnail_url \?/.test(screen) && /toHelperStatus\(item\.counterpart_helper\)/.test(screen), "photo and helper level");
ok(/messages\.unreadCount/.test(screen) && /s\.cardUnread/.test(screen), "unread clear");
for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["messages.unreadCount", "messages.filter.all", "messages.filter.mine", "messages.filter.helping", "messages.section.active", "messages.section.solved"]) ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
console.log(`T1.9BL OK (${n} checks)`);
