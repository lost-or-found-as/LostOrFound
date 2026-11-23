// scripts/test-t1-9br.js
// T1.9BR: search tips with a checklist on lost animals; tear-off tabs on the poster; found
// animals can be shared with picture, kind, area and date only.
//   node .\scripts\test-t1-9br.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const sp = require(path.join(root, "server/lib/sharePage.js"));
const found = { type: "FOUND", category: "PETS", subcategory_key: "CAT", occurred_at: "2026-11-21T10:00:00Z", location_label: "Thorvald Meyers gate 1, 0552 Oslo", description: "Red collar with a bell", pet_name: "Pusur", pet_temperament: "SHY" };
const c = sp.pageContent(found, "no");
ok(c.found && c.description === "" && c.temperament === "" && !/Pusur/.test(JSON.stringify(c)), "found: no description, name or temperament");
ok(/Oslo/.test(c.area) && !/Thorvald/.test(c.area), "found: area only");
const poster = sp.renderPoster({ report: found, lang: "no", photoUrl: null, pageUrl: "https://x/s/t", qrSvg: "<svg></svg>" });
ok(!/Red collar/.test(poster) && !/Pusur/.test(poster) && /Funnet dyr/.test(poster), "found poster shows no details");
eq((poster.match(/class="tab"/g) || []).length, sp.TEAR_OFF_TABS, "six tear-off tabs");
const lostPoster = sp.renderPoster({ report: { type: "LOST", category: "PETS", subcategory_key: "DOG", pet_name: "Bamse" }, lang: "en", photoUrl: null, pageUrl: "https://x/s/t", qrSvg: "<svg></svg>" });
ok((lostPoster.match(/<span>Bamse<\/span>/g) || []).length === 6, "lost tabs carry the name");
ok(!/class="tab"/.test(sp.renderPoster({ report: found, lang: "no", photoUrl: null, pageUrl: "x", qrSvg: null })), "no tabs without a QR code");
const page = sp.renderSharePage({ report: found, lang: "en", photoUrl: null, posterUrl: null, reportUrl: null });
ok(/Is this your animal\?/.test(page) && !/Red collar/.test(page), "found page asks the owner to describe it");
ok(sp.isAnimal(found) && !sp.isAnimal({ category: "PETS", subcategory_key: "PET_LEASH" }), "animals only, not leashes");

const share = read("server/routes/share.js");
ok(/r\.type === "LOST" \|\| \(r\.type === "FOUND" && isAnimal\(r\)\)/.test(share), "share page open for found animals");
const reports = read("server/routes/reports.js");
ok(/report\.type === "FOUND" && require\("\.\.\/lib\/sharePage"\)\.isAnimal\(report\)/.test(reports) && /category, subcategory_key, share_token/.test(reports), "owner can share a found animal");
for (const l of ["no", "en", "de"]) {
  const m = require(path.join(root, `server/locales/${l}.json`));
  for (const k of ["share.foundPet", "share.foundHeading", "share.foundOn", "share.foundCta", "share.foundCtaBody", "share.foundPosterScan", "share.foundPosterFooter"]) ok(m[k], `${k} in ${l}`);
}

// App.
const tips = read("src/lib/petSearchTips.ts");
ok(/https:\/\/www\.dyreid\.no/.test(tips) && /CAT:/.test(tips) && /DOG:/.test(tips) && /OTHER:/.test(tips) && /lof\.petTips\./.test(tips), "tips by kind, ticks on the phone");
const rd = read("app/report-details/[id].tsx");
ok(/<PetSearchTips/.test(rd) && /lost && animal && !closed/.test(rd), "tips on open lost animal cases");
ok(/const canShare = \(lost \|\| animal\) && !closed && !expired/.test(rd) && /caseDetail\.share\.bodyFound/.test(rd), "share card for found animals");
for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"])
  for (const k of ["caseDetail.share.bodyFound", "caseDetail.share.messageFound", "petTips.title", "petTips.titleNamed", "petTips.lead.cat", "petTips.lead.dog", "petTips.lead.other", "petTips.item.chip", "petTips.item.poster", "petTips.progress", "petTips.openLink"])
    ok(read(f).includes(`"${k}"`), `${k} in ${f}`);
// The chip registry follows the phone's region, not the language.
ok(/regionCode \|\| ""\)\.toUpperCase\(\) === "NO"/.test(tips) && /petTips\.item\.chipGeneric/.test(tips) && /Localization\.getLocales\(\)\[0\]\?\.regionCode/.test(read("src/ui/PetSearchTips.tsx")), "DyreID only in Norway");
for (const f of ["src/i18n/locales/no.ts", "src/i18n/locales/en.ts"]) ok(read(f).includes('"petTips.item.chipGeneric"'), `chipGeneric in ${f}`);
console.log(`T1.9BR OK (${n} checks)`);
