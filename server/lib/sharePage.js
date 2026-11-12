"use strict";
// T1.9AK: the public page and the printable poster for a shared lost report.
// Shown: what is lost (item or pet name, breed), photo, date, the town or area only, the owner's
// description and the pet's temperament. Never shown: the owner, the exact place, the chip number
// or any other identifier, the reward or the report id.
const { message } = require("./messages");
const { reportItemText } = require("./reportItemText");

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const ANIMALS = new Set(["DOG", "CAT", "BIRD", "RABBIT", "SMALL_PET", "REPTILE", "HORSE", "OTHER_PET", "CUSTOM"]);
const isAnimal = (r) => String(r?.category || "").toUpperCase() === "PETS" && ANIMALS.has(String(r?.subcategory_key || "").toUpperCase());

/** The town or area from a place label: the last part, without a postcode ("Tåsenveien 1, 0853 Oslo" -> "Oslo"). */
function areaName(label) {
  const parts = String(label || "").split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  const withoutPostcode = last.replace(/^\d{3,6}\s+/, "").trim();
  if (!withoutPostcode || /^(norge|norway|noreg)$/i.test(withoutPostcode)) {
    const before = parts[parts.length - 2] || "";
    return before.replace(/^\d{3,6}\s+/, "").trim().slice(0, 60);
  }
  return withoutPostcode.slice(0, 60);
}

function formatDate(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(lang === "no" ? "nb-NO" : lang === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Plain values for the page; everything still needs escaping when it is put into HTML. */
function pageContent(report, lang) {
  const animal = isAnimal(report);
  const item = reportItemText(report, lang);
  const name = animal && report.pet_name ? String(report.pet_name).trim() : "";
  return {
    animal,
    kicker: animal ? message(lang, "share.lostPet") : message(lang, "share.lost"),
    heading: name || item || message(lang, "share.lost"),
    subheading: [name ? item : "", animal ? String(report.pet_breed || "").trim() : ""].filter(Boolean).join(" · "),
    since: report.occurred_at ? message(lang, "share.lostSince", { date: formatDate(report.occurred_at, lang) }) : "",
    area: areaName(report.location_label) ? message(lang, "share.area", { area: areaName(report.location_label) }) : "",
    description: String(report.description || "").trim().slice(0, 600),
    temperament:
      animal && (report.pet_temperament === "SHY" || report.pet_temperament === "CALM")
        ? message(lang, `share.temperament.${report.pet_temperament}`)
        : "",
  };
}

const STYLE = `:root{--bg:#F7F8FA;--card:#FFFFFF;--text:#0F172A;--muted:#475569;--border:#E5E7EB;--ink:#111827;--ink-text:#FFFFFF;--warn-bg:#FFFBEB;--warn-border:#FCD34D;--warn-text:#78350F}
@media (prefers-color-scheme: dark){:root{--bg:#0B1120;--card:#111827;--text:#E5E7EB;--muted:#9CA3AF;--border:#1F2937;--ink:#E5E7EB;--ink-text:#0B1120;--warn-bg:#2A2006;--warn-border:#92400E;--warn-text:#FDE68A}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:560px;margin:0 auto;padding:20px 16px 48px;display:flex;flex-direction:column;gap:14px}
.brand{font-weight:900;font-size:16px;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:8px}
.photo{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;background:var(--border)}
.kicker{display:inline-block;align-self:flex-start;background:#FFF1F2;color:#881337;font-weight:900;font-size:13px;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px}
h1{margin:0;font-size:30px;line-height:1.15;letter-spacing:-.02em}.sub{margin:0;color:var(--muted);font-weight:700}
.meta{margin:0;font-weight:700}.desc{margin:0;white-space:pre-line}
.warn{background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);border-radius:14px;padding:12px 14px;font-weight:700}
.btn{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:14px;background:var(--ink);color:var(--ink-text);font-weight:900;text-decoration:none}
.btn2{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:14px;border:1px solid var(--border);color:var(--text);font-weight:800;text-decoration:none;background:var(--card)}
h2{margin:0;font-size:20px}p{margin:0}`;

function shell(lang, title, body, { noindex = true } = {}) {
  return `<!doctype html><html lang="${lang === "no" ? "nb" : esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${noindex ? '<meta name="robots" content="noindex">' : ""}<title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** The public page. photoUrl may be null. */
function renderSharePage({ report, lang, photoUrl, posterUrl }) {
  const c = pageContent(report, lang);
  const body = `<main>
<span class="brand">Lost or Found</span>
<section class="card">
${photoUrl ? `<img class="photo" src="${esc(photoUrl)}" alt="${esc(c.heading)}">` : ""}
<span class="kicker">${esc(c.kicker)}</span>
<h1>${esc(c.heading)}</h1>
${c.subheading ? `<p class="sub">${esc(c.subheading)}</p>` : ""}
${c.since ? `<p class="meta">${esc(c.since)}</p>` : ""}
${c.area ? `<p class="meta">${esc(c.area)}</p>` : ""}
${c.description ? `<p class="desc">${esc(c.description)}</p>` : ""}
</section>
${c.temperament ? `<div class="warn">${esc(c.temperament)}</div>` : ""}
<section class="card">
<h2>${esc(message(lang, "share.seenIt"))}</h2>
<p>${esc(message(lang, "share.seenItBody"))}</p>
<a class="btn" href="lostorfound://">${esc(message(lang, "share.openApp"))}</a>
<a class="btn2" href="https://lostorfound.app">${esc(message(lang, "share.getApp"))}</a>
</section>
${posterUrl ? `<a class="btn2" href="${esc(posterUrl)}">${esc(message(lang, "share.posterPrint"))}</a>` : ""}
</main>`;
  return shell(lang, `${c.kicker}: ${c.heading}`, body);
}

function renderClosedPage({ lang }) {
  const body = `<main><span class="brand">Lost or Found</span><section class="card"><h1>${esc(message(lang, "share.closedTitle"))}</h1><p>${esc(message(lang, "share.closedBody"))}</p><a class="btn2" href="https://lostorfound.app">Lost or Found</a></section></main>`;
  return shell(lang, message(lang, "share.closedTitle"), body);
}

/** A4 poster: big kicker, photo, name, details, QR code (an SVG string, or null) and the link. */
function renderPoster({ report, lang, photoUrl, pageUrl, qrSvg }) {
  const c = pageContent(report, lang);
  const style = `@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0F172A;background:#FFFFFF}
.page{max-width:186mm;margin:0 auto;padding:6mm 0;display:flex;flex-direction:column;gap:5mm}
.kicker{font-size:64px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:#B91C1C;text-align:center;line-height:1}
.photo{width:100%;height:105mm;object-fit:cover;border-radius:6mm;background:#E5E7EB}
h1{margin:0;font-size:44px;text-align:center;line-height:1.1}.sub,.meta{margin:0;text-align:center;font-size:20px;font-weight:700;color:#334155}
.desc{margin:0;text-align:center;font-size:17px;white-space:pre-line}
.warn{border:2px solid #92400E;border-radius:4mm;padding:3mm 4mm;font-size:18px;font-weight:800;text-align:center;color:#78350F}
.bottom{display:flex;align-items:center;gap:6mm;border-top:2px solid #0F172A;padding-top:5mm}
.qr{width:42mm;height:42mm;flex-shrink:0}.qr svg{width:100%;height:100%}
.cta{font-size:24px;font-weight:900}.url{font-size:13px;color:#475569;word-break:break-all}
.print{position:fixed;right:16px;bottom:16px;padding:12px 18px;border-radius:12px;border:0;background:#111827;color:#fff;font-weight:900;font-size:16px}
@media print{.print{display:none}}`;
  const body = `<div class="page">
<div class="kicker">${esc(c.kicker)}</div>
${photoUrl ? `<img class="photo" src="${esc(photoUrl)}" alt="${esc(c.heading)}">` : ""}
<h1>${esc(c.heading)}</h1>
${c.subheading ? `<p class="sub">${esc(c.subheading)}</p>` : ""}
${c.since || c.area ? `<p class="meta">${esc([c.since, c.area].filter(Boolean).join(" · "))}</p>` : ""}
${c.description ? `<p class="desc">${esc(c.description.slice(0, 280))}</p>` : ""}
${c.temperament ? `<div class="warn">${esc(c.temperament)}</div>` : ""}
<div class="bottom">${qrSvg ? `<div class="qr">${qrSvg}</div>` : ""}<div><div class="cta">${esc(message(lang, "share.posterScan"))}</div><div>${esc(message(lang, "share.posterFooter"))}</div><div class="url">${esc(pageUrl)}</div></div></div>
</div>
<button class="print" onclick="window.print()">${esc(message(lang, "share.posterPrint"))}</button>`;
  return `<!doctype html><html lang="${lang === "no" ? "nb" : esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(`${c.kicker}: ${c.heading}`)}</title><style>${style}</style></head><body>${body}</body></html>`;
}

module.exports = { esc, areaName, pageContent, renderSharePage, renderClosedPage, renderPoster };
