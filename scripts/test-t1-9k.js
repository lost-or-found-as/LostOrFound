"use strict";
// T1.9K behavior test: new one-page registration (behind a switch), found-item custody and
// date precision.
//   node .\scripts\test-t1-9k.js
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

// 1. Server rules.
const c = require(path.join(root, "server", "lib", "reportCustody.js"));
eq(c.normalizeCustody("LOST", "WITH_FINDER", "x"), { custody: null, custody_place: null }, "lost reports have no custody");
eq(c.normalizeCustody("FOUND", "left_at_place", "Kiwi"), { custody: "LEFT_AT_PLACE", custody_place: null }, "place only for handed in");
eq(c.normalizeCustody("FOUND", "HANDED_IN", "  Kiwi Majorstuen "), { custody: "HANDED_IN", custody_place: "Kiwi Majorstuen" }, "handed in keeps the place");
eq(c.normalizeCustody("FOUND", null, null), { custody: null, custody_place: null }, "old screen sends nothing");
assert.throws(() => c.normalizeCustody("FOUND", "HANDED_IN", " "), /CUSTODY_PLACE_REQUIRED/);
n++;
assert.throws(() => c.normalizeCustody("FOUND", "SOLD", null), /INVALID_CUSTODY/);
n++;
eq(c.normalizeCustody("FOUND", "HANDED_IN", "x".repeat(300)).custody_place.length, 200, "place is capped");
eq(c.normalizeOccurredPrecision("YEAR", "2019-01-01T12:00:00Z"), { occurred_precision: "YEAR", occurred_year: 2019, occurred_month: null }, "year only");
eq(c.normalizeOccurredPrecision("month", "2019-07-01T12:00:00Z"), { occurred_precision: "MONTH", occurred_year: 2019, occurred_month: 7 }, "month");
eq(c.normalizeOccurredPrecision("EXACT", "2026-10-30T09:15:00Z"), { occurred_precision: "EXACT", occurred_year: null, occurred_month: null }, "exact");
eq(c.normalizeOccurredPrecision(null, "x"), {}, "no precision sent");
assert.throws(() => c.normalizeOccurredPrecision("WEEK", "2026-10-30T09:15:00Z"), /INVALID_OCCURRED_PRECISION/);
n++;

const match = (status, viewerOwnsFound) => ({
  status,
  lost: { user_id: "owner" },
  found: { user_id: "finder", custody: "HANDED_IN", custody_place: "Kiwi" },
  viewer: viewerOwnsFound ? "finder" : "owner",
});
const view = (m) => c.redactCustodyForViewer(m, m.viewer).found;
eq(view(match("NEW", false)), { user_id: "finder", custody: "HANDED_IN", custody_place: null }, "owner does not see the place before confirming");
eq(view(match("CONFIRMED", false)).custody_place, "Kiwi", "owner sees the place after confirming");
eq(view(match("NEW", true)).custody_place, "Kiwi", "finder always sees their own place");

// 2. Migration and wiring.
const mig = read("supabase/migrations/20261031130000_t1_9k_found_custody.sql");
ok(/add column if not exists custody text/.test(mig) && /add column if not exists custody_place text/.test(mig), "columns added once");
ok(/type = 'FOUND' and custody in \('WITH_FINDER', 'LEFT_AT_PLACE', 'HANDED_IN'\)/.test(mig), "only found reports have custody");
ok(/custody = 'HANDED_IN' and char_length\(custody_place\) between 2 and 200/.test(mig), "place only with handed in");
const reports = read("server/routes/reports.js");
ok(/\.\.\.\(custodyFields\.custody \? custodyFields : \{\}\),\s*\.\.\.precisionFields,/.test(reports), "create stores custody (only when set) and precision");
ok(/normalizeCustody\(existing\.type, body\.custody, body\.custody_place\)/.test(reports), "edit uses the stored type");
const matches = read("server/routes/matches.js");
ok((matches.match(/reward_ore, custody, custody_place,/g) || []).length === 2, "match select returns custody for both sides");
ok(/\.map\(\(m\) => redactCustodyForViewer\(m, userId\)\)/.test(matches) && /match: redactCustodyForViewer\(/.test(matches), "list and detail hide the place before confirmation");

// 3. App rules (real TypeScript).
const form = requireTs(path.join(root, "src/lib/registerForm.ts"), {
  "../contexts/ReportDraftContext": {},
});
eq(form.searchItems("lommeb", "no")[0], { category: "PERSONAL", key: "WALLET", name: "Lommebok", categoryName: "Personlige eiendeler" }, "search by Norwegian start");
ok(form.searchItems("wallet", "no").some((h) => h.key === "WALLET"), "English words find Norwegian items");
ok(form.searchItems("katt", "no")[0].key === "CAT", "pets are found");
eq(form.searchItems("n", "no"), [], "one letter does not search");
ok(!form.searchItems("egendefinert", "no").some((h) => h.key === "CUSTOM"), "the custom pet entry is not a search hit");
eq(form.occurredAtFor(new Date(2019, 6, 15, 10, 0), "MONTH"), "2019-07-01T12:00:00.000Z", "month keeps the 1st");
eq(form.occurredAtFor(new Date(2019, 6, 15, 10, 0), "YEAR"), "2019-01-01T12:00:00.000Z", "year keeps 1 January");

const base = {
  type: "LOST",
  category: "PERSONAL",
  subcategoryKey: "WALLET",
  color: "black",
  colorSecondary: "brown",
  brand: " Fjällräven ",
  description: "Glidelås",
  rewardNOK: "500",
  occurredAtISO: "2026-10-27T13:30:00.000Z",
  occurredPrecision: "EXACT",
  location: { latitude: 59.91, longitude: 10.75, radiusMeters: 500, confirmed: true },
  locationLabel: "Oslo S",
  searchAreas: [],
};
eq(form.missingFields(base, true), [], "complete lost report");
eq(
  form.missingFields({ ...base, subcategoryKey: "", color: "", location: { ...base.location, confirmed: false } }, true),
  ["register.missing.item", "register.missing.color", "register.missing.place"],
  "missing fields in screen order",
);
eq(form.missingFields({ ...base, category: "PETS", subcategoryKey: "CUSTOM", subcategoryCustom: "" }, true), ["register.missing.pet"], "custom pet needs a name");
eq(form.missingFields({ ...base, type: "FOUND", custody: "HANDED_IN", custodyPlace: "" }, true), ["register.missing.handedIn"], "handed in needs a place");

const lostBody = form.reportBody(base, { language: "no", rewardEnabled: true, clientRequestId: "report-123456789" });
ok(lostBody.reward_ore === 50000 && lostBody.secondary_color === "brown" && lostBody.brand === "Fjällräven", "lost body");
ok(!("custody" in lostBody) && lostBody.occurred_precision === "EXACT", "lost reports send no custody");
eq(lostBody.title, "Mistet • Personlige eiendeler • Lommebok • Fjällräven • Svart • Brun", "title like the current screen");
const foundBody = form.reportBody({ ...base, type: "FOUND" }, { language: "no", rewardEnabled: true, clientRequestId: "report-123456789" });
ok(foundBody.custody === "WITH_FINDER" && !("reward_ore" in foundBody) && foundBody.radius_m === 10, "found defaults to with the finder, no reward");
const handed = form.reportBody({ ...base, type: "FOUND", custody: "HANDED_IN", custodyPlace: " Kiwi " }, { language: "no", rewardEnabled: false, clientRequestId: "report-123456789" });
eq([handed.custody, handed.custody_place], ["HANDED_IN", "Kiwi"], "handed in sends the place");

eq(["01000", "0", "1 000 kr", "", "007"].map(form.cleanRewardInput), ["1000", "", "1000", "", "7"], "reward field keeps only the number");

const sw = requireTs(path.join(root, "src/ui/colorSwatches.ts"));
eq(sw.nextColors("", "", "red"), { color: "red", colorSecondary: "" }, "first tap is the main colour");
eq(sw.nextColors("red", "", "yellow"), { color: "red", colorSecondary: "yellow" }, "second tap is the secondary colour");
eq(sw.nextColors("red", "yellow", "red"), { color: "yellow", colorSecondary: "" }, "removing the main colour moves the secondary up");
eq(sw.nextColors("red", "yellow", "blue"), { color: "red", colorSecondary: "blue" }, "a third colour replaces the secondary");
const catalog = read("src/i18n/catalog.ts");
const colorBlock = catalog.slice(catalog.indexOf("export const COLOR_CATALOG"), catalog.indexOf("];", catalog.indexOf("export const COLOR_CATALOG")));
const colorKeys = [...colorBlock.matchAll(/key: "([a-z-]+)"/g)].map((m) => m[1]);
ok(colorKeys.every((k) => sw.COLOR_SWATCHES[k]), "every catalog colour has a swatch");

const { custodyText } = requireTs(path.join(root, "src/lib/custodyDisplay.ts"));
const { translate } = requireTs(path.join(root, "src/i18n/translate.ts"));
const tNo = (k, p) => translate("no", k, p);
eq(custodyText("HANDED_IN", null, tNo, { placeHidden: true }), "Levert inn (stedet vises når du bekrefter treffet)", "owner before confirming");
eq(custodyText("HANDED_IN", "Kiwi", tNo), "Levert inn: Kiwi", "with place");
eq(custodyText(null, null, tNo), null, "no custody shows nothing");

const flag = requireTs(path.join(root, "src/lib/newRegistration.ts"), {
  "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {} } },
  react: { useEffect: () => {}, useState: (v) => [v, () => {}] },
});
eq(flag.registerRoute(true, "FOUND"), { pathname: "/(report)/register", params: { type: "FOUND" } }, "switch on: new screen");
eq(flag.registerRoute(false, "LOST").pathname, "/(report)/create-report", "switch off: current screen");

// 4. Screens.
const register = read("app/(report)/register.tsx");
ok(/reportBody\(draft,/.test(register) && /pathname: "\/\(report\)\/map"/.test(register), "new screen sends the shared body and uses the current map");
ok(/returnTo: "\/\(report\)\/register"/.test(register), "login returns to the new screen");
ok(!/Alert\.alert/.test(register), "no system dialogs");
ok(/<RegisterChoice \/>/.test(read("app/start.tsx")) && /registerRoute\(newRegistration, "LOST"\)/.test(read("app/(tabs)/index.tsx")), "both entry points follow the switch");
ok(/<Switch/.test(read("app/(tabs)/profile.tsx")), "switch in Profile");
ok(/custodyText\(match\.found\?\.custody, match\.found\?\.custody_place, t, \{ placeHidden: youOwnLost && !confirmed \}\)/.test(read("app/matches/[matchId].tsx")), "owner sees custody in the match");
ok(fs.existsSync(path.join(root, "app/(report)/create-report.tsx")), "current registration is kept");

console.log(`OK: T1.9K checks passed (${n} assertions).`);
