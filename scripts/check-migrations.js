"use strict";
// Supabase CLI migration folder rules (staging/baseline package).
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "supabase", "migrations");
const errors = [];
const files = fs.readdirSync(dir);
const versions = new Set();

for (const f of files) {
  const m = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) { errors.push(`BAD_MIGRATION_NAME: ${f}`); continue; }
  if (versions.has(m[1])) errors.push(`DUPLICATE_MIGRATION_VERSION: ${m[1]}`);
  versions.add(m[1]);
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  if (/\b(diagnostic|cleanup)\b/i.test(f)) errors.push(`DIAGNOSTIC_AS_MIGRATION: ${f}`);
  if (/sk_(live|test)_|service_role\s*=|eyJhbGci/i.test(sql)) errors.push(`SECRET_IN_MIGRATION: ${f}`);
}
for (const required of ["20261027210000_baseline_schema.sql", "20261027210100_baseline_storage_and_cron.sql"]) {
  if (!files.includes(required)) errors.push(`MISSING_BASELINE: ${required}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${files.length} migrations, CLI naming and baseline valid.`);
