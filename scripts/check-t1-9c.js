"use strict";
// T1.9C static checks: "My cases" uses shared, localized case naming and the new card layout.
const fs = require("fs");
const path = require("path");
const s = fs.readFileSync(path.join(__dirname, "..", "app", "my-reports.tsx"), "utf8");
const errors = [];
const check = (ok, code) => { if (!ok) errors.push(code); };
check(/caseTitle\(r, language\)/.test(s) && /caseAttributes\(r, language\)/.test(s), "SHARED_CASE_NAMING_NOT_USED");
check(!/function (colorLabel|prettyReportTitle|objectPhrase)\b/.test(s), "LOCAL_LABEL_HELPERS_REMAIN");
check(/formatCaseDate\(r\.created_at, language\)/.test(s) && !/toLocaleDateString\(\)/.test(s), "DATE_NOT_LOCALIZED");
check(/onPress=\{\(\) => openReport\(r\)\}\s*\n\s*accessibilityRole="button"/.test(s), "CARD_NOT_TAPPABLE");
check((s.match(/confirmDelete\(r\)/g) || []).length === 1 && /run\(\(\) => confirmDelete\(r\)\)/.test(s), "DELETE_NOT_BEHIND_MENU");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("OK: T1.9C My cases checks passed.");
