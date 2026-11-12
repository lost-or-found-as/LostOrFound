"use strict";
// T1.9AI: photo analysis for registration (guests too, they can report finds).
//   POST /image-analysis   { image: "<base64 JPEG>" }
//   200 { status: "OK" | "UNSURE" | "NO_ITEM", suggestion: { category, item, colors, brand, confidence, alternatives } }
//   429 IMAGE_ANALYSIS_DAILY_LIMIT · 503 IMAGE_ANALYSIS_DISABLED · 502 ANALYSIS_UNAVAILABLE / ANALYSIS_TIMEOUT
// The app treats every error the same way: the suggestion card is hidden and search works as before.
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUserOrGuest } = require("../mw/auth");
const analysis = require("../lib/imageAnalysis");

const DAY_MS = 24 * 60 * 60 * 1000;

async function usedToday(userId) {
  const { count, error } = await supaAdmin
    .from("image_analyses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "FAILED")
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (error) throw error;
  return Number(count || 0);
}

async function record(row) {
  const { error } = await supaAdmin.from("image_analyses").insert(row);
  if (error) console.warn("[image-analysis] could not record", error.message);
}

router.post("/", requireUserOrGuest, async (req, res) => {
  const userId = req.user?.id;
  const isGuest = !!req.isGuest;
  if (!analysis.analysisEnabled()) return res.status(503).json({ error: "IMAGE_ANALYSIS_DISABLED" });
  try {
    analysis.checkImage(req.body?.image);
  } catch (e) {
    return res.status(400).json({ error: e.code || "IMAGE_INVALID" });
  }
  const started = Date.now();
  try {
    const limit = isGuest ? analysis.DAILY_LIMIT.guest : analysis.DAILY_LIMIT.account;
    const used = await usedToday(userId);
    if (used >= limit) return res.status(429).json({ error: "IMAGE_ANALYSIS_DAILY_LIMIT", limit, used });

    const answer = await analysis.askModel(String(req.body.image));
    const suggestion = analysis.validateSuggestion(answer.raw);
    await record({
      user_id: userId,
      is_guest: isGuest,
      status: suggestion.status,
      model: answer.model,
      input_tokens: answer.inputTokens,
      output_tokens: answer.outputTokens,
      duration_ms: Date.now() - started,
      suggestion,
    });
    const { status, ...rest } = suggestion;
    return res.json({ status, suggestion: rest });
  } catch (e) {
    const code = e?.code || "ANALYSIS_UNAVAILABLE";
    console.warn("[image-analysis] failed", { code, providerStatus: e?.providerStatus });
    await record({ user_id: userId, is_guest: isGuest, status: "FAILED", error_code: String(code).slice(0, 60), duration_ms: Date.now() - started });
    return res.status(code === "ANALYSIS_TIMEOUT" ? 504 : 502).json({ error: code });
  }
});

module.exports = router;
