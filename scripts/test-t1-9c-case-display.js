"use strict";
// T1.9C behavior test: how cases are named in "My cases" (src/lib/caseDisplay.ts).
// Runs the real TypeScript helpers (see scripts/lib/ts-modules.js).
//   node .\scripts\test-t1-9c-case-display.js

const { runTsModules, I18N_MODULES, EXPO_LOCALIZATION_STUB } = require("./lib/ts-modules");

const runner = `
import assert from "node:assert";
import { caseTitle, caseAttributes, formatCaseDate } from "@/src/lib/caseDisplay";
const ok = (got, want, label) => assert.strictEqual(got, want, label + ": got " + JSON.stringify(got));
const bag = { color: "multicolor", subcategory_key: "TOILETRY_BAG", category: "PERSONAL" };
ok(caseTitle(bag, "no"), "Toalettmappe", "NO title");
ok(caseAttributes(bag, "no"), "Flerfarget", "NO colour is Norwegian");
ok(caseTitle(bag, "en"), "Toiletry bag", "EN title");
ok(caseAttributes(bag, "en"), "Multicolor", "EN colour");
const ring = { color: "gold", subcategory_key: "RING", category: "JEWELRY", brand: "pandora" };
ok(caseTitle(ring, "no"), "Gullring", "NO compound word");
ok(caseTitle(ring, "en"), "Gold ring", "EN two words");
ok(caseAttributes(ring, "no"), "Pandora", "colour not repeated when in title; brand capitalised");
ok(caseAttributes({ color: "unknown", subcategory_key: "KEYS", category: "PERSONAL" }, "no"), "", "unknown colour hidden");
ok(caseTitle({ subcategory_key: "CUSTOM", subcategory_custom: "bamse", category: "PETS" }, "no"), "Bamse", "custom name capitalised");
ok(caseAttributes({ color: "turquoise", subcategory_key: "SCARF", category: "CLOTHING_ACCESSORIES" }, "no"), "Turkis", "all app colours translated");
// T1.9F: secondary colour shown with the main colour.
ok(caseAttributes({ color: "red", secondary_color: "yellow", category: "PERSONAL", subcategory_key: "TOILETRY_BAG" }, "no"), "Rød og gul", "NO colour pair");
ok(caseAttributes({ color: "red", secondary_color: "yellow", brand: "nike", category: "PERSONAL", subcategory_key: "TOILETRY_BAG" }, "en"), "Red and yellow · Nike", "EN colour pair");
ok(caseAttributes({ color: "red", description: "Tilleggsfarge: Gul", category: "PERSONAL", subcategory_key: "TOILETRY_BAG" }, "no"), "Rød og gul", "old description line");
ok(caseAttributes({ color: "gold", secondary_color: "silver", subcategory_key: "RING", category: "JEWELRY" }, "no"), "Sølv", "secondary only when main is in the title");
ok(caseAttributes({ color: "red", secondary_color: "red", category: "PERSONAL", subcategory_key: "KEYS" }, "no"), "Rød", "same colour twice");
ok(formatCaseDate("2026-10-29T10:00:00Z", "no"), "29. okt. 2026", "NO date");
ok(formatCaseDate("2026-10-29T10:00:00Z", "en"), "29 Oct 2026", "EN date");
console.log("OK: T1.9C case display tests passed (17 assertions).");
`;

const ok = runTsModules({
  files: ["src/lib/caseDisplay.ts", "src/lib/localizedReport.ts", "src/lib/reportDescription.ts", ...I18N_MODULES],
  stubs: { "expo-localization": EXPO_LOCALIZATION_STUB },
  runner,
  prefix: "lof-case-display-",
});
process.exit(ok ? 0 : 1);
