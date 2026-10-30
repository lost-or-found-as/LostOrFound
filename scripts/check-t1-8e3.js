const fs = require("fs"),
  p = require("path"),
  r = (f) => fs.readFileSync(p.join(process.cwd(), f), "utf8");
const checks = {
  "app/notifications.tsx": [
    'notificationType === "NEW_MATCH"',
    'pathname: "/match"',
  ],
  "app/my-reports.tsx": [
    "reactivateLostReport",
    "REPORT_REACTIVATION",
    "cases.reactivate.30.days",
  ],
  "app/match.tsx": ["normalizedReportColors", "sharedColorValue"],
  // T1.9F: the detail screen compares both colours (incl. secondary) in "How the cases compare".
  "app/matches/[matchId].tsx": [
    "reportSecondaryColor",
    "matchDetail.compare.color",
  ],
  "server/routes/matches.js": ["enrichMatchColorInfo", "matched_color"],
};
for (const [f, values] of Object.entries(checks)) {
  const s = r(f);
  for (const v of values)
    if (!s.includes(v.replaceAll('\\"', '"')))
      throw Error(`Missing ${v} in ${f}`);
}
const en = r("src/i18n/locales/en.ts"),
  no = r("src/i18n/locales/no.ts"),
  keys = (s) =>
    new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])),
  a = keys(en),
  b = keys(no);
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw Error("Locale parity failed");
console.log(`OK: T1.8E.3 checks passed. ${a.size} keys in both locales.`);
