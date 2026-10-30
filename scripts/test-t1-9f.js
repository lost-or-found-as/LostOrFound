"use strict";
// T1.9F behavior test: secondary colour column, read receipts, push language and texts.
//   node .\scripts\test-t1-9f.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { runTsModules, I18N_MODULES, EXPO_LOCALIZATION_STUB } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n++; };

// 1. One list of colour keys: server validation, database constraint and app catalog.
const { COLOR_KEYS, normalizeSecondaryColor } = require(path.join(root, "server", "lib", "colorKeys.js"));
const migration = read("supabase/migrations/20261030150000_t1_9f_secondary_color_and_chat_reads.sql");
const constraintKeys = [...migration.match(/secondary_color in \(([\s\S]*?)\)/)[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
const catalog = read("src/i18n/catalog.ts");
const colorBlock = catalog.slice(catalog.indexOf("export const COLOR_CATALOG"), catalog.indexOf("];", catalog.indexOf("export const COLOR_CATALOG")));
const catalogKeys = [...colorBlock.matchAll(/key: "([a-z-]+)"/g)].map((m) => m[1]);
ok(JSON.stringify([...COLOR_KEYS].sort()) === JSON.stringify([...catalogKeys].sort()), "server colour keys equal the catalog");
ok(JSON.stringify([...constraintKeys].sort()) === JSON.stringify([...catalogKeys].sort()), "database constraint equals the catalog");
const backfillTargets = new Set([...migration.matchAll(/\('[^']+', '([a-z-]+)'\)/g)].map((m) => m[1]));
ok([...backfillTargets].every((k) => catalogKeys.includes(k)), "backfill only writes known keys");
ok(catalogKeys.every((k) => backfillTargets.has(k)), "backfill knows every colour");
ok(normalizeSecondaryColor("Light-Blue") === "light-blue" && normalizeSecondaryColor("") === null, "server normalizes keys");
assert.throws(() => normalizeSecondaryColor("Gul"), /INVALID_SECONDARY_COLOR/); n++;

// 2. Server wiring.
const reports = read("server/routes/reports.js");
ok(/secondary_color: normalizedSecondaryColor/.test(reports) && /patch\.secondary_color = normalizeSecondaryColor/.test(reports), "reports route stores secondary_color");
ok((read("server/routes/matches.js").match(/color, secondary_color, brand/g) || []).length === 2, "match select returns secondary_color for both sides");
const push = read("server/routes/push.js");
ok(/router\.post\("\/language", requireUser/.test(push) && /\.eq\("user_id", req\.user\.id\)/.test(push), "push language route updates only the caller's phone");
ok(/order\("last_seen_at", \{ ascending: false \}\)/.test(read("server/lib/userNotify.js")), "notifications use the latest phone's language");
const pushNo = JSON.parse(read("server/locales/no.json"));
const pushEn = JSON.parse(read("server/locales/en.json"));
ok(/kjent igjen funnet ditt/.test(pushNo["push.matchConfirmed.title"]) && /recognised your find/.test(pushEn["push.matchConfirmed.title"]), "first-contact push text");

// 3. Read receipts are protected by row level security.
ok(/enable row level security/.test(migration) && /revoke all on table public\.conversation_reads from anon/.test(migration), "conversation_reads locked down");
ok(/with check \(user_id = auth\.uid\(\) and public\.is_conversation_participant\(conversation_id\)\)/.test(migration), "users write only their own read row");
ok(/alter publication supabase_realtime add table public\.conversation_reads/.test(migration), "read receipts are live");

// 4. App wiring.
const create = read("app/(report)/create-report.tsx");
ok(/secondary_color: secondary/.test(create) && !/report\.create\.secondary\.color"\)\}: /.test(create), "app sends secondary_color instead of a description line");
ok(/usePushLanguageSync\(language, user\?\.id, isGuest\)/.test(read("app/_layout.tsx")), "app keeps push language in sync");
const chat = read("app/chat/[matchId].tsx");
ok(/from\("conversation_reads"\)/.test(chat) && /setLastSeen\(matchId\)/.test(chat), "chat records reads");

// 5. Description helpers (real TypeScript).
const runner = `
import assert from "node:assert";
import { colorKeyFromName, reportDescriptionText, reportSecondaryColor } from "@/src/lib/reportDescription";
let n = 0;
const eq = (a, b, l) => { assert.deepStrictEqual(a, b, l + ": got " + JSON.stringify(a)); n++; };
eq(colorKeyFromName("Gul"), "yellow", "Norwegian name");
eq(colorKeyFromName("Yellow"), "yellow", "English name");
eq(colorKeyFromName("Mørkeblå (Navy)"), "navy", "old picker label");
eq(colorKeyFromName("Camo / Kamuflasje"), "camo", "old picker label with slash");
eq(colorKeyFromName("light-blue"), "light-blue", "key");
eq(colorKeyFromName("Plaid"), null, "unknown name");
eq(reportDescriptionText("Ring med gravering\\nTilleggsfarge: Gul"), "Ring med gravering", "line removed");
eq(reportDescriptionText("Secondary color: Yellow"), "", "only line");
eq(reportDescriptionText("Ingen farge"), "Ingen farge", "untouched");
eq(reportSecondaryColor({ description: "x\\nSecondary color: Light blue" }), "light-blue", "parsed from old line");
eq(reportSecondaryColor({ secondary_color: "gold", description: "Tilleggsfarge: Sølv" }), "gold", "column wins");
eq(reportSecondaryColor({ description: "nothing" }), null, "none");
console.log("OK: T1.9F description helpers (" + n + " assertions).");
`;
const passed = runTsModules({
  files: ["src/lib/reportDescription.ts", ...I18N_MODULES],
  stubs: { "expo-localization": EXPO_LOCALIZATION_STUB },
  runner,
  prefix: "lof-t19f-",
});
if (!passed) process.exit(1);
console.log(`OK: T1.9F checks passed (${n} assertions).`);
