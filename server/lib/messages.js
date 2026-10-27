"use strict";
// T1.8E.5J: user-facing backend texts (push and in-app notification copy) live in
// server/locales/no.json and server/locales/en.json, never inline in route code.
const no = require("../locales/no.json");
const en = require("../locales/en.json");

const catalogs = { no, en };

function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    params[key] == null ? "" : String(params[key]),
  );
}

/** Text for one language. Unknown languages use Norwegian. Missing keys throw. */
function message(language, key, params) {
  const lang = language === "en" ? "en" : "no";
  const template = catalogs[lang][key] ?? catalogs.no[key];
  if (template == null) throw new Error(`MESSAGE_KEY_MISSING: ${key}`);
  return interpolate(template, params);
}

/** Both languages, in the { no, en } shape that notifyUser() accepts. */
function localizedPair(key, params) {
  return { no: message("no", key, params), en: message("en", key, params) };
}

module.exports = { message, localizedPair, catalogs };
