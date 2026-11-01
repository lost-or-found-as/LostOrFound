"use strict";
// Language for public pages: ?lang wins; otherwise the browser's language (Norwegian → no); English by default.
function pickLanguage(query, acceptLanguage) {
  const q = String(query || "").toLowerCase();
  if (q === "no" || q === "nb" || q === "nn") return "no";
  if (q === "en") return "en";
  return /^(nb|nn|no)\b/i.test(String(acceptLanguage || "").trim()) ? "no" : "en";
}

module.exports = { pickLanguage };
