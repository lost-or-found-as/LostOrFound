"use strict";
// T1.8E.5I check. Definitions, no native dialogs, no hard-coded user text, translation keys,
// then the T1.8E.5I behavior test and the earlier T1.8E.5H / T1.8E.5G.1 checks.
// Run from the repository root:
//   node .\scripts\check-t1-8e5i.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

// ---------------------------------------------------------------- backend
const guard = read("server/lib/geoAlertActivationGuard.js");
const rc = read("server/routes/reportCommerce.js");
const statusFn = guard.slice(guard.indexOf("async function getGeoAlertStatus("), guard.indexOf("module.exports"));
check(statusFn.length > 0, "STATUS_FUNCTION_MISSING");
check(/getGeoAlertActivationState\(reportId\)/.test(statusFn), "STATUS_NOT_FROM_DATABASE_STATE");
check(/\.in\("status", COUNTED_STATUSES\)/.test(statusFn), "STATUS_NOT_FILTERED_BY_COUNTED");
check(/COUNTED_STATUSES = \["ACTIVE", "GRACE", "PAUSED", "EXPIRED"\]/.test(guard), "STATUS_COUNTED_SET_CHANGED");
check(/\.like\("product_code", `\$\{GEO_ALERT_PRODUCT_PREFIX\}%`\)/.test(statusFn), "STATUS_NOT_LIMITED_TO_AREA_ALERT");
check(/new Date\(endsAt\)\.getTime\(\) > nowMs/.test(statusFn), "STATUS_LIVE_NOT_TIME_BASED");
check(/exports[\s\S]*getGeoAlertStatus/.test(guard), "STATUS_NOT_EXPORTED");

const route = rc.slice(rc.indexOf('router.get("/reports/:reportId/geo-alert-status"'), rc.indexOf('router.get("/my-purchases"'));
check(route.length > 0, "STATUS_ROUTE_MISSING");
check(/requireUser/.test(route), "STATUS_ROUTE_NOT_AUTHENTICATED");
check(/ownedReport\(reportId, userId\)/.test(route) && /status\(404\)/.test(route), "STATUS_ROUTE_NO_OWNER_CHECK");
check(/status\(500\)\.json\(\{ error: "GEO_ALERT_STATUS_FAILED" \}\)/.test(route), "STATUS_ROUTE_LEAKS_ERRORS");

// ---------------------------------------------------------------- client library
const lib = read("src/lib/reportCommerce.ts");
check(/error\.code = /.test(lib) && /error\.status = response\.status/.test(lib), "CLIENT_ERROR_WITHOUT_CODE_STATUS");
check(/new Error\(data\?\.error \|\| `HTTP_\$\{response\.status\}`\)/.test(lib), "CLIENT_ERROR_MESSAGE_CHANGED");
check(/\/reports\/\$\{encodeURIComponent\(reportId\)\}\/geo-alert-status/.test(lib), "CLIENT_STATUS_FETCH_MISSING");
const helper = read("src/lib/areaAlertStatus.ts");
check(!/from "react-native"|from "react"/.test(helper), "HELPER_NOT_PURE");
for (const fn of ["deriveAreaAlertView", "classifyAreaAlertError", "areaAlertDateParts", "areaAlertRadiusLabel"])
  check(new RegExp(`export function ${fn}\\(`).test(helper), `HELPER_MISSING_${fn}`);

// ---------------------------------------------------------------- screens
const create = read("app/geo-alert-create.tsx");
const details = read("app/report-details/[id].tsx");
const layout = read("app/_layout.tsx");
const card = read("src/ui/AreaAlertServiceCard.tsx");
const notice = read("src/ui/InlineNotice.tsx");

for (const [label, src] of [["CREATE", create], ["DETAILS", details], ["CARD", card], ["NOTICE", notice]]) {
  const code = noComments(src);
  check(!/\bAlert\.alert\(/.test(code), `${label}_USES_NATIVE_ALERT`);
  check(!/import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*"react-native"/.test(code), `${label}_IMPORTS_ALERT`);
  // User text must come from the locale files: no Norwegian letters in code strings.
  check(!/["'`][^"'`\n]*[æøåÆØÅ][^"'`\n]*["'`]/.test(code), `${label}_HARDCODED_NORWEGIAN_TEXT`);
  check(!/language === "no" \?\s*"/.test(code), `${label}_INLINE_LANGUAGE_SWITCH`);
}
check(!/e\?\.message \|\| String\(e\)/.test(create), "CREATE_SHOWS_RAW_ERROR");
check(/fetchGeoAlertStatus\(reportId\)/.test(create), "CREATE_NO_STATUS_FETCH");
check(/view\.kind === "live" \|\| view\.kind === "completed"/.test(create), "CREATE_NO_BLOCKED_STATE");
check(/info\.kind === "alreadyActive" \|\| info\.kind === "limitReached"[\s\S]{0,200}await loadStatus\(\)/.test(create), "CREATE_RULE_ERROR_NOT_SWITCHING_TO_STATUS");
check(/nothingOrdered: !orderCreated/.test(create) && /orderCreated = true;/.test(create), "CREATE_NOTHING_ORDERED_NOT_TRACKED");
check(/<InlineNotice/.test(create), "CREATE_NO_INLINE_NOTICE");

check(/useFocusEffect\(/.test(details) && /fetchGeoAlertStatus\(String\(id\)\)/.test(details), "DETAILS_NO_STATUS_REFRESH");
check(/<AreaAlertServiceCard view=\{geoView\}/.test(details), "DETAILS_NO_SERVICE_CARD");
check(/geoView\.kind === "none" && !expired && \(/.test(details), "DETAILS_CTA_NOT_LIMITED_TO_NONE");
// T1.9G: the separate "Tilleggstjenester" card was removed; the area alert has its own card.
check(!/caseDetail\.additional\.services/.test(details), "DETAILS_SERVICES_CARD_STILL_SHOWN");
check(/t\("caseDetail\.loadingReport"\)/.test(details), "DETAILS_LOADING_TEXT_NOT_LOCALIZED");
check(/name="report-details\/\[id\]"/.test(layout) && !/Saksdetaljer/.test(layout), "LAYOUT_REPORT_DETAILS_NOT_REGISTERED_CLEANLY");

// ---------------------------------------------------------------- translation keys used exist in both locales
const keysIn = (file) => new Set([...read(file).matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
const en = keysIn("src/i18n/locales/en.ts");
const no = keysIn("src/i18n/locales/no.ts");
for (const [label, src] of [["CREATE", create], ["DETAILS", details], ["CARD", card]]) {
  for (const m of src.matchAll(/\b(?:t\(|tr\(language,\s*)\s*"([a-zA-Z0-9_.]+)"/g)) {
    check(en.has(m[1]), `${label}_KEY_MISSING_EN_${m[1]}`);
    check(no.has(m[1]), `${label}_KEY_MISSING_NO_${m[1]}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`FAILED: ${failures.length} T1.8E.5I definition checks.`);
  process.exit(1);
}
console.log("OK: T1.8E.5I definition checks passed.");

for (const script of ["check-i18n-parity.js", "test-t1-8e5i.js", "check-t1-8e5h.js"]) {
  try { execFileSync(process.execPath, [path.join(root, "scripts", script)], { stdio: "inherit", cwd: root }); }
  catch { console.error(`FAILED: ${script}`); process.exit(1); }
}
console.log("OK: T1.8E.5I checks passed.");
