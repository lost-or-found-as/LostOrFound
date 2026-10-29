"use strict";
// T1.9C behavior test: how cases are named in "My cases" (src/lib/caseDisplay.ts).
// Runs the real TypeScript helpers: with the project's TypeScript when installed (local PCs),
// otherwise with Node's type stripping (Node 22+, CI).
//   node .\scripts\test-t1-9c-case-display.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const FILES = ["caseDisplay.ts", "localizedReport.ts", "categories.ts"];

// Copy the helpers to a temp folder with explicit ".ts" import extensions (Node ESM needs them).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lof-case-display-"));
for (const f of FILES) {
  const src = fs.readFileSync(path.join(root, "src", "lib", f), "utf8")
    .replace(/from\s+"\.\/([A-Za-z]+)"/g, 'from "./$1.ts"');
  fs.writeFileSync(path.join(dir, f), src);
}

const runner = `
import assert from "node:assert";
import { caseTitle, caseAttributes, formatCaseDate } from "./caseDisplay.ts";
const ok = (got, want, label) => assert.strictEqual(got, want, label + ": got " + JSON.stringify(got));
const bag = { color: "multicolor", subcategory_key: "TOILETRY_BAG", category: "PERSONAL" };
ok(caseTitle(bag, "no"), "Toalettmappe", "NO title");
ok(caseAttributes(bag, "no"), "Flerfarget", "NO colour is Norwegian");
ok(caseTitle(bag, "en"), "Toiletry bag", "EN title");
ok(caseAttributes(bag, "en"), "Multicolor", "EN colour");
const ring = { color: "gold", subcategory_key: "RING", category: "JEWELRY", brand: "pandora" };
ok(caseTitle(ring, "no"), "Gullring", "NO compound word");
ok(caseTitle(ring, "en"), "Gold ring", "EN two words");
ok(caseAttributes(ring, "no"), "Pandora", "colour not repeated when in title; brand capitalised");
ok(caseAttributes({ color: "unknown", subcategory_key: "KEYS", category: "PERSONAL" }, "no"), "", "unknown colour hidden");
ok(caseTitle({ subcategory_key: "CUSTOM", subcategory_custom: "bamse", category: "PETS" }, "no"), "Bamse", "custom name capitalised");
ok(caseAttributes({ color: "turquoise", subcategory_key: "SCARF", category: "CLOTHING_ACCESSORIES" }, "no"), "Turkis", "all app colours translated");
ok(formatCaseDate("2026-10-29T10:00:00Z", "no"), "29. okt. 2026", "NO date");
ok(formatCaseDate("2026-10-29T10:00:00Z", "en"), "29 Oct 2026", "EN date");
console.log("OK: T1.9C case display tests passed (12 assertions).");
`;
fs.writeFileSync(path.join(dir, "run.mts"), runner);

let ts = null;
try { ts = require(path.join(root, "node_modules", "typescript")); } catch { ts = null; }
let r;
if (ts) {
  // Transpile each helper to ESM JavaScript and run the same assertions.
  for (const f of FILES) {
    const out = ts.transpileModule(fs.readFileSync(path.join(dir, f), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      fileName: f,
    }).outputText.replace(/from\s+"\.\/([A-Za-z]+)\.ts"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(dir, f.replace(/\.ts$/, ".mjs")), out);
  }
  fs.writeFileSync(path.join(dir, "run.mjs"), runner.replace('from "./caseDisplay.ts"', 'from "./caseDisplay.mjs"'));
  r = spawnSync(process.execPath, [path.join(dir, "run.mjs")], { encoding: "utf8" });
} else {
  r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(dir, "run.mts")], { encoding: "utf8" });
}
fs.rmSync(dir, { recursive: true, force: true });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status === 0 ? 0 : 1);
