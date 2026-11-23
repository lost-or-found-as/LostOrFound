"use strict";
// T1.8E.5J: user-facing backend texts (push and in-app notification copy) live in
// server/locales/<language>.json, never inline in route code.
// T1.9AH: one file per language in server/lib/languages.js; a draft language falls back to
// English, then Norwegian, key by key.
const { SUPPORTED_LANGUAGES, normalizeLanguage } = require("./languages");

const catalogs = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l, require(`../locales/${l}.json`)]));

function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    params[key] == null ? "" : String(params[key]),
  );
}

/** Text for one language. Unknown languages use Norwegian. Missing keys throw. */
function message(language, key, params) {
  const lang = normalizeLanguage(language);
  const template = catalogs[lang][key] ?? catalogs.en[key] ?? catalogs.no[key];
  if (template == null) throw new Error(`MESSAGE_KEY_MISSING: ${key}`);
  return interpolate(template, params);
}

/** Every language, in the { no, en, de, … } shape that notifyUser() accepts. */
// T1.9BT fix: the key and values ride along (not enumerable), so a notification can be written
// again later in whatever language the app asks for.
function localizedPair(key, params) {
  const out = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l, message(l, key, params)]));
  Object.defineProperty(out, "__key", { value: key, enumerable: false });
  Object.defineProperty(out, "__params", { value: params || null, enumerable: false });
  return out;
}

/** The text of a stored notification in this language: from its key when it has one, else as stored. */
function localizedStored(language, key, params, stored) {
  if (!key) return stored;
  try {
    return message(language, key, params || undefined);
  } catch {
    return stored;
  }
}

module.exports = { message, localizedPair, localizedStored, catalogs };
