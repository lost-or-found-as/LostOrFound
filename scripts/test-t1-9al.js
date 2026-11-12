// scripts/test-t1-9al.js
// T1.9AL: rest of the pet flow – "Sist sett" (where it went missing and where people have seen it),
// the area alert as the first suggestion on a lost animal, and editing the pet fields.
//   node .\scripts\test-t1-9al.js
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

// 1. Server: sightings built from the report and the observations.
const { buildSightings, SIGHTING_LIMIT } = require(path.join(root, "server/lib/petSightings.js"));
const report = { id: "r1", type: "LOST", occurred_at: "2026-11-11T17:30:00Z", lat: 59.95, lng: 10.76, location_label: "Tåsenveien 12, 0853 Oslo" };
const observations = [
  { id: "o1", observation_type: "SEEN", status: "RELEVANT", observed_at: "2026-11-11T20:15:00Z", comment: "Ved bussholdeplassen", movement_direction: null },
  { id: "o2", observation_type: "SEEN", status: "NEW", observed_at: "2026-11-12T06:40:00Z", comment: "  Løp mot skogen  ", movement_direction: "nord" },
  { id: "o3", observation_type: "SEEN", status: "DISMISSED", observed_at: "2026-11-12T07:00:00Z", comment: "Feil hund" },
  { id: "o4", observation_type: "FOUND", status: "NEW", observed_at: "2026-11-12T08:00:00Z" },
];
const points = [
  { id: "o1", latitude: 59.96, longitude: 10.75 },
  { id: "o2", latitude: 59.98, longitude: 10.73 },
  { id: "o3", latitude: 59.99, longitude: 10.72 },
];
const built = buildSightings({ report, observations, points });
eq(built.sightings.map((s) => s.id), ["o2", "o1"], "newest first, dismissed and pointless left out");
eq(built.sightings[0], { id: "o2", kind: "SEEN", at: "2026-11-12T06:40:00Z", comment: "Løp mot skogen", direction: "nord", latitude: 59.98, longitude: 10.73, isNew: true }, "sighting fields");
eq(built.start, { at: "2026-11-11T17:30:00Z", latitude: 59.95, longitude: 10.76, label: "Tåsenveien 12, 0853 Oslo" }, "start point");
eq(buildSightings({ report: { ...report, lat: null }, observations: [], points: [] }).start, null, "no start without a point");
const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, status: "NEW", observed_at: new Date(Date.UTC(2026, 10, 1, i)).toISOString() }));
eq(buildSightings({ report, observations: many, points: many.map((o) => ({ id: o.id, latitude: 60, longitude: 10 })) }).sightings.length, SIGHTING_LIMIT, "at most 20 sightings");

const activityRoute = read("server/routes/reportsActivity.js");
ok(/router\.get\("\/:id\/sightings", requireUser/.test(activityRoute), "sightings route needs a user");
ok(/\.eq\("user_id", userId\)[\s\S]{0,80}\.is\("deleted_at", null\)[\s\S]{0,200}REPORT_NOT_FOUND/.test(activityRoute.slice(activityRoute.indexOf("/:id/sightings"))), "owner only");
ok(/rpc\("observation_point"/.test(activityRoute), "points come from observation_point");

// 2. Server: pet fields can be edited and follow the category.
const reports = read("server/routes/reports.js");
const patchRoute = reports.slice(reports.indexOf('router.patch("/:id"'));
ok(/\["category", "subcategory_key", "pet_name", "pet_breed", "pet_temperament"\]\.some/.test(patchRoute), "pet rule runs when category or pet fields change");
ok(/normalizePet\(merged\.category, merged\.subcategory_key, merged\)/.test(patchRoute), "pet fields normalized against the final category");
ok(/!== "LOST"\) patch\.pet_temperament = null/.test(patchRoute), "temperament only on lost cases");
const { normalizePet } = require(path.join(root, "server/lib/reportPet.js"));
eq(normalizePet("PERSONAL", "WALLET", { pet_name: "Luna" }), { pet_name: null, pet_breed: null, pet_temperament: null }, "changed away from an animal clears pet fields");

// 3. App: next step for a lost animal without an area alert.
const activity = requireTs(path.join(root, "src/lib/reportActivity.ts"), {
  "./supabase": { supabase: {} },
  "./config": { API_BASE_URL: "" },
});
const now = Date.parse("2026-11-12T08:00:00Z");
const lostCase = { type: "LOST", status: "ACTIVE", created_at: "2026-11-11T18:00:00Z", visible_until: "2026-12-11T18:00:00Z" };
const summary = { ...activity.EMPTY_ACTIVITY.summary };
const pet = activity.nextStep(lostCase, summary, now, { petAreaAlert: true });
eq([pet.kind, pet.action, pet.actionKey, pet.tone], ["petAreaAlert", "areaAlert", "caseDetail.next.petAlertAction", "dark"], "area alert first");
eq(activity.stepEyebrowKey(pet), "caseDetail.next.eyebrowSuggestion", "labelled as a suggestion");
eq(activity.nextStep(lostCase, summary, now).kind, "searching", "not without the option");
eq(activity.nextStep(lostCase, { ...summary, possibleMatches: 2 }, now, { petAreaAlert: true }).kind, "matches", "matches still come first");
eq(activity.nextStep({ ...lostCase, closed_at: "2026-11-12T07:00:00Z", status: "CLOSED" }, summary, now, { petAreaAlert: true }).kind, "closed", "closed case");
eq(activity.nextStep({ ...lostCase, visible_until: "2026-11-12T07:00:00Z" }, summary, now, { petAreaAlert: true }).kind === "petAreaAlert", false, "not on an expired case");

// 4. App: sightings helpers.
const sightingsLib = requireTs(path.join(root, "src/lib/petSightings.ts"), {
  "./supabase": { supabase: {} },
  "./config": { API_BASE_URL: "" },
});
const path3 = sightingsLib.sightingPath(built);
eq(path3, [{ latitude: 59.95, longitude: 10.76 }, { latitude: 59.96, longitude: 10.75 }, { latitude: 59.98, longitude: 10.73 }], "route from the start, oldest first");
const region = sightingsLib.sightingRegion(path3);
ok(region.latitude > 59.95 && region.latitude < 59.98 && region.latitudeDelta >= 0.01, "region covers every point");
eq(sightingsLib.sightingRegion([]), null, "no points, no region");
eq(sightingsLib.shortPlace("Sognsvannsveien 20, 0863 Oslo"), "Sognsvannsveien 20", "short place");

// 5. Screens.
const detail = read("app/report-details/[id].tsx");
ok(/petAreaAlert: animal && showAreaAlert && geoView\.kind === "none"/.test(detail), "case screen asks for the pet step only without an area alert");
ok(/step\.action === "areaAlert"\) openAreaAlert\(\)/.test(detail), "the step opens the area alert");
ok(/step\.kind !== "petAreaAlert"/.test(detail), "no second area-alert card under the step");
ok(/\{lost && animal && \(\s*<PetSightingsCard/.test(detail), "Sist sett on lost animal cases");
const card = read("src/ui/PetSightingsCard.tsx");
ok(/onOpenObservation\(x\.id\)/.test(card) && /Polyline/.test(card), "card opens observations and draws the route");
ok(/PLACE_LOOKUPS = 6/.test(card), "place names for the newest sightings only");
const edit = read("app/(report)/create-report.tsx");
ok(/setField\("petName" as any, report\.pet_name \?\? ""\)/.test(edit) && /setField\("petTemperament" as any, report\.pet_temperament \?\? ""\)/.test(edit), "edit loads pet fields");
ok(/pet_name: petName\.trim\(\)\.slice\(0, 40\) \|\| null/.test(edit) && /pet_temperament: type === "LOST" && petTemperament \? petTemperament : null/.test(edit), "edit sends pet fields");
ok(/\{animal && \(/.test(edit) && /register\.pet\.temperamentTitle/.test(edit), "edit shows pet fields for animals");

// 6. Texts in both languages.
const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
const keys = [...new Set([...(card + detail + read("src/lib/reportActivity.ts")).matchAll(/"(caseDetail\.(?:sightings|next\.petAlert)[A-Za-z.]*)"/g)].map((m) => m[1]))];
ok(keys.length >= 10, `texts found (${keys.length})`);
for (const k of keys) ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);

console.log(`OK: T1.9AL pet sightings, area-alert suggestion and pet editing passed (${n} assertions).`);
