// scripts/test-t1-9bd.js
// T1.9BD: photo analysis without usable JSON gives «no suggestion» (200, logged, no alert), and the
// analysis switched off on purpose is not reported to Sentry.
//   node .\scripts\test-t1-9bd.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const lib = require(path.join(root, "server/lib/imageAnalysis.js"));
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

async function main() {
  const prose = async () => ({ ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "I can't tell what this is." }] }) });
  let err = null;
  try { await lib.askModel("/9j/AAAA", { env: { ANTHROPIC_API_KEY: "x" }, fetchImpl: prose }); } catch (e) { err = e; }
  ok(err && err.code === "ANALYSIS_UNREADABLE", "prose answer is unreadable");
  ok(err.stopReason === "end_turn" && /can't tell/.test(err.snippet), "short hint kept for the log");
  const fenced = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: '```json\n{"category":"BAGS_LUGGAGE","item":"BACKPACK","colors":["black"],"confidence":"high"}\n```' }] }) });
  ok((await lib.askModel("/9j/AAAA", { env: { ANTHROPIC_API_KEY: "x" }, fetchImpl: fenced })).raw.item === "BACKPACK", "JSON in a code block still read");

  const route = read("server/routes/imageAnalysis.js");
  ok(/if \(code === "ANALYSIS_UNREADABLE"\) \{[\s\S]*?return res\.json\(\{ status: "NO_ITEM", suggestion: empty \}\);/.test(route), "unreadable gives no suggestion, not 502");
  ok(/stopReason: e\?\.stopReason, snippet: e\?\.snippet/.test(route), "logged with the hint");
  ok(/status: "FAILED", error_code/.test(route), "still counted in the analysis log");
  const sentry = read("server/lib/sentry.js");
  ok(/const EXPECTED_CODES = new Set\(\["IMAGE_ANALYSIS_DISABLED"\]\);/.test(sentry) && /if \(res\.statusCode >= 500 && !expected\)/.test(sentry), "switched-off analysis is not an alert");
  console.log(`T1.9BD OK (${n} checks)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
