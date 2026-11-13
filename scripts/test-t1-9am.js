// scripts/test-t1-9am.js
// T1.9AM: «Synlig i nærheten» – the case is listed for 7 days in «I nærheten» for people who follow
// the area, without push. Price by how many follow the area; an area alert includes visibility.
//   node .\scripts\test-t1-9am.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: got ${JSON.stringify(a)}`); n++; };

// 1. Pricing by followers.
const vis = require(path.join(root, "server/lib/areaVisibility.js"));
eq([0, 1, 499, 500, 2000, 2001, 50000].map(vis.visibilityTier), [1, 1, 1, 2, 2, 3, 3], "tiers: under 500, 500–2000, over 2000");
const q = vis.calculateVisibilityQuote({ followers: 1234, radiusM: 1000 }, {});
eq([q.productCode, q.kind, q.durationHours, q.pilotFree], ["AREA_VISIBILITY_TIER_2", "VISIBILITY", 168, false], "quote");
eq(q.recipients, { kind: "ABOUT", value: 1230 }, "followers shown as a band");
eq(vis.calculateVisibilityQuote({ followers: 4 }, {}).recipients, { kind: "FEW", value: 10 }, "few followers never exact");
eq(vis.calculateVisibilityQuote({ followers: 10 }, { GEO_ALERT_PILOT_FREE: "true" }).pilotFree, true, "pilot free applies");
ok(vis.isVisibilityProduct("AREA_VISIBILITY_TIER_3") && !vis.isVisibilityProduct("GEO_ALERT_TIER_1"), "product prefix");

// 2. Rules: nothing while a campaign of either kind is live.
const now = Date.parse("2026-11-12T12:00:00Z");
const liveAlert = { kind: "ALERT", status: "ACTIVE", ends_at: "2026-11-15T12:00:00Z" };
const liveVis = { kind: "VISIBILITY", status: "ACTIVE", ends_at: "2026-11-16T12:00:00Z" };
const oldAlert = { kind: "ALERT", status: "ACTIVE", ends_at: "2026-11-01T12:00:00Z" };
eq(vis.visibilityBlockReason([oldAlert], now), null, "an ended alert does not block");
eq(vis.visibilityBlockReason([liveAlert], now)?.error, "AREA_VISIBILITY_ALREADY_ACTIVE", "a live area alert blocks (it includes visibility)");
eq(vis.visibilityBlockReason([liveVis, liveAlert], now)?.activeUntil, "2026-11-16T12:00:00Z", "latest end");
eq(vis.visibilityStatus([liveVis], now), { activeUntil: "2026-11-16T12:00:00Z", viaAreaAlert: false }, "status: bought visibility");
eq(vis.visibilityStatus([liveAlert], now).viaAreaAlert, true, "status: through an area alert");
eq(vis.visibilityStatus([{ ...liveVis, status: "CANCELLED" }], now).activeUntil, null, "cancelled is not live");

// 3. Database: kind column, products, notice title per kind.
const sql = read("supabase/migrations/20261113140000_t1_9am_area_visibility.sql");
ok(/add column if not exists kind text not null default 'ALERT'/.test(sql) && /check \(kind in \('ALERT', 'VISIBILITY'\)\)/.test(sql), "campaign kind");
for (const t of [1, 2, 3]) ok(new RegExp(`'AREA_VISIBILITY_TIER_${t}'`).test(sql) && new RegExp(`'lof_visible_nearby_${t}'`).test(sql), `product and store id tier ${t}`);
ok(/on conflict \(code\) do nothing/.test(sql), "existing prices are kept");
ok(/case when \(select kind from campaign\) = 'VISIBILITY' then 'AREA_VISIBILITY' else 'AREA_ALERT' end/.test(sql), "notice title per kind");
ok(/grant execute on function public\.geo_alert_create_in_app_notifications\(uuid\) to service_role/.test(sql), "function stays server-only");

// 4. Server flow.
const commerce = read("server/routes/reportCommerce.js");
ok(/productCode === VISIBILITY_REQUEST_CODE/.test(commerce), "orders accept AREA_VISIBILITY");
ok(/if \(followers <= 0\) return res\.status\(409\)\.json\(\{ error: AREA_VISIBILITY_NO_FOLLOWERS \}\)/.test(commerce), "nothing is sold when nobody follows the area");
ok(/kind: visibilityOrder \? "VISIBILITY" : "ALERT"/.test(commerce), "campaign stored with its kind");
ok(/dispatchAreaVisibilityCampaign\(order\.created_campaign_id\)/.test(commerce), "visibility dispatch");
ok(/visibilityBlockReason\(await reportCampaigns\(order\.report_id\), now\.getTime\(\)\)/.test(commerce), "rule checked again at activation");
ok(/visibility: visibilityStatus\(campaigns\)/.test(commerce), "status tells the app");
const dispatch = read("server/lib/geoAlertDispatch.js");
const visDispatch = dispatch.slice(dispatch.indexOf("async function dispatchAreaVisibilityCampaign"));
ok(/geo_alert_create_in_app_notifications/.test(visDispatch) && !/expoSend|geo_alert_eligible_installations/.test(visDispatch), "no push for visibility");
ok(/kind === "VISIBILITY"/.test(read("server/routes/geoAlertPreview.js")), "preview prices visibility");
ok(/getAreaAlertAccess\(c,u\)/.test(read("server/routes/observations.js")), "people without push can report a sighting");
ok(/AREA_VISIBILITY_TIER_\*/.test(read("server/routes/resolutions.js")), "resolving a case ends visibility too");
const { buildReportActivity } = require(path.join(root, "server/lib/reportActivity.js"));
const act = buildReportActivity({ report: { id: "r", user_id: "u", type: "LOST", created_at: "2026-11-10T10:00:00Z" }, campaigns: [{ kind: "VISIBILITY", activated_at: "2026-11-11T10:00:00Z", radius_m: 1000 }, { activated_at: "2026-11-12T10:00:00Z" }] });
eq(act.events.map((e) => e.type), ["AREA_ALERT_SENT", "AREA_VISIBILITY", "CREATED"], "timeline tells the kinds apart");

// 5. App.
const offerLib = requireTs(path.join(root, "src/lib/areaVisibility.ts"));
const base = { activeUntil: null, activationCount: 0, maxActivations: 2, remaining: 2, canOrder: true, activations: [] };
eq(offerLib.reachOffer({ ...base, visibility: { activeUntil: null, viaAreaAlert: false } }, now), { visibility: true, alert: true, visibleUntil: null }, "both options");
eq(offerLib.reachOffer({ ...base, visibility: { activeUntil: "2026-11-16T12:00:00Z", viaAreaAlert: false } }, now), { visibility: false, alert: true, visibleUntil: "2026-11-16T12:00:00Z" }, "visible: alert can still be sent");
eq(offerLib.reachOffer({ ...base, activeUntil: "2026-11-15T12:00:00Z", activationCount: 1, visibility: { activeUntil: "2026-11-15T12:00:00Z", viaAreaAlert: true } }, now), { visibility: false, alert: false, visibleUntil: null }, "live area alert: nothing extra");
eq(offerLib.reachOffer({ ...base, activationCount: 1, visibility: { activeUntil: null, viaAreaAlert: false } }, now), { visibility: true, alert: false, visibleUntil: null }, "after an area alert: visibility only here");
eq(offerLib.visibilityNoticeKey("AREA_VISIBILITY_ALREADY_ACTIVE"), "areaVisibility.alreadyTitle", "already-visible heading");
const detail = read("app/report-details/[id].tsx");
ok(/const offer = reachOffer\(geoStatus\)/.test(detail) && /pathname: "\/area-visibility-create"/.test(detail), "case screen offers visibility");
const screen = read("app/area-visibility-create.tsx");
ok(/productCode: "AREA_VISIBILITY"/.test(screen) && /completeReportOrder\(created\.order\)/.test(screen), "order through the store flow");
ok(/kind: "VISIBILITY"/.test(screen) && /disabled=\{!canBuy\}/.test(screen) && /consent &&/.test(screen), "priced preview, consent before buying");
ok(/^export default requireAccount\(AreaVisibilityCreateScreen\);$/m.test(screen), "accounts only");
const notif = read("app/notifications.tsx");
ok(/!== "AREA_VISIBILITY" && \(\s*<Text style=\{styles\.alertedTag\}/.test(notif), "«Varslet» only on area alerts");
ok(/router\.push\("\/alert-areas"\)/.test(notif), "link to alert areas");
ok(/"AREA_VISIBILITY"\)\) return "purchases\.areaVisibility"|startsWith\("AREA_VISIBILITY"\)\) return "purchases\.areaVisibility"/.test(read("src/lib/myPurchases.ts")), "Mine kjøp names it");

// 6. Texts in both languages.
const no = read("src/i18n/locales/no.ts");
const en = read("src/i18n/locales/en.ts");
const keys = [...new Set([...(screen + detail + notif + read("src/lib/areaVisibility.ts")).matchAll(/"((?:areaVisibility|caseDetail\.reach|notifications\.(?:areaVisibilityBody|alertedTag|nearbyFooter|editAlertAreas))[A-Za-z0-9.]*)"/g)].map((m) => m[1]))];
keys.push("caseDetail.activity.areaVisibility", "purchases.areaVisibility");
ok(keys.length >= 25, `texts found (${keys.length})`);
for (const k of keys) ok(no.includes(`"${k}":`) && en.includes(`"${k}":`), `text ${k} in both languages`);

console.log(`OK: T1.9AM «Synlig i nærheten» passed (${n} assertions).`);
