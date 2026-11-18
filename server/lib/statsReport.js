"use strict";
// T1.9AR: the owner's statistics report. Turns raw rows into counts only (no names, e-mails or
// exact places) and renders one self-contained HTML file with no network use.
// Map cells with fewer than MIN_CELL cases are hidden so no single case can be recognised.

const DAY = 24 * 60 * 60 * 1000;
const MIN_CELL = 5;
const LAT_STEP = 0.05; // about 5.5 km
const LNG_STEP = 0.1; // about 5 km at 60°N
const WEEKS = 12;
const PAID = new Set(["PAID", "ACTIVE"]);

/** Monday 00:00 UTC of the week holding t. */
function weekStart(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** Town from a free-text place label: last comma part, postcode removed. */
function townFromLabel(label) {
  const parts = String(label || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const town = parts[parts.length - 1].replace(/\b\d{4}\b/g, "").replace(/\bNorge\b|\bNorway\b/gi, "").trim();
  return town || (parts.length > 1 ? parts[parts.length - 2].replace(/\b\d{4}\b/g, "").trim() || null : null);
}

function cellKey(lat, lng) {
  return `${Math.floor(lat / LAT_STEP)}:${Math.floor(lng / LNG_STEP)}`;
}

/**
 * raw = { users:[{created_at,is_anonymous}], reports:[{type,status,created_at,deleted_at,lat,lng,location_label}],
 *         matches:[{lost_id}], resolutions:[{context_type,status,responded_at}],
 *         orders:[{product_code,status,amount_ore,paid_at,created_at,refunded_at}] , reportIdsByType }
 */
function buildStats(raw, { now = Date.now(), minCell = MIN_CELL } = {}) {
  const t = (s) => (s ? Date.parse(s) : NaN);
  const since = (days) => now - days * DAY;
  const users = raw.users || [];
  const reports = (raw.reports || []).filter((r) => !r.deleted_at);
  const resolutions = (raw.resolutions || []).filter((r) => r.status === "ACCEPTED");
  const orders = raw.orders || [];

  const registered = users.filter((u) => !u.is_anonymous);
  const kpi = {
    accounts: registered.length,
    guests: users.length - registered.length,
    newAccounts30: registered.filter((u) => t(u.created_at) >= since(30)).length,
    activeLost: reports.filter((r) => r.type === "LOST" && r.status === "ACTIVE").length,
    activeFound: reports.filter((r) => r.type === "FOUND" && r.status === "ACTIVE").length,
    returned: resolutions.filter((r) => r.context_type === "MATCH").length,
    returned30: resolutions.filter((r) => r.context_type === "MATCH" && t(r.responded_at) >= since(30)).length,
    viaSighting: resolutions.filter((r) => r.context_type === "OBSERVATION").length,
  };

  // Match rate: lost cases from the last 90 days with at least one match.
  const matchedLost = new Set((raw.matches || []).map((m) => m.lost_id));
  const recentLost = reports.filter((r) => r.type === "LOST" && t(r.created_at) >= since(90));
  kpi.matchRate90 = recentLost.length ? Math.round((100 * recentLost.filter((r) => matchedLost.has(r.id)).length) / recentLost.length) : null;
  kpi.recentLost90 = recentLost.length;

  // Weekly series, oldest first.
  const first = weekStart(now) - (WEEKS - 1) * 7 * DAY;
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: first + i * 7 * DAY, accounts: 0, lost: 0, found: 0, returned: 0 }));
  const bump = (ts, key) => {
    if (!(ts >= first)) return;
    const i = Math.floor((weekStart(ts) - first) / (7 * DAY));
    if (i >= 0 && i < WEEKS) weeks[i][key] += 1;
  };
  registered.forEach((u) => bump(t(u.created_at), "accounts"));
  reports.forEach((r) => bump(t(r.created_at), r.type === "LOST" ? "lost" : "found"));
  resolutions.filter((r) => r.context_type === "MATCH").forEach((r) => bump(t(r.responded_at), "returned"));

  // Revenue per product (paid and not refunded), plus refunds.
  const byProduct = new Map();
  let revenue = 0;
  let revenue30 = 0;
  let refunds = 0;
  for (const o of orders) {
    if (o.status === "REFUNDED" || o.refunded_at) { refunds += 1; continue; }
    if (!PAID.has(o.status)) continue;
    const kr = (o.amount_ore || 0) / 100;
    revenue += kr;
    if (t(o.paid_at || o.created_at) >= since(30)) revenue30 += kr;
    const p = byProduct.get(o.product_code) || { product: o.product_code, count: 0, kr: 0 };
    p.count += 1;
    p.kr += kr;
    byProduct.set(o.product_code, p);
  }
  const products = [...byProduct.values()].sort((a, b) => b.kr - a.kr);

  // Map cells.
  const cells = new Map();
  for (const r of reports) {
    if (typeof r.lat !== "number" || typeof r.lng !== "number") continue;
    const k = cellKey(r.lat, r.lng);
    const c = cells.get(k) || { lat: 0, lng: 0, count: 0, towns: new Map() };
    c.lat += r.lat;
    c.lng += r.lng;
    c.count += 1;
    const town = townFromLabel(r.location_label);
    if (town) c.towns.set(town, (c.towns.get(town) || 0) + 1);
    cells.set(k, c);
  }
  let hiddenCases = 0;
  const areas = [];
  for (const c of cells.values()) {
    if (c.count < minCell) { hiddenCases += c.count; continue; }
    const town = [...c.towns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Ukjent sted";
    // Centre rounded to the cell grid, never an exact case position.
    areas.push({ town, count: c.count, lat: Math.round((c.lat / c.count) / LAT_STEP) * LAT_STEP, lng: Math.round((c.lng / c.count) / LNG_STEP) * LNG_STEP });
  }
  // Visible cells with the same town are added together for the list.
  const byTown = new Map();
  for (const a of areas) byTown.set(a.town, (byTown.get(a.town) || 0) + a.count);
  const towns = [...byTown.entries()].map(([town, count]) => ({ town, count })).sort((a, b) => b.count - a.count);
  areas.sort((a, b) => b.count - a.count);

  return { generatedAt: new Date(now).toISOString(), kpi, weeks, products, revenue, revenue30, refunds, areas, towns, hiddenCases, minCell };
}

const PRODUCT_NAMES = [
  ["REPORT_REACTIVATION", "Forlengelse"],
  ["LONG_TERM_WATCH", "Historisk sak"],
  ["GEO_ALERT_TIER_", "Områdevarsel"],
  ["AREA_VISIBILITY_TIER_", "Synlig i nærheten"],
];
const productName = (code) => (PRODUCT_NAMES.find(([p]) => String(code || "").startsWith(p)) || [null, String(code || "")])[1];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (n) => new Intl.NumberFormat("nb-NO").format(Math.round(n));
const dLabel = (ms) => { const d = new Date(ms); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`; };

function lineChart(weeks, series, { w = 640, h = 220 } = {}) {
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const max = Math.max(1, ...weeks.flatMap((wk) => series.map((s) => wk[s.key])));
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / (weeks.length - 1);
  const y = (v) => h - pad.b - (v * (h - pad.t - pad.b)) / max;
  const ticks = [0, Math.ceil(max / 2), max];
  let g = ticks.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join("");
  g += weeks.map((wk, i) => (i % 2 === 0 ? `<text x="${x(i)}" y="${h - 8}" class="axis" text-anchor="middle">${dLabel(wk.start)}</text>` : "")).join("");
  for (const s of series) {
    const pts = weeks.map((wk, i) => `${x(i)},${y(wk[s.key])}`).join(" ");
    g += `<polyline points="${pts}" fill="none" stroke="var(${s.color})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += weeks.map((wk, i) => `<circle cx="${x(i)}" cy="${y(wk[s.key])}" r="4" fill="var(${s.color})" stroke="var(--surface)" stroke-width="2"><title>${esc(s.label)}, uke fra ${dLabel(wk.start)}: ${wk[s.key]}</title></circle>`).join("");
  }
  const legend = series.map((s) => `<span class="key"><i style="background:var(${s.color})"></i>${esc(s.label)}</span>`).join("");
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.label).join(", "))} per uke">${g}</svg>`;
}

function townBars(towns) {
  const top = towns.slice(0, 12);
  const max = Math.max(1, ...top.map((t) => t.count));
  const rowH = 28, w = 320, labelW = 110, numW = 36;
  const h = Math.max(rowH, top.length * rowH);
  const bars = top.map((t, i) => {
    const bw = Math.max(4, ((w - labelW - numW) * t.count) / max);
    const y = i * rowH + 6;
    return `<text x="0" y="${y + 12}" class="label">${esc(t.town)}</text><rect x="${labelW}" y="${y}" width="${bw.toFixed(1)}" height="16" rx="4" fill="var(--s1)"><title>${esc(t.town)}: ${t.count} saker</title></rect><text x="${(labelW + bw + 6).toFixed(1)}" y="${y + 12}" class="axis">${t.count}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Saker per sted">${bars}</svg>`;
}

function renderStatsHtml(s) {
  const k = s.kpi;
  const tiles = [
    ["Kontoer", nf(k.accounts), `${nf(k.newAccounts30)} nye siste 30 dager · ${nf(k.guests)} gjester`],
    ["Aktive saker", nf(k.activeLost + k.activeFound), `${nf(k.activeLost)} mistet · ${nf(k.activeFound)} funnet`],
    ["Levert tilbake", nf(k.returned), `${nf(k.returned30)} siste 30 dager · ${nf(k.viaSighting)} via observasjon`],
    ["Treffrate", k.matchRate90 === null ? "–" : `${k.matchRate90} %`, `av ${nf(k.recentLost90)} mistet-saker siste 90 dager`],
    ["Inntekt", `${nf(s.revenue)} kr`, `${nf(s.revenue30)} kr siste 30 dager · ${nf(s.refunds)} refundert`],
  ].map(([a, b, c]) => `<div class="tile"><span class="tl">${a}</span><span class="tv">${b}</span><span class="ts">${c}</span></div>`).join("");
  const prodRows = s.products.length
    ? s.products.map((p) => `<tr><td>${esc(productName(p.product))} <span class="code">${esc(p.product)}</span></td><td class="n">${nf(p.count)}</td><td class="n">${nf(p.kr)} kr</td></tr>`).join("")
    : `<tr><td colspan="3">Ingen kjøp ennå.</td></tr>`;
  const placeBlock = s.towns.length ? townBars(s.towns) : `<p class="note">Ingen steder med ${s.minCell} saker eller flere ennå.</p>`;
  const weekRows = s.weeks.map((w) => `<tr><td>${dLabel(w.start)}</td><td class="n">${w.accounts}</td><td class="n">${w.lost}</td><td class="n">${w.found}</td><td class="n">${w.returned}</td></tr>`).join("");
  return `<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lost or Found – statistikk ${esc(s.generatedAt.slice(0, 10))}</title>
<style>
:root{color-scheme:light;--bg:#F7F8FA;--surface:#FFFFFF;--text:#0F172A;--muted:#475569;--border:#E5E7EB;--grid:#EEF0F3;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a}
@media (prefers-color-scheme: dark){:root{color-scheme:dark;--bg:#0B1120;--surface:#111827;--text:#E5E7EB;--muted:#9CA3AF;--border:#1F2937;--grid:#1F2937;--s1:#3987e5;--s2:#d95926;--s3:#199e70}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 48px;display:flex;flex-direction:column;gap:20px}
h1{font-size:26px;margin:0}h2{font-size:17px;margin:0 0 10px}.sub{color:var(--muted);margin:2px 0 0;font-size:14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.tile,.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.tile{display:flex;flex-direction:column;gap:2px}.tl{font-size:13px;font-weight:700;color:var(--muted)}.tv{font-size:30px;font-weight:800;letter-spacing:-0.02em}.ts{font-size:13px;color:var(--muted)}
.grid2{display:grid;grid-template-columns:2fr 1fr;gap:12px;align-items:start}@media (max-width:760px){.grid2{grid-template-columns:1fr}}
svg{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.axis{fill:var(--muted);font-size:11px}.label{fill:var(--text);font-size:12px;font-weight:700}
.code{color:var(--muted);font-size:12px}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 6px;font-size:13px;color:var(--muted)}.key{display:flex;align-items:center;gap:6px}.key i{width:10px;height:10px;border-radius:3px;display:inline-block}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:700}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
details summary{cursor:pointer;color:var(--muted);font-weight:700;margin-top:8px}.note{font-size:13px;color:var(--muted)}
</style></head><body><main>
<div><h1>Lost or Found – statistikk</h1><p class="sub">Laget ${esc(s.generatedAt.slice(0, 16).replace("T", " "))} UTC. Bare tall, ingen personer. Inntekt er brutto fra kjøpene i databasen, før Apples og Googles andel og mva. RevenueCat er fasiten.</p></div>
<div class="tiles">${tiles}</div>
<div class="grid2">
<div class="card"><h2>Nye saker per uke</h2>${lineChart(s.weeks, [{ key: "lost", label: "Mistet", color: "--s1" }, { key: "found", label: "Funnet", color: "--s2" }, { key: "returned", label: "Levert tilbake", color: "--s3" }])}
<details><summary>Vis som tabell</summary><table><tr><th>Uke fra</th><th class="n">Nye kontoer</th><th class="n">Mistet</th><th class="n">Funnet</th><th class="n">Levert</th></tr>${weekRows}</table></details></div>
<div class="card"><h2>Nye kontoer per uke</h2>${lineChart(s.weeks, [{ key: "accounts", label: "Nye kontoer", color: "--s1" }], { w: 320, h: 220 })}</div>
</div>
<div class="grid2">
<div class="card"><h2>Kjøp per tjeneste</h2><table><tr><th>Tjeneste</th><th class="n">Antall</th><th class="n">Beløp</th></tr>${prodRows}</table></div>
<div class="card"><h2>Hvor sakene er</h2>${placeBlock}<p class="note">Telt i ruter på omtrent 5 × 5 km og samlet per sted. ${nf(s.hiddenCases)} saker ligger i ruter med færre enn ${s.minCell} og er ikke med.</p></div>
</div>
</main></body></html>
`;
}

module.exports = { buildStats, renderStatsHtml, townFromLabel, weekStart, MIN_CELL };
