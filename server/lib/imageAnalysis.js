"use strict";
// T1.9AI: photo analysis for registration. The app sends one to three small JPEGs of the same item
// (T1.9AW: all photos together, so a label photo can add brand and size); the server asks a vision
// model (Claude Haiku via the Anthropic API) which item from OUR catalog it shows, its colours
// and a visible brand. The answer is checked against the catalog, so only known keys reach the
// app, and the user always confirms. The photo is not stored by us; image_analyses keeps only
// the outcome (for the daily limit, cost and errors).
//
// Server settings:
//   IMAGE_ANALYSIS_ENABLED=true     the switch; anything else answers IMAGE_ANALYSIS_DISABLED
//   ANTHROPIC_API_KEY               secret, Render only
//   IMAGE_ANALYSIS_MODEL            optional, default claude-haiku-5-5
//   IMAGE_ANALYSIS_UNLIMITED_USER_IDS  optional, comma-separated test accounts without the daily limit (T1.9AV)
const catalog = require("../data/itemCatalog.json");
const { isAnimal } = require("./reportPet");

const DEFAULT_MODEL = "claude-haiku-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 18000;
const MAX_IMAGES = 3; // T1.9AW: the photos of one registration, analysed together
const MAX_IMAGE_BYTES = 700 * 1024; // decoded JPEG; the app sends about 60-150 KB
const MAX_TOTAL_BYTES = 900 * 1024; // T1.9AW: all photos of one request together
const DAILY_LIMIT = Object.freeze({ account: 10, guest: 3 });
const CONFIDENCE = new Set(["high", "medium", "low"]);

function analysisEnabled(env = process.env) {
  return String(env.IMAGE_ANALYSIS_ENABLED || "").toLowerCase() === "true" && !!String(env.ANTHROPIC_API_KEY || "").trim();
}

/** T1.9AV: test accounts listed on the server skip the daily limit (the switch and the key still apply). */
function unlimitedUser(userId, env = process.env) {
  if (!userId) return false;
  return String(env.IMAGE_ANALYSIS_UNLIMITED_USER_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .includes(String(userId));
}

function analysisError(code, extra = {}) {
  return Object.assign(new Error(code), { code }, extra);
}

/** Checks the base64 JPEG from the app and returns its size in bytes. */
function checkImage(base64) {
  const value = String(base64 || "");
  if (!value || !/^[A-Za-z0-9+/]+=*$/.test(value)) throw analysisError("IMAGE_INVALID");
  const bytes = Math.floor((value.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) throw analysisError("IMAGE_TOO_LARGE");
  // JPEG files start with FF D8 FF ("/9j/" in base64).
  if (!value.startsWith("/9j/")) throw analysisError("IMAGE_INVALID");
  return bytes;
}

/**
 * T1.9AW: the photos of one request, from { images: [...] } or the older { image } (builds before
 * T1.9AW). Returns the base64 list; throws IMAGE_INVALID, IMAGE_TOO_LARGE or TOO_MANY_IMAGES.
 */
function requestImages(body) {
  const list = Array.isArray(body?.images) ? body.images : body?.image != null ? [body.image] : [];
  if (!list.length) throw analysisError("IMAGE_INVALID");
  if (list.length > MAX_IMAGES) throw analysisError("TOO_MANY_IMAGES");
  let total = 0;
  for (const image of list) total += checkImage(image);
  if (total > MAX_TOTAL_BYTES) throw analysisError("IMAGE_TOO_LARGE");
  return list.map(String);
}

/** The fixed instructions plus the catalog keys (English names), cached by the API between calls. */
function systemPrompt() {
  const categories = Object.entries(catalog.categories).map(([k, v]) => `${k}: ${v.en}`).join("\n");
  const items = Object.entries(catalog.items)
    .filter(([k]) => k !== "CUSTOM")
    .map(([k, v]) => `${k} (${(catalog.itemCategories[k] || []).join("/")}): ${v.en}`)
    .join("\n");
  const colors = Object.entries(catalog.colors)
    .filter(([k]) => k !== "unknown")
    .map(([k, v]) => `${k}: ${v.en}`)
    .join("\n");
  return [
    "You help people register a lost or found item in a lost-and-found app. You get one to three photos of the same item;",
    "a later photo often shows a detail such as a label, a size tag or a logo.",
    "Answer with ONE JSON object and nothing else, in this shape:",
    '{"category":"<category key>","item":"<item key or null>","colors":["<color key>"],"brand":"<brand or null>","size":"<size or null>","confidence":"high|medium|low","alternatives":["<item key>"]}',
    "Rules:",
    "- Use only keys from the lists below. If no item fits, use null for item and the closest category.",
    "- colors: the main colour first, at most two.",
    "- Item and colours: judge from the photo that shows the whole item best.",
    "- brand: only when a logo, brand name or brand label is clearly visible on the item in any photo; otherwise null.",
    "- size: only when a size is clearly printed on a label or tag of the item (for example M, 38, EU 42, 128 cm, 20 L); copy it short, otherwise null.",
    "- alternatives: up to three other likely item keys when you are not sure; otherwise [].",
    "- confidence: high only when the item is clearly visible and unambiguous.",
    "- Never read out or repeat text from cards, IDs, passports, documents, screens or licence plates. Brand and size labels sewn or printed on clothes, shoes and gear are fine.",
    "- Never copy names, addresses, phone numbers or other personal details written on a label.",
    "- If the photo shows no item (for example only a person, a face or a landscape), use null for item and low confidence.",
    "",
    "Categories:",
    categories,
    "",
    "Items (key (categories): name):",
    items,
    "",
    "Colours:",
    colors,
  ].join("\n");
}

/** Pulls the first JSON object out of the model's text. */
function parseModelJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw analysisError("ANALYSIS_UNREADABLE");
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw analysisError("ANALYSIS_UNREADABLE");
  }
}

const cleanText = (v, max) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t && t.toLowerCase() !== "null" ? t.slice(0, max) : null;
};

/**
 * Only catalog keys survive. Returns { category, item, colors, brand, confidence, alternatives, status }
 * where status is OK (use it), UNSURE (offer the alternatives) or NO_ITEM (search instead).
 */
function validateSuggestion(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const itemKey = typeof r.item === "string" && catalog.items[r.item] && r.item !== "CUSTOM" ? r.item : null;
  const itemCats = itemKey ? catalog.itemCategories[itemKey] || [] : [];
  let category = typeof r.category === "string" && catalog.categories[r.category] ? r.category : null;
  if (itemKey && (!category || !itemCats.includes(category))) category = itemCats[0] || null;
  const colors = [];
  for (const c of Array.isArray(r.colors) ? r.colors : [])
    if (typeof c === "string" && catalog.colors[c] && c !== "unknown" && !colors.includes(c) && colors.length < 2) colors.push(c);
  const alternatives = [];
  for (const a of Array.isArray(r.alternatives) ? r.alternatives : [])
    if (typeof a === "string" && catalog.items[a] && a !== "CUSTOM" && a !== itemKey && !alternatives.includes(a) && alternatives.length < 3)
      alternatives.push(a);
  const confidence = CONFIDENCE.has(r.confidence) ? r.confidence : "low";
  const brand = cleanText(r.brand, 40);
  // T1.9AW: a short size from a label; animals never have one.
  const size = itemKey && isAnimal("PETS", itemKey) ? null : cleanText(r.size, 20);
  let status;
  if (itemKey && confidence !== "low") status = "OK";
  else if (itemKey || alternatives.length) status = "UNSURE";
  else status = "NO_ITEM";
  // An unsure answer offers the guess itself first among the alternatives.
  const offered = status === "UNSURE" && itemKey ? [itemKey, ...alternatives].slice(0, 3) : alternatives;
  return {
    status,
    category,
    item: status === "OK" ? itemKey : null,
    colors,
    brand,
    size,
    confidence,
    alternatives: offered.map((key) => ({ key, category: (catalog.itemCategories[key] || [])[0] || null })),
  };
}

/** Calls the model with one photo or a list of photos. Returns { raw, model, inputTokens, outputTokens }. */
async function askModel(imageBase64, { env = process.env, fetchImpl = fetch } = {}) {
  const images = (Array.isArray(imageBase64) ? imageBase64 : [imageBase64]).slice(0, MAX_IMAGES);
  const many = images.length > 1;
  const model = String(env.IMAGE_ANALYSIS_MODEL || DEFAULT_MODEL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": String(env.ANTHROPIC_API_KEY || ""),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              ...images.flatMap((data, i) => [
                ...(many ? [{ type: "text", text: `Photo ${i + 1}:` }] : []),
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
              ]),
              {
                type: "text",
                text: many
                  ? "These photos show the same item. What item is it? Answer with the JSON object only."
                  : "What item is this? Answer with the JSON object only.",
              },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    throw analysisError(e?.name === "AbortError" ? "ANALYSIS_TIMEOUT" : "ANALYSIS_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) throw analysisError("ANALYSIS_UNAVAILABLE", { providerStatus: response.status });
  const text = (json?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  return {
    raw: parseModelJson(text),
    model,
    inputTokens: Number(json?.usage?.input_tokens || 0) + Number(json?.usage?.cache_read_input_tokens || 0) + Number(json?.usage?.cache_creation_input_tokens || 0),
    outputTokens: Number(json?.usage?.output_tokens || 0),
  };
}

module.exports = {
  DAILY_LIMIT,
  unlimitedUser,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_BYTES,
  requestImages,
  analysisEnabled,
  analysisError,
  checkImage,
  systemPrompt,
  parseModelJson,
  validateSuggestion,
  askModel,
};
