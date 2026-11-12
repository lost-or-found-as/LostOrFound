"use strict";
// T1.9AH: languages the server can write texts in (push, in-app notifications, item names).
// Keep in step with src/i18n/languages.ts. A language may be a draft: missing texts fall back to
// English, then Norwegian (server/lib/messages.js).
const SUPPORTED_LANGUAGES = ["no", "en", "de"];

const isSupportedLanguage = (value) => SUPPORTED_LANGUAGES.includes(String(value || ""));

/** A supported language code, or the fallback (Norwegian for older rows without a language). */
function normalizeLanguage(value, fallback = "no") {
  const v = String(value || "").trim().toLowerCase();
  if (v === "nb" || v === "nn") return "no";
  return isSupportedLanguage(v) ? v : fallback;
}

module.exports = { SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage };
