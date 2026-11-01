"use strict";
// T1.9R: public privacy policy and terms of use (no sign-in), Norwegian and English.
//   GET /legal/privacy?lang=no|en   GET /legal/terms?lang=no|en
// Without ?lang the browser's language decides; English is the default (App Store and Google Play).
// The pages are generated from the same text as the Word documents in "LOF dokuments".
const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const DOCS = new Set(["privacy", "terms"]);
const pages = new Map();
for (const doc of DOCS)
  for (const lang of ["no", "en"]) pages.set(`${doc}.${lang}`, fs.readFileSync(path.join(__dirname, "..", "legal", `${doc}.${lang}.html`), "utf8"));

function pickLanguage(query, acceptLanguage) {
  const q = String(query || "").toLowerCase();
  if (q === "no" || q === "nb" || q === "nn") return "no";
  if (q === "en") return "en";
  return /^(nb|nn|no)\b/i.test(String(acceptLanguage || "").trim()) ? "no" : "en";
}

router.get("/:doc", (req, res) => {
  const doc = String(req.params.doc || "").toLowerCase();
  if (!DOCS.has(doc)) return res.status(404).json({ error: "NOT_FOUND" });
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  res.set("Content-Language", lang === "no" ? "nb" : "en");
  return res.send(pages.get(`${doc}.${lang}`));
});

module.exports = router;
module.exports.pickLanguage = pickLanguage;
