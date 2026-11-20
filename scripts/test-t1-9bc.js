// scripts/test-t1-9bc.js
// T1.9BC: editing uses the one-page form; the old form (create-report.tsx) is gone.
//   node .\scripts\test-t1-9bc.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// 1. The old form is gone and nothing opens it.
ok(!fs.existsSync(path.join(root, "app/(report)/create-report.tsx")), "old form removed");
for (const f of ["app/my-reports.tsx", "app/report-details/[id].tsx", "app/(auth)/login.tsx"]) ok(!/create-report/.test(read(f)), `${f}: no link to the old form`);
ok(/pathname: "\/\(report\)\/register", params: \{ editReportId: r\.id \}/.test(read("app/my-reports.tsx")), "My cases edits in the new form");
ok(/pathname: "\/\(report\)\/register", params: \{ editReportId: r\.id \}/.test(read("app/report-details/[id].tsx")), "the case edits in the new form");

// 2. Loading a case into the form, and the body that is saved.
const form = requireTs(path.join(root, "src/lib/registerForm.ts"), { "../contexts/ReportDraftContext": {} });
const stored = {
  type: "FOUND", category: "CLOTHING_ACCESSORIES", subcategory_key: "FLEECE_JACKET", description: "Grønn fleece",
  color: "green", secondary_color: "black", brand: "Bergans", item_size: "M", reward_ore: 0,
  occurred_at: "2026-11-19T10:00:00.000Z", occurred_precision: "EXACT", custody: "HANDED_IN", custody_place: "Politiet",
  lat: 59.9, lng: 10.7, radius_m: 10, location_label: "Storo", search_areas: [],
};
const d = form.draftFromReport(stored, null);
eq([d.type, d.subcategoryKey, d.colorSecondary, d.brand, d.itemSize, d.custody, d.custodyPlace, d.locationLabel], ["FOUND", "FLEECE_JACKET", "black", "Bergans", "M", "HANDED_IN", "Politiet", "Storo"], "stored case loaded into the form");
eq(d.location, { latitude: 59.9, longitude: 10.7, radiusMeters: 10, confirmed: true }, "place loaded and confirmed");
eq(form.draftFromReport({ type: "LOST", reward_ore: 50000 }).rewardNOK, "500", "reward in kroner");
eq(form.draftFromReport({ type: "LOST" }, { kind: "SERIAL_NUMBER", value: "ABC123" }).identifierValue, "ABC123", "own identifier loaded");

const draft = { ...d, brand: "", itemSize: "", colorSecondary: "", description: "" };
const body = form.editBody(draft, { language: "no", rewardEnabled: true });
ok(!("type" in body) && !("client_request_id" in body), "type and request id are not sent");
eq([body.brand, body.item_size, body.secondary_color, body.description], [null, null, null, null], "emptied fields are cleared");
eq([body.custody, body.custody_place], ["HANDED_IN", "Politiet"], "where it is now is saved");
eq(body.identifier, null, "no identifier: the stored one is removed");
const pet = form.editBody({ ...form.draftFromReport({ type: "LOST", category: "PETS", subcategory_key: "CAT", lat: 1, lng: 2 }), petName: "" }, { language: "no", rewardEnabled: true });
eq([pet.pet_name, pet.pet_breed, pet.pet_temperament, pet.item_size], [null, null, null, undefined], "animal: pet fields cleared, no size");

// 3. The form in edit mode.
const reg = read("app/(report)/register.tsx");
ok(/fetch\(`\$\{API_BASE_URL\}\/reports\/\$\{encodeURIComponent\(editId\)\}`, \{\s*method: "PATCH"/.test(reg), "saves with PATCH");
ok(/body: JSON\.stringify\(editBody\(draft, \{ language, rewardEnabled \}\)\)/.test(reg), "sends the edit body");
ok(/if \(draftLoading \|\| isEdit\) return;/.test(reg), "the type and date are not reset when editing");
ok(/editPointRef\.current === `\$\{lat\},\$\{lng\}`/.test(reg), "stored place name kept until the point moves");
ok(/if \(!editSavedRef\.current\) void reset\(\);/.test(reg), "leaving without saving clears the draft");
ok(/storedImages\.map\(\(img\) =>/.test(reg) && /const maxNewImages = Math\.max\(0, MAX_IMAGES - storedImages\.length\);/.test(reg), "stored photos shown, new ones fill up to three");
ok(/const offset = isEdit \? storedImages\.length : 0;/.test(reg), "new photos come after the stored ones");
ok(/register\.edit\.noticeTitle/.test(reg) && /report\.create\.save\.changes/.test(reg), "edit notice and «Lagre endringer»");
ok(/!isEdit && <InlineNotice tone="info" icon="time-outline"/.test(reg), "no free-period note when editing");
ok(/params: \{ id: reportId, updated: "1" \}/.test(reg) && /report\.create\.case\.updated/.test(read("app/report-details/[id].tsx")), "case opens with a confirmation");
const ue = read("src/lib/userError.ts");
ok(/CRITICAL_EDIT_COOLDOWN:/.test(ue) && /CRITICAL_EDIT_LIMIT_REACHED:/.test(ue), "limits on big changes explained");
const no = read("src/i18n/locales/no.ts");
ok(/De første 15 minuttene kan du endre fritt/.test(no) && /høyst tre ganger/.test(no), "notice matches the server rules");

console.log(`T1.9BC OK (${n} checks)`);
