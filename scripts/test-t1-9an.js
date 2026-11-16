// scripts/test-t1-9an.js
// T1.9AN: owner tips in «Sist sett», and late followers – someone who adds or moves an alert area
// while an area alert or «Synlig i nærheten» runs there gets the case in «I nærheten» (no push).
//   node .\scripts\test-t1-9an.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

// 1. Owner tips: cleaning and merging.
const lib = require(path.join(root, "server/lib/petSightings.js"));
const now = Date.parse("2026-11-15T20:00:00Z");
eq(lib.cleanOwnerTip({ latitude: 59.9, longitude: 10.7, seenAt: "2026-11-15T18:00:00Z", note: "  Naboen så henne  " }, now),
  { value: { latitude: 59.9, longitude: 10.7, seen_at: "2026-11-15T18:00:00.000Z", note: "Naboen så henne" } }, "a tip");
eq(lib.cleanOwnerTip({ latitude: 99, longitude: 10, seenAt: "2026-11-15T18:00:00Z" }, now).error, "INVALID_LOCATION", "bad point");
eq(lib.cleanOwnerTip({ latitude: 59, longitude: 10, seenAt: "2026-11-16T18:00:00Z" }, now).error, "INVALID_SEEN_AT", "not in the future");
eq(lib.cleanOwnerTip({ latitude: 59, longitude: 10, seenAt: "2024-01-01T00:00:00Z" }, now).error, "INVALID_SEEN_AT", "not years back");
eq(lib.cleanOwnerTip({ latitude: 59, longitude: 10, seenAt: "2026-11-15T18:00:00Z", note: "x".repeat(400) }, now).value.note.length, 300, "note capped");
const built = lib.buildSightings({
  report: { lat: 59.95, lng: 10.76, occurred_at: "2026-11-14T10:00:00Z" },
  observations: [{ id: "o1", status: "NEW", observed_at: "2026-11-15T09:00:00Z" }],
  points: [{ id: "o1", latitude: 59.96, longitude: 10.75 }],
  ownerTips: [{ id: "t1", seen_at: "2026-11-15T12:00:00Z", latitude: 59.97, longitude: 10.74, note: "Facebook" }],
});
eq(built.sightings.map((s) => [s.id, s.kind, s.source]), [["t1", "TIP", "OWNER"], ["o1", "SEEN", "AREA_ALERT"]], "tips and sightings together, newest first");
eq(built.sightings[0].isNew, false, "a tip is never «Ny»");

// 2. Database.
const sql = read("supabase/migrations/20261113150000_t1_9an_owner_tips_and_late_followers.sql");
ok(/create table if not exists public\.report_owner_sightings/.test(sql) && /on delete cascade/.test(sql), "tips table follows the case");
ok(/enable row level security/.test(sql) && /revoke all on table public\.report_owner_sightings from anon, authenticated/.test(sql), "tips are server only");
ok(/char_length\(note\) <= 300/.test(sql), "note limit in the database too");
ok(/function public\.geo_alert_backfill_user\(p_user_id uuid\)/.test(sql), "backfill function");
ok(/c\.ends_at > now\(\)/.test(sql) && /r\.user_id <> p_user_id/.test(sql), "only running campaigns, never the owner's own");
ok(/geo_alert_eligible_users\(l\.id\)/.test(sql) && /e\.recipient_user_id = p_user_id/.test(sql), "same eligibility as the first send-out");
ok(/on conflict \(notification_key\)[\s\S]*do nothing/.test(sql), "no duplicates");
ok(!/geo_alert_recipients|push/i.test(sql.slice(sql.indexOf("create or replace function"))), "no push for late followers");
ok(/grant execute on function public\.geo_alert_backfill_user\(uuid\) to service_role/.test(sql), "backfill is server only");

// 3. Server.
const activity = read("server/routes/reportsActivity.js");
ok(/router\.post\("\/:id\/sightings", requireUser/.test(activity) && /router\.delete\("\/:id\/sightings\/:tipId", requireUser/.test(activity), "add and delete routes");
ok(/OWNER_TIP_LIMIT_REACHED/.test(activity) && /\.eq\("user_id", userId\)/.test(activity), "limit and owner only");
ok(/from\("report_owner_sightings"\)[\s\S]{0,200}\.eq\("report_id", reportId\)/.test(activity), "GET includes tips");
const areas = read("server/routes/alertAreas.js");
eq((areas.match(/void backfillNearby\(req\.user\.id,/g) || []).length, 4, "backfill after create, change, turn-on and current location");
ok(/if \(data\.active\) void backfillNearby/.test(areas), "turning an area off does not backfill");

// 4. App.
const appLib = requireTs(path.join(root, "src/lib/petSightings.ts"), { "./supabase": { supabase: {} }, "./config": { API_BASE_URL: "" } });
ok(appLib.tipTimeIsValid(new Date(now - 3600000), now) && !appLib.tipTimeIsValid(new Date(now + 3600000), now), "app checks the time");
const card = read("src/ui/PetSightingsCard.tsx");
ok(/tip \? askDeleteTip\(x\) : onOpenObservation\(x\.id\)/.test(card), "tap a tip to delete it, a sighting to open it");
ok(/useFocusEffect/.test(card), "card reloads after adding a tip");
const detail = read("app/report-details/[id].tsx");
ok(/pathname: "\/sighting-add"/.test(detail) && /closed\s*\?\s*undefined/.test(detail), "add tip from an open case");
const screen = read("app/sighting-add.tsx");
ok(/addOwnerTip\(reportId/.test(screen) && /disabled=\{!canSave\}/.test(screen) && /onPress=\{\(e\) => setPoint/.test(screen), "screen: map point, time and save");
ok(/^export default requireAccount\(SightingAddScreen\);$/m.test(screen), "accounts only");

// 5. Texts.
const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
const keys = [...new Set([...(card + screen).matchAll(/"((?:sightingAdd|caseDetail\.sightings)\.[A-Za-z]+)"/g)].map((m) => m[1]))];
ok(keys.length >= 20, `texts found (${keys.length})`);
for (const k of keys) ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);

console.log(`OK: T1.9AN owner tips and late followers passed (${n} assertions).`);
