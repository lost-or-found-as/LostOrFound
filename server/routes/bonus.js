"use strict";
// T1.9AS: the user's own bonus. Awarding happens in the routes where the help takes place.
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { bonusSummary } = require("../lib/helperBonus");

// GET /bonus/me   balance, pending, helper level and history (own rows only)
router.get("/me", requireUser, async (req, res) => {
  try {
    return res.json({ ok: true, bonus: await bonusSummary({ supa: supaAdmin, userId: req.user.id }) });
  } catch (e) {
    console.error("[bonus] summary failed", e?.message ?? e);
    return res.status(500).json({ error: "BONUS_SUMMARY_FAILED" });
  }
});

module.exports = router;
