// scripts/test-t1-9ak.js
// T1.9AK: a lost case can be shared as a public page and an A4 poster with a QR code. The page
// shows only what helps people look (item or pet, photo, date, town, description, temperament)
// and never the owner, the exact place, a chip number, the reward or the report id.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const page = require(path.join(root, "server/lib/sharePage.js"));

// Place: town only.
eq(page.areaName("Tåsenveien 12, 0853 Oslo"), "Oslo", "street and postcode dropped");
eq(page.areaName("Storgata 1, 9008 Tromsø, Norge"), "Tromsø", "country dropped");
eq(page.areaName(""), "", "no place, no area");

const report = {
  id: "11111111-2222-3333-4444-555555555555",
  type: "LOST", status: "ACTIVE", category: "PETS", subcategory_key: "DOG", color: "black",
  occurred_at: "2026-11-11T17:30:00Z", location_label: "Tåsenveien 12, 0853 Oslo",
  description: "Rødt halsbånd <script>alert(1)</script>", pet_name: "Luna", pet_breed: "Border collie", pet_temperament: "SHY",
  reward_ore: 50000, user_id: "owner-secret", identifier: "578098000124821",
};
const html = page.renderSharePage({ report, lang: "no", photoUrl: "https://x/y.jpg?token=a&b=c", posterUrl: "https://api/s/abc/poster" });
ok(/<h1>Luna<\/h1>/.test(html), "pet name as heading");
ok(/Savnet dyr/.test(html) && /Border collie/.test(html) && /Område: Oslo/.test(html), "kind, breed and town");
ok(/Ikke løp etter det/.test(html), "shy pet warning");
ok(!/<script>alert/.test(html) && /&lt;script&gt;/.test(html), "description is escaped");
ok(!/Tåsenveien|0853/.test(html), "no street or postcode");
ok(!/owner-secret|578098000124821|50000|500 kr|11111111-2222/.test(html), "no owner, chip number, reward or report id");
ok(/noindex/.test(html), "not indexed by search engines");
ok(/token=a&amp;b=c/.test(html), "photo URL escaped");

const item = page.renderSharePage({ report: { ...report, category: "PERSONAL", subcategory_key: "WALLET", pet_name: "Luna", pet_temperament: "SHY" }, lang: "en", photoUrl: null, posterUrl: null });
ok(/Lost/.test(item) && !/Luna/.test(item) && !/shy/i.test(item), "an item shows no pet fields");

const poster = page.renderPoster({ report, lang: "no", photoUrl: null, pageUrl: "https://api.lostorfound.app/s/abcdefghijklmnopqrst", qrSvg: "<svg id=\"qr\"></svg>" });
ok(/<svg id="qr"><\/svg>/.test(poster) && /@page\{size:A4/.test(poster), "A4 poster with the QR code");
ok(/Skann koden/.test(poster) && /window\.print\(\)/.test(poster), "scan text and print button");
ok(/@media print\{\.print\{display:none\}\}/.test(poster), "print button not printed");
ok(page.renderPoster({ report, lang: "en", photoUrl: null, pageUrl: "u", qrSvg: null }).includes("Scan the code"), "poster works without a QR code");

// Routes.
const share = read("server/routes/share.js");
ok(/TOKEN_RE = \/\^\[A-Za-z0-9_-\]\{16,40\}\$\//.test(share), "token format checked before the database");
ok(/r\.type === "LOST" && r\.status === "ACTIVE" && !r\.deleted_at && !r\.closed_at/.test(share), "only open lost cases");
ok(/report \? 410 : 404/.test(share), "closed or unknown: the closed page");
ok(!/user_id|reward_ore|report_identifiers/.test(share.match(/SHARE_COLUMNS = "[^"]+"/)[0]), "page reads no owner, reward or identifier");
ok(/require\("qrcode"\)/.test(share) && /catch \(e\) \{\s*console\.warn\("\[share\] QR code failed"/.test(share), "QR code optional");
ok(/app\.use\("\/s", shareRoutes\)/.test(read("server/index.js")), "mounted at /s");
const reports = read("server/routes/reports.js");
ok(/router\.post\("\/:id\/share", requireUser/.test(reports) && /router\.delete\("\/:id\/share", requireUser/.test(reports), "owner can start and stop sharing");
ok(/\.eq\("user_id", req\.user\.id\)[\s\S]{0,500}SHARE_NOT_ALLOWED/.test(reports), "only the owner, only lost and active");
ok(/randomBytes\(15\)\.toString\("base64url"\)/.test(reports), "random 20-character code");

// Database.
const mig = read("supabase/migrations/20261113130000_t1_9ak_share_link.sql");
ok(/share_token text/.test(mig) && /reports_share_token_key/.test(mig) && /\{16,40\}/.test(mig), "token column, unique, checked");

// Texts in every server language used by the page.
for (const lang of ["no", "en", "de"]) {
  const j = JSON.parse(read(`server/locales/${lang}.json`));
  ok(["share.lostPet", "share.seenIt", "share.posterScan", "share.closedTitle"].every((k) => j[k]), `share texts in ${lang}`);
}

// App.
const screen = read("app/report-details/[id].tsx");
ok(/const canShare = lost && !closed && !expired/.test(screen), "share card only for open lost cases");
ok(/caseDetail\.share\.stop/.test(screen) && /stopSharing\(/.test(screen), "owner can stop sharing");
ok(/WebBrowser\.openBrowserAsync\(urls\.poster\)/.test(screen) && /Share\.share\(/.test(screen), "poster opens in the browser, link via the share sheet");

console.log(`OK: T1.9AK checks passed (${n} assertions).`);
