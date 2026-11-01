"use strict";
// T1.9S: page shown after the e-mail confirmation link (Supabase Site URL points here).
//   GET /auth/confirmed?lang=no|en   (no sign-in; the browser's language decides without ?lang)
// When the link is used or expired, Supabase adds #error=… and the page shows that instead.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { pickLanguage } = require("../lib/pageLanguage");

const router = express.Router();
const pages = {
  no: fs.readFileSync(path.join(__dirname, "..", "legal", "confirmed.no.html"), "utf8"),
  en: fs.readFileSync(path.join(__dirname, "..", "legal", "confirmed.en.html"), "utf8"),
};

router.get("/confirmed", (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.set("Content-Language", lang === "no" ? "nb" : "en");
  return res.send(pages[lang]);
});

module.exports = router;
