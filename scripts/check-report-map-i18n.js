"use strict";
const fs = require("fs");
// T1.9BC: the old form is gone; the one-page form registers and edits.
const files = ["app/(report)/register.tsx", "app/(report)/map.tsx"];
const localeSource = fs.readFileSync("src/i18n/locales/en.ts", "utf8");
const localeKeys = new Set([...localeSource.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]));
let failed = false;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const missing = [...source.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]).filter((key) => !localeKeys.has(key));
  if (missing.length) {
    failed = true;
    console.error(`${file}: missing translation keys`, [...new Set(missing)]);
  }
  const technicalNorwegian = source.split(/\r?\n/).filter((line) => /\/\/|\/\*/.test(line) && /[æøåÆØÅ]/.test(line));
  if (technicalNorwegian.length) {
    failed = true;
    console.error(`${file}: Norwegian technical comments remain`, technicalNorwegian);
  }
}
const allSource = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const remainingLanguageBranches = [...allSource.matchAll(/language\s*===\s*"en"/g)].length;
if (remainingLanguageBranches > 2) {
  failed = true;
  console.error(`Too many inline language branches remain: ${remainingLanguageBranches}`);
}
if (failed) process.exit(1);
console.log("OK: report creation and map localization checks passed.");
