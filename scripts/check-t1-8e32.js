const fs = require("fs"),
  p = require("path"),
  r = (f) => fs.readFileSync(p.join(process.cwd(), f), "utf8");
const c = {
  "app/my-reports.tsx": [
    // T1.9W: the payment dialog is a ConfirmSheet (kit buttons) instead of paymentActions styles.
    "<ConfirmSheet",
    'confirmDialog?.kind === "reactivateLost" && (',
    "cases.reactivation.success.title",
  ],
  "app/match.tsx": [
    "listRow",
    "rankPill",
    "/matches/${item.id}",
    "second.score",
    "match.ranked.matches.for.your.case",
  ],
  "app/match-comparison/[matchId].tsx": [
    "MatchComparisonRedirect",
    "router.replace(`/matches/${resolvedMatchId}`)",
  ],
};
for (const [f, values] of Object.entries(c)) {
  const s = r(f);
  for (const v of values)
    if (!s.includes(v)) throw Error(`Missing ${v} in ${f}`);
}
const list = r("app/match.tsx");
if (
  list.includes("onPress={() => router.push(`/match-comparison/${item.id}`)}")
)
  throw Error("Obsolete comparison navigation remains");
const en = r("src/i18n/locales/en.ts"),
  no = r("src/i18n/locales/no.ts"),
  keys = (s) =>
    new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])),
  a = keys(en),
  b = keys(no);
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw Error("Locale parity failed");
console.log(`OK: T1.8E.3.2 checks passed. ${a.size} keys in both locales.`);
