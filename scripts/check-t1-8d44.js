const fs = require("fs");
const path = require("path");
const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
// T1.9W: the shared helpers moved to src/lib/alertAreas.ts.
const app = read("app/alert-areas.tsx") + read("src/lib/alertAreas.ts");
const en = read("src/i18n/locales/en.ts");
const no = read("src/i18n/locales/no.ts");
for (const value of [
  "CATEGORY_LABEL_KEYS",
  "circleBounds",
  "fitToCoordinates",
  "longitudeOffset",
  "fitEditor",
]) {
  if (!app.includes(value))
    throw new Error(`T1.8D.4.4 feature missing: ${value}`);
}
for (const broken of ["NÃ", "KlÃ", "Ã¸", "Ã¦", "Ã¥", "�"]) {
  if (app.includes(broken) || no.includes(broken))
    throw new Error(`Mojibake remains: ${broken}`);
}
for (const key of [
  "pets",
  "jewelry",
  "electronics",
  "keys",
  "bags",
  "clothing",
  "sports",
  "transport",
]) {
  const translationKey = `alertAreas.category.${key}`;
  if (
    !en.includes(`"${translationKey}"`) ||
    !no.includes(`"${translationKey}"`)
  )
    throw new Error(`Missing category translation: ${translationKey}`);
}
const keys = (source) =>
  new Set([...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]));
const enKeys = keys(en);
const noKeys = keys(no);
if (
  [...enKeys].some((key) => !noKeys.has(key)) ||
  [...noKeys].some((key) => !enKeys.has(key))
)
  throw new Error("Locale parity failed");
console.log(
  `OK: T1.8D.4.4 checks passed. ${enKeys.size} keys in both locales.`,
);
