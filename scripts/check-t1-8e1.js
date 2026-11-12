const fs = require("fs"),
  p = require("path"),
  r = (f) => fs.readFileSync(p.join(process.cwd(), f), "utf8");
const app = r("app/(report)/create-report.tsx"),
  en = r("src/i18n/locales/en.ts"),
  no = r("src/i18n/locales/no.ts"),
  pkg = JSON.parse(r("package.json"));
for (const s of [
  "DateTimePicker",
  "const [datePickerOpen, setDatePickerOpen]",
  "maximumDate={new Date()}",
  "applySelectedDate",
  "setValidationMissing((current)",
  "dateButton:", "dateButtonText:", "datePickerWrap:",
  'textAlign: "center"',
])
  if (!app.includes(s)) throw Error(`Missing T1.8E.1 feature: ${s}`);
// Expo 58 upgrade: the date picker follows the version Expo pins (9.x).
if (!/^[~^]?9\./.test(pkg.dependencies["@react-native-community/datetimepicker"] || ""))
  throw Error("Date picker dependency mismatch");
for (const k of [
  "report.create.choose.date",
  "report.create.open.calendar",
  "report.create.date.cannot.be.in.future",
])
  if (!en.includes(`"${k}"`) || !no.includes(`"${k}"`))
    throw Error(`Missing locale key: ${k}`);
const keys = (s) =>
    new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])),
  a = keys(en),
  b = keys(no);
if ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))
  throw Error("Locale parity failed");
console.log(`OK: T1.8E.1 checks passed. ${a.size} keys in both locales.`);
