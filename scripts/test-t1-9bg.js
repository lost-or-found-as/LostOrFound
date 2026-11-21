// scripts/test-t1-9bg.js
// T1.9BG: an area alert covers up to three places (place, route, area) drawn on the same map as
// at registration; the price follows the joined area; bonus says it must cover the whole price.
//   node .\scripts\test-t1-9bg.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const throwsCode = (fn, code, msg) => { let c = null; try { fn(); } catch (e) { c = e.code; } eq(c, code, msg); };

// 1. Places are checked and cleaned.
const places = require(path.join(root, "server/lib/alertPlaces.js"));
const pt = (latitude, longitude) => ({ latitude, longitude });
const cleaned = places.normalizeAlertPlaces([
  { kind: "circle", radiusMeters: 50, points: [pt(59.9, 10.7)] },
  { kind: "ROUTE", radiusMeters: 9000, points: [pt(59.9, 10.7), pt(59.91, 10.72)] },
  { kind: "POLYGON", radiusMeters: 300, points: [pt(59.9, 10.7), pt(59.91, 10.7), pt(59.91, 10.71)] },
]);
eq(cleaned.map((p) => [p.kind, p.radiusMeters]), [["CIRCLE", 100], ["ROUTE", 2000], ["POLYGON", null]], "kinds and limits");
throwsCode(() => places.normalizeAlertPlaces([]), "PLACES_REQUIRED", "at least one place");
throwsCode(() => places.normalizeAlertPlaces([1, 2, 3, 4].map(() => ({ kind: "CIRCLE", radiusMeters: 500, points: [pt(59, 10)] }))), "TOO_MANY_PLACES", "at most three");
throwsCode(() => places.normalizeAlertPlaces([{ kind: "ROUTE", radiusMeters: 500, points: [pt(59, 10)] }]), "ROUTE_REQUIRES_TWO_POINTS", "route needs two points");
throwsCode(() => places.normalizeAlertPlaces([{ kind: "POLYGON", points: [pt(59, 10), pt(59, 11)] }]), "POLYGON_REQUIRES_THREE_POINTS", "area needs three points");
throwsCode(() => places.normalizeAlertPlaces([{ kind: "CIRCLE", radiusMeters: 500, points: [pt(99, 10)] }]), "INVALID_PLACE_POINT", "bad point");
eq(places.placesCenter(cleaned), pt(59.9, 10.7), "center is the first point");

// 2. Price by joined area, same limits as the circles.
const p = require(path.join(root, "server/lib/geoAlertPricing.js"));
eq([1, 3.1, 3.2, 28, 28.4, 300].map(p.tierForArea), [1, 1, 2, 2, 3, 3], "tier by area");
const q = p.calculateGeoAlertQuote({ places: cleaned, areaSqKm: 9.4, estimatedEligibleInstallations: 37 }, {});
eq([q.productCode, q.priceSnapshot.version, q.priceSnapshot.places, q.priceSnapshot.radius_m], ["GEO_ALERT_TIER_2", 3, 3, null], "places quote");
eq(p.calculateGeoAlertQuote({ radiusM: 1500, estimatedEligibleInstallations: 5 }, {}).productCode, "GEO_ALERT_TIER_2", "radius quote unchanged");

// 3. Migration.
const sql = read("supabase/migrations/20261121100000_t1_9bg_area_alert_places.sql");
ok(/add column if not exists places jsonb/.test(sql), "places stored on the campaign");
ok(/create or replace function public\.geo_alert_places_geography\(p_places jsonb\)/.test(sql), "joined shape");
ok(/st_union\(g\)/.test(sql) && /st_buffer\(l::geography, r\)/.test(sql), "routes buffered, overlaps joined");
ok(/create or replace function public\.preview_geo_alert_places/.test(sql) && /geo_alert_qualifying_users\(rs\.user_id, s\.g, 0, rs\.category_key\)/.test(sql), "audience from the shape");
ok(/grant execute on function public\.preview_geo_alert_places\(uuid, uuid, jsonb\) to service_role/.test(sql) && /revoke all on function public\.geo_alert_places_ewkt\(jsonb\) from public, anon, authenticated/.test(sql), "server only");
ok(!/drop /i.test(sql), "nothing dropped");

// 4. Routes.
const preview = read("server/routes/geoAlertPreview.js");
ok(/kindRequested !== "VISIBILITY" && Array\.isArray\(req\.body\?\.places\)\) return await previewPlaces/.test(preview), "preview takes places");
ok(/ALERT_AREA_TOO_LARGE/.test(preview), "too large refused");
const commerce = read("server/routes/reportCommerce.js");
ok(/productCode === "GEO_ALERT" && Array\.isArray\(req\.body\?\.geoAlert\?\.places\)/.test(commerce), "order takes places");
ok(/rpc\("geo_alert_places_ewkt", \{ p_places: places \}\)/.test(commerce), "campaign gets the joined shape");
ok(/geometry_type: places \? "POLYGON" : "CIRCLE"/.test(commerce) && /radius_m: places \? null :/.test(commerce), "no radius with places");
ok(/area_sq_km,starts_at/.test(read("server/routes/geoAlertDelivery.js")), "recipient view gets the size");

// 5. App.
const store = read("src/lib/alertPlacesStore.ts");
ok(/export function startPlaces/.test(store) && /export function alertPlacesPayload/.test(store), "store helpers");
const map = read("app/(report)/map.tsx");
ok(/const isAlert = params\.purpose === "alert";/.test(map), "map picker has an alert purpose");
ok(/if \(isAlert\) \{\s*setAlertPlaces\(areas\);\s*router\.back\(\);\s*return;\s*\}/.test(map), "alert places never touch the draft");
const geo = read("app/geo-alert-create.tsx");
ok(/places: alertPlacesPayload\(places\),\s*durationHours/.test(geo), "preview sends places");
ok(/geoAlert: \{\s*places: alertPlacesPayload\(places\)/.test(geo), "order sends places");
ok(/pathname: "\/\(report\)\/map", params: \{ purpose: "alert" \}/.test(geo), "opens the same map");
ok(/startPlaces\(searchAreas, latitude, longitude\)/.test(geo), "starts from the case's search areas");
ok(!/RADII/.test(geo), "radius chips gone");
ok(/t\("areaAlert\.area\.size"\)/.test(read("app/area-alert/[id].tsx")), "recipient sees the size");

// 6. Bonus covers the whole price.
const no = read("src/i18n/locales/no.ts");
ok(/"bonus\.useWhole": "Bonus må dekke hele prisen/.test(no), "whole price said");
ok(/t\("bonus\.useWhole"\)/.test(read("app/bonus.tsx")), "shown on the bonus screen");

console.log(`T1.9BG OK (${n} checks)`);
