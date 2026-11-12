// scripts/test-t1-9aj.js
// T1.9AJ: pets. Animals get a name, breed and temperament; finders get pet advice and pet
// wording for "where is it now"; the chip number stays a private identifier.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// Server.
const { normalizePet, isAnimal } = require(path.join(root, "server/lib/reportPet.js"));
ok(isAnimal("PETS", "DOG") && isAnimal("pets", "CUSTOM") && !isAnimal("PETS", "PET_GEAR") && !isAnimal("PERSONAL", "DOG"), "animals only");
eq(normalizePet("PETS", "DOG", { pet_name: "  Luna ", pet_breed: "Border  collie", pet_temperament: "shy" }), { pet_name: "Luna", pet_breed: "Border collie", pet_temperament: "SHY" }, "cleaned");
eq(normalizePet("PETS", "PET_GEAR", { pet_name: "Luna" }), { pet_name: null, pet_breed: null, pet_temperament: null }, "a leash has no pet fields");
ok(normalizePet("PETS", "CAT", { pet_name: "x".repeat(80) }).pet_name.length === 40, "name capped at 40");
assert.throws(() => normalizePet("PETS", "DOG", { pet_temperament: "ANGRY" }), /INVALID_PET_TEMPERAMENT/); n++;
const route = read("server/routes/reports.js");
ok(/petFields = normalizePet\(category, canonicalItemKey\(subcategory_key\)/.test(route), "create uses normalizePet");
ok(/patch\.pet_temperament = temperament/.test(route) && /INVALID_PET_TEMPERAMENT/.test(route), "edit validates temperament");

// Database.
const mig = read("supabase/migrations/20261113120000_t1_9aj_pets.sql");
ok(/add column if not exists pet_name/.test(mig) && /reports_pet_temperament_check/.test(mig) && /'SHY', 'CALM'/.test(mig), "pet columns with checks");
ok(!/chip/i.test(mig.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "no chip number column (stays private)");

// App form.
const form = requireTs(path.join(root, "src/lib/registerForm.ts"), { "../contexts/ReportDraftContext": {} });
ok(form.isAnimal("PETS", "DOG") && !form.isAnimal("PETS", "PET_GEAR"), "app knows animals");
eq(form.itemHintKey("DOG", "FOUND", "PETS"), "register.hint.petFound", "finder gets pet advice");
eq(form.itemHintKey("CAT", "LOST", "PETS"), "register.hint.petLost", "owner gets pet advice");
eq(form.itemHintKey("BICYCLE", "LOST", "VEHICLE_TRANSPORT"), "register.hint.bicycleLost", "other hints unchanged");
eq(form.identifierKindsFor("HORSE"), ["CHIP_NUMBER", "OTHER"], "horses can have a chip number");
const base = { type: "LOST", category: "PETS", subcategoryKey: "DOG", occurredAtISO: new Date().toISOString(), location: { latitude: 59.9, longitude: 10.7, confirmed: true }, searchAreas: [], petName: " Luna ", petBreed: "Border collie", petTemperament: "SHY" };
let body = form.reportBody(base, { language: "no", rewardEnabled: false, clientRequestId: "abcdefghijklmnop" });
eq([body.pet_name, body.pet_breed, body.pet_temperament], ["Luna", "Border collie", "SHY"], "lost pet sends its fields");
ok(/Luna/.test(body.title), "name in the title");
body = form.reportBody({ ...base, type: "FOUND" }, { language: "no", rewardEnabled: false, clientRequestId: "abcdefghijklmnop" });
ok(body.pet_temperament === undefined && body.pet_name === "Luna", "finder sends name from the collar, no temperament");
body = form.reportBody({ ...base, subcategoryKey: "PET_GEAR" }, { language: "no", rewardEnabled: false, clientRequestId: "abcdefghijklmnop" });
ok(body.pet_name === undefined, "a leash sends no pet fields");

// Wording.
const { custodyText } = requireTs(path.join(root, "src/lib/custodyDisplay.ts"));
const t = (k) => k;
eq(custodyText("LEFT_AT_PLACE", null, t, { animal: true }), "custody.pet.seen", "an animal is seen, not left");
eq(custodyText("LEFT_AT_PLACE", null, t), "custody.leftAtPlace", "items unchanged");
const screen = read("app/(report)/register.tsx");
ok(/register\.custody\.\$\{animal \? "pet\." : ""\}\$\{value\}/.test(screen), "pet wording for where it is now");
ok(/type === "LOST" && \(\s*<View style=\{s\.field\}>\s*<Text style=\{s\.label\}>\{t\("register\.pet\.temperamentTitle"\)\}/.test(screen), "temperament asked of the owner only");
ok(/caseDetail\.pet\.name/.test(read("app/report-details/[id].tsx")), "case details show the pet fields");

console.log(`OK: T1.9AJ checks passed (${n} assertions).`);
