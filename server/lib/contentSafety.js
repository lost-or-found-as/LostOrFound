"use strict";
// T1.9AY: checks before a case reaches strangers (area alert, «Synlig i nærheten», share page).
//   - public text: no phone number or e-mail address (contact goes through the app chat); when the
//     photo analysis is switched on, the model also checks for insults, hate, sexual content and
//     named private persons. A model failure never blocks: the rule checks still apply.
//   - verified account: an area alert or visibility needs a confirmed e-mail (or Apple/Google).
const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-5-5";
const TIMEOUT_MS = 8000;
const MODEL_REASONS = new Set(["NAMED_PERSON", "HARASSMENT", "HATE", "SEXUAL"]);

// Phone: 8 to 12 digits, optionally with a +country code, separated only by spaces or hyphens.
// Dates (19.11.2026) and short numbers are not matched.
const PHONE_RE = /(?<![\d.,/])(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){7,11}\d(?![\d.,/])/;
const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;

/** Rule checks on one text: ["PHONE", "EMAIL"] or []. */
function ruleProblems(text) {
  const t = String(text || "");
  const out = [];
  if (PHONE_RE.test(t)) out.push("PHONE");
  if (EMAIL_RE.test(t)) out.push("EMAIL");
  return out;
}

/** The texts of a case that strangers can read. */
function publicTexts(report) {
  return [report?.description, report?.location_label, report?.pet_name, report?.subcategory_custom]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
}

function modelEnabled(env = process.env) {
  return String(env.IMAGE_ANALYSIS_ENABLED || "").toLowerCase() === "true" && !!String(env.ANTHROPIC_API_KEY || "").trim();
}

function moderationPrompt() {
  return [
    "You check short texts that a lost-and-found app will show to strangers (a lost item or pet notice).",
    "Answer with ONE JSON object and nothing else: {\"ok\":true|false,\"reasons\":[\"NAMED_PERSON\"|\"HARASSMENT\"|\"HATE\"|\"SEXUAL\"]}",
    "- NAMED_PERSON: the text names or points out a private person (full name, or a description meant to expose someone). A pet's name is fine.",
    "- HARASSMENT: insults, threats, accusations or shaming of someone.",
    "- HATE: hateful content about a group.",
    "- SEXUAL: sexual content.",
    "Ordinary descriptions of items, pets, places and times are ok. When in doubt about an ordinary notice, answer ok.",
  ].join("\n");
}

/** Asks the model. Returns reasons (maybe []), or null when it could not answer. */
async function modelProblems(texts, { env = process.env, fetchImpl = fetch } = {}) {
  if (!modelEnabled(env) || !texts.length) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": String(env.ANTHROPIC_API_KEY || ""), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: String(env.IMAGE_ANALYSIS_MODEL || DEFAULT_MODEL),
        max_tokens: 100,
        system: moderationPrompt(),
        messages: [{ role: "user", content: [{ type: "text", text: texts.map((t, i) => `Text ${i + 1}: ${t.slice(0, 1000)}`).join("\n") }] }],
      }),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) return null;
    const text = (json?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed?.ok === true) return [];
    const reasons = (Array.isArray(parsed?.reasons) ? parsed.reasons : []).filter((x) => MODEL_REASONS.has(x));
    return reasons.length ? [...new Set(reasons)] : [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** { ok, reasons } for the public texts of a case. Rule problems always count; the model only adds. */
async function checkPublicText(report, deps = {}) {
  const texts = publicTexts(report);
  const reasons = new Set();
  for (const t of texts) for (const p of ruleProblems(t)) reasons.add(p);
  const model = await modelProblems(texts, deps);
  if (model === null && texts.length && modelEnabled(deps.env)) (deps.log || console).warn?.("[content] text check unavailable");
  for (const p of model || []) reasons.add(p);
  return { ok: reasons.size === 0, reasons: [...reasons] };
}

/** True for a signed-in account with a confirmed e-mail or phone, or an Apple/Google sign-in. */
function isVerifiedUser(user) {
  if (!user || user.is_anonymous === true) return false;
  if (user.email_confirmed_at || user.confirmed_at || user.phone_confirmed_at) return true;
  const providers = [user.app_metadata?.provider, ...(user.app_metadata?.providers || [])].map((p) => String(p || "").toLowerCase());
  return providers.some((p) => p === "apple" || p === "google");
}

module.exports = { PHONE_RE, EMAIL_RE, ruleProblems, publicTexts, modelEnabled, modelProblems, checkPublicText, isVerifiedUser };
