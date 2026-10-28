"use strict";
// Runs every active repository check in one command: `npm run verify`.
// Used locally before commit and by .github/workflows/verify.yml on every push.
//
// Active gates are listed explicitly. Older package checks that assert code
// shapes replaced by later packages are listed under SUPERSEDED and are not run.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");

const ACTIVE_CHECKS = [
  "check-i18n-parity.js",
  "check-migrations.js",
  "check-t1-9a.js",
  "check-report-map-i18n.js",
  "check-t1-7d.js",
  "check-t1-7f.js",
  "check-t1-7g.js",
  "check-t1-7i.js",
  "check-t1-8a.js",
  "check-t1-8b.js",
  "check-t1-8c.js",
  "check-t1-8c1.js",
  "check-t1-8c2.js",
  "check-t1-8d.js",
  "check-t1-8d3.js",
  "check-t1-8d31.js",
  "check-t1-8e1.js",
  "check-t1-8e2.js",
  "check-t1-8e3.js",
  "check-t1-8e32.js",
  "check-t1-8e33.js",
  "check-t1-8e411-styles.js",
  "check-t1-8e413-syntax.js",
  "check-t1-8e413.js",
  "check-t1-8e5f.js",
  "check-t1-8e5g1.js",
  "check-t1-8e5h.js",
  "check-t1-8e5i.js",
  "test-t1-8e5g1-dispatch.js",
  "test-t1-8e5h-activation.js",
  "test-t1-8e5i.js",
  "test-t1-8e5j.js",
  "check-t1-8e5j.js",
];

// Not run: these assert code that later packages intentionally replaced.
const SUPERSEDED = [
  "check-t1-7e.js",
  "check-t1-7h.js",
  "check-t1-8d1.js",
  "check-t1-8d2.js",
  "check-t1-8d4.js",
  "check-t1-8d41.js",
  "check-t1-8d42.js",
  "check-t1-8d43.js",
  "check-t1-8d44.js",
  "check-t1-8e31.js",
  "check-t1-8e4.js",
  "check-t1-8e41.js",
  "check-t1-8e411.js",
  "check-t1-8e412.js",
  "check-t1-8e5a.js",
  "check-t1-8e5b.js",
  "check-t1-8e5e.js",
];

function serverFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...serverFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const failures = [];

// 1. Every committed check script must be either active or explicitly superseded.
//    Only files tracked by git count, so local untracked files do not fail the run.
const scriptDir = path.join(root, "scripts");
const known = new Set([...ACTIVE_CHECKS, ...SUPERSEDED]);
let scriptNames;
const tracked = spawnSync("git", ["ls-files", "--", "scripts"], { cwd: root, encoding: "utf8" });
if (tracked.status === 0) {
  scriptNames = tracked.stdout.split(/\r?\n/).filter((p) => /^scripts\/[^/]+$/.test(p)).map((p) => p.slice(8));
} else {
  scriptNames = fs.readdirSync(scriptDir);
}
for (const name of scriptNames) {
  if (/^(check|test)-.*\.js$/.test(name) && !known.has(name)) {
    failures.push(`UNLISTED_CHECK: scripts/${name} is not in scripts/verify.js`);
  }
}

// 2. Syntax check of all backend files.
for (const file of serverFiles(path.join(root, "server"))) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) failures.push(`SYNTAX_ERROR: ${path.relative(root, file)}\n${r.stderr}`);
}

// 3. Active checks.
for (const name of ACTIVE_CHECKS) {
  const r = spawnSync(process.execPath, [path.join(scriptDir, name)], { cwd: root, encoding: "utf8" });
  if (r.status === 0) {
    console.log(`PASS ${name}`);
  } else {
    console.log(`FAIL ${name}`);
    failures.push(`CHECK_FAILED: ${name}\n${(r.stdout || "") + (r.stderr || "")}`.trim());
  }
}

if (failures.length) {
  console.error(`\nVERIFY_FAILED: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`${f}\n`);
  process.exit(1);
}
console.log(`\nVERIFY_OK: ${ACTIVE_CHECKS.length} checks passed; backend syntax OK.`);
