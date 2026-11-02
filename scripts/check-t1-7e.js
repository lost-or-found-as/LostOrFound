"use strict";
const fs = require("fs");
const checks = [
  // T1.9W: the segmented tabs use cases.tab.active / cases.tab.history ("Aktive · n").
  ["app/my-reports.tsx", ["const { language, t } = useI18n();", "cases.tab.active", "cases.tab.history"]],
  ["app/report-details/[id].tsx", ["const { language, t } = useI18n();", "caseDetail.case.details", "caseDetail.additional.services"]],
  ["app/notifications.tsx", ["const { language, t } = useI18n();", "notifications.possible.matches.count", "notifications.deleted.unavailable.count"]],
  ["app/area-alert/[id].tsx", ["const { language, t } = useI18n();", "areaAlert.area.alert", "areaAlert.i.found.this"]],
];
let failed = false;
for (const [file, anchors] of checks) {
  const source = fs.readFileSync(file, "utf8");
  for (const anchor of anchors) {
    if (!source.includes(anchor)) {
      console.error(`${file}: missing ${anchor}`);
      failed = true;
    }
  }
  if (/f├|fÃ|Ã¸|Ã¥|â€”/.test(source)) {
    console.error(`${file}: contains encoding corruption`);
    failed = true;
  }
}
const backendFiles = [
  "server/routes/reportsActivity.js",
  "server/routes/reports.js",
  "server/routes/notifications.js",
];
const norwegianTechnical = /[æøåÆØÅ]|\b(?:rapport|rapporter|melding|varsler|slett|mangler|hent|opprett|avslutt|bruker|bilde|posisjon|samtale)\w*\b/i;
for (const file of backendFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (norwegianTechnical.test(source)) {
    console.error(`${file}: contains Norwegian technical text`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("OK: T1.7E case, notification, and backend source checks passed.");
