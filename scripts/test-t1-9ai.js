// scripts/test-t1-9ai.js
// T1.9AI: photo analysis in registration. The model may only suggest keys from our catalog, the
// user always confirms, the photo is never stored by us, and there is a daily limit and a switch.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const lib = require(path.join(root, "server/lib/imageAnalysis.js"));

(async () => {
  // Switch: both the flag and the key are needed.
  ok(!lib.analysisEnabled({}), "off by default");
  ok(!lib.analysisEnabled({ IMAGE_ANALYSIS_ENABLED: "true" }), "off without a key");
  ok(lib.analysisEnabled({ IMAGE_ANALYSIS_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-test" }), "on with flag and key");

  // Image checks.
  const jpeg = "/9j/" + "A".repeat(400);
  ok(lib.checkImage(jpeg) > 0, "small JPEG accepted");
  assert.throws(() => lib.checkImage("iVBORw0KGgo" + "A".repeat(100)), /IMAGE_INVALID/); n++;
  assert.throws(() => lib.checkImage("/9j/" + "A".repeat(1_000_000)), /IMAGE_TOO_LARGE/); n++;
  assert.throws(() => lib.checkImage("<script>"), /IMAGE_INVALID/); n++;

  // Only catalog keys survive.
  let v = lib.validateSuggestion({ category: "BAGS_LUGGAGE", item: "BACKPACK", colors: ["black", "gray", "red"], brand: " Fjällräven ", confidence: "high", alternatives: [] });
  eq([v.status, v.item, v.category, v.colors, v.brand], ["OK", "BACKPACK", "BAGS_LUGGAGE", ["black", "gray"], "Fjällräven"], "clear suggestion");
  v = lib.validateSuggestion({ category: "ELECTRONICS", item: "BACKPACK", colors: ["black"], confidence: "high" });
  eq(v.category, "BAGS_LUGGAGE", "category follows the item when they disagree");
  v = lib.validateSuggestion({ category: "NOPE", item: "ROCKET", colors: ["sparkly"], brand: "null", confidence: "high", alternatives: ["WALLET", "NOPE"] });
  eq([v.status, v.item, v.colors, v.brand, v.alternatives.map((a) => a.key)], ["UNSURE", null, [], null, ["WALLET"]], "unknown keys dropped");
  v = lib.validateSuggestion({ category: "BAGS_LUGGAGE", item: "BACKPACK", confidence: "low", alternatives: ["GYM_BAG", "SCHOOL_BAG", "SUITCASE"] });
  eq([v.status, v.alternatives.map((a) => a.key)], ["UNSURE", ["BACKPACK", "GYM_BAG", "SCHOOL_BAG"]], "low confidence offers the guess first");
  v = lib.validateSuggestion({ item: null, confidence: "low", alternatives: [] });
  eq(v.status, "NO_ITEM", "nothing recognised");
  ok(lib.validateSuggestion("garbage").status === "NO_ITEM", "garbage answer is harmless");
  ok(lib.validateSuggestion({ item: "CUSTOM", confidence: "high" }).status === "NO_ITEM", "CUSTOM is never suggested");

  // Parsing.
  eq(lib.parseModelJson('Here: {"item":"BALL"} done'), { item: "BALL" }, "JSON inside text");
  assert.throws(() => lib.parseModelJson("no json"), /ANALYSIS_UNREADABLE/); n++;

  // The request to the model.
  let sent = null;
  const fakeFetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"category":"PERSONAL","item":"WALLET","colors":["brown"],"brand":null,"confidence":"high","alternatives":[]}' }], usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 3000 } }) };
  };
  const answer = await lib.askModel(jpeg, { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: fakeFetch });
  ok(sent.url === "https://api.anthropic.com/v1/messages", "Anthropic Messages API");
  ok(sent.init.headers["x-api-key"] === "sk-ant-test" && sent.init.headers["anthropic-version"], "key and version header");
  ok(sent.body.model === "claude-haiku-5-5", "Claude Haiku 5.5 by default");
  ok(!("temperature" in sent.body) && !("top_p" in sent.body), "no sampling parameters (not supported)");
  ok(sent.body.system[0].cache_control?.type === "ephemeral", "catalog prompt is cached");
  ok(sent.body.messages[0].content[0].source.media_type === "image/jpeg", "JPEG image block");
  ok(answer.inputTokens === 4200 && answer.outputTokens === 40, "token use recorded");
  eq(lib.validateSuggestion(answer.raw).item, "WALLET", "end to end");
  await assert.rejects(lib.askModel(jpeg, { env: { ANTHROPIC_API_KEY: "x" }, fetchImpl: async () => ({ ok: false, status: 529, json: async () => ({}) }) }), /ANALYSIS_UNAVAILABLE/); n++;
  await assert.rejects(lib.askModel(jpeg, { env: { ANTHROPIC_API_KEY: "x" }, fetchImpl: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } }), /ANALYSIS_TIMEOUT/); n++;
  ok(/Never read out or repeat text from cards, IDs, passports/.test(lib.systemPrompt()), "model is told not to read documents");
  ok(/BACKPACK \(BAGS_LUGGAGE\): Backpack/.test(lib.systemPrompt()), "prompt lists catalog keys with categories");

  // Route.
  const route = read("server/routes/imageAnalysis.js");
  ok(/requireUserOrGuest/.test(route), "guests can use it");
  ok(/IMAGE_ANALYSIS_DISABLED/.test(route) && /analysisEnabled\(\)/.test(route), "switch checked first");
  ok(/IMAGE_ANALYSIS_DAILY_LIMIT/.test(route) && /\.neq\("status", "FAILED"\)/.test(route), "daily limit, failures not counted");
  ok(!/image:\s*req\.body/.test(route) && !/storage/.test(route), "photo is not stored");
  ok(/app\.use\("\/image-analysis", imageAnalysisRoutes\)/.test(read("server/index.js")), "route mounted");
  eq(lib.DAILY_LIMIT, { account: 10, guest: 3 }, "10 per day, guests 3");

  // Database.
  const mig = read("supabase/migrations/20261113110000_t1_9ai_image_analyses.sql");
  ok(/enable row level security/.test(mig) && /revoke all on table public\.image_analyses from anon, authenticated/.test(mig), "server-only table");
  ok(!/image_base64|bytea/.test(mig), "no photo column");

  // App.
  const screen = read("app/(report)/register.tsx");
  ok(/if \(first && !draft\.subcategoryKey\) void runPhotoAnalysis\(uri\)/.test(screen), "only the first photo, only before an item is chosen");
  ok(/onPress=\{\(\) => applyPhotoSuggestion\(photoAi\.suggestion!\.item!/.test(screen), "suggestion used only on tap");
  ok(/!draft\.color\)/.test(screen) && /!String\(draft\.brand \|\| ""\)\.trim\(\)/.test(screen), "never overwrites what the user typed");
  ok(/register\.photo\.fromPhoto/.test(screen), "fields from the photo are marked");
  ok(/register\.photo\.privacy/.test(screen), "privacy line shown with the suggestion");
  const helper = read("src/lib/imageAnalysis.ts");
  ok(/resize: \{ width: 768 \}/.test(helper) && /base64: true/.test(helper), "small JPEG sent");
  ok(/catch \{\s*return null;/.test(helper), "any failure falls back to search");

  console.log(`OK: T1.9AI checks passed (${n} assertions).`);
})().catch((e) => { console.error(e); process.exit(1); });
