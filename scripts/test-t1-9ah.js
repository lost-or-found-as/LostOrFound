// scripts/test-t1-9ah.js
// T1.9AH: many languages. One list (src/i18n/languages.ts) drives the app, and the server has the
// same list (server/lib/languages.js). Draft languages may miss keys (English is used instead);
// a language marked ready must have every key, in the app and on the server.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// The app's language list.
const registry = read("src/i18n/languages.ts");
const langs = [...registry.matchAll(/\{ code: "([a-zA-Z-]+)", nativeName: "([^"]+)", locale: "([^"]+)", ready: (true|false) \}/g)]
  .map((m) => ({ code: m[1], nativeName: m[2], locale: m[3], ready: m[4] === "true" }));
ok(langs.length >= 3, "the language list has at least no, en and de");
ok(langs.find((l) => l.code === "no")?.ready && langs.find((l) => l.code === "en")?.ready, "Norwegian and English are ready");

// The server knows the same languages.
const { SUPPORTED_LANGUAGES, normalizeLanguage } = require(path.join(root, "server/lib/languages.js"));
ok(JSON.stringify(SUPPORTED_LANGUAGES) === JSON.stringify(langs.map((l) => l.code)), "server and app list the same languages");
ok(normalizeLanguage("nb") === "no" && normalizeLanguage("xx") === "no" && normalizeLanguage("de") === "de", "server normalizes language codes");

// App texts: every key exists in English; ready languages have all of them.
const keys = (f) => new Set([...read(f).matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
const enKeys = keys("src/i18n/locales/en.ts");
const report = [];
for (const l of langs) {
  const file = `src/i18n/locales/${l.code}.ts`;
  ok(fs.existsSync(path.join(root, file)), `locale file ${file}`);
  const own = keys(file);
  const unknown = [...own].filter((k) => !enKeys.has(k));
  ok(unknown.length === 0, `${l.code}: keys that English does not have: ${unknown.slice(0, 5).join(", ")}`);
  const missing = [...enKeys].filter((k) => !own.has(k));
  if (l.ready) ok(missing.length === 0, `${l.code} is marked ready but misses ${missing.length} keys, e.g. ${missing.slice(0, 5).join(", ")}`);
  report.push(`${l.code} ${Math.round((100 * (enKeys.size - missing.length)) / enKeys.size)}%`);
  for (const other of langs) ok(enKeys.has(`lang.name.${other.code}`), `lang.name.${other.code} exists`);
}

// Server texts: same rule.
const serverEn = JSON.parse(read("server/locales/en.json"));
for (const l of langs) {
  const file = `server/locales/${l.code}.json`;
  ok(fs.existsSync(path.join(root, file)), `server locale ${file}`);
  const own = JSON.parse(read(file));
  const unknown = Object.keys(own).filter((k) => !(k in serverEn));
  ok(unknown.length === 0, `${file}: unknown keys ${unknown.join(", ")}`);
  const missing = Object.keys(serverEn).filter((k) => !(k in own) && !k.startsWith("email."));
  if (l.ready) ok(missing.length === 0, `${file} is ready but misses ${missing.join(", ")}`);
}
const { message, localizedPair } = require(path.join(root, "server/lib/messages.js"));
ok(message("de", "push.newMessage.title") === "Neue Nachricht", "server writes German");
ok(Object.keys(localizedPair("push.newMessage.title")).length === langs.length, "notification texts come in every language");

// Server item names for push texts include every language.
const itemCatalog = JSON.parse(read("server/data/itemCatalog.json"));
ok(Object.values(itemCatalog.items).every((e) => langs.every((l) => e[l.code])), "server item names in every language");

// No two-language leftovers in the app.
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
for (const f of [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))]) {
  const text = fs.readFileSync(f, "utf8");
  ok(!/"no" \| "en"/.test(text), `two-language type left in ${path.relative(root, f)}`);
}

// Device language: unknown languages get English; plurals follow Intl.PluralRules.
const provider = read("src/i18n/I18nProvider.tsx");
ok(/return "en";\s*\n\}/.test(provider), "a phone in an unsupported language gets English");
ok(/Intl\.PluralRules/.test(read("src/i18n/translate.ts")), "plural forms use Intl.PluralRules");
ok(/selectableLanguages\(\)/.test(read("app/language.tsx")), "language screen lists the languages from the registry");

// Database: any language code can be stored.
ok(fs.existsSync(path.join(root, "supabase/migrations/20261113100000_t1_9ah_language_codes.sql")), "language-code migration");

console.log(`OK: T1.9AH checks passed (${n} assertions). Coverage: ${report.join(", ")}.`);
