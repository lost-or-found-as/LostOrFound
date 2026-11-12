"use strict";
// T1.9AC: photos on the cards in "Mine saker", and the observation map opens in the alert area.
//   node .\scripts\test-t1-9ac.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};
const eq = (a, b, label) => {
  assert.deepStrictEqual(a, b, `${label}: got ${JSON.stringify(a)}`);
  n++;
};

(async () => {
  // 1. First image per report, signed in one call per bucket.
  const thumbs = require(path.join(root, "server/lib/reportThumbnails.js"));
  const first = thumbs.firstImagePathByReport([
    { id: 5, report_id: "a", path: "report-images/reports/a/2.jpg", sort_order: 1 },
    { id: 4, report_id: "a", path: "report-images/reports/a/1.jpg", sort_order: 0 },
    { id: 9, report_id: "b", path: "report-images/reports/b/9.jpg", sort_order: 0 },
    { id: 8, report_id: "b", path: "report-images/reports/b/8.jpg", sort_order: 0 },
  ]);
  eq(Object.fromEntries(first), { a: "report-images/reports/a/1.jpg", b: "report-images/reports/b/8.jpg" }, "lowest sort order, then oldest");
  eq(thumbs.splitImagePath("report-images/reports/a/1.jpg"), { bucket: "report-images", objectPath: "reports/a/1.jpg" }, "bucket and object");
  eq(thumbs.splitImagePath("bad"), null, "a path without object is skipped");

  const calls = [];
  const fake = {
    from: () => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: 1, report_id: "a", path: "report-images/reports/a/1.jpg", sort_order: 0 },
            { id: 2, report_id: "c", path: "report-images/reports/c/1.jpg", sort_order: 0 },
          ],
          error: null,
        }),
      }),
    }),
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths, ttl) => {
          calls.push({ bucket, paths, ttl });
          return { data: paths.map((p) => ({ path: p, signedUrl: p === "reports/c/1.jpg" ? null : `https://signed/${p}`, error: null })), error: null };
        },
      }),
    },
  };
  const urls = await thumbs.loadThumbnailUrls(fake, ["a", "b", "c"]);
  eq(Object.fromEntries(urls), { a: "https://signed/reports/a/1.jpg" }, "only reports with a signed photo get a URL");
  eq(calls.length, 1, "one signing call per bucket");
  eq(calls[0].ttl, 3600, "URLs live one hour");
  const broken = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "down" } }) }) }) };
  eq((await thumbs.loadThumbnailUrls(broken, ["a"])).size, 0, "a failure gives no thumbnails, not an error");

  const activity = read("server/routes/reportsActivity.js");
  ok(/rep\.thumbnail_url = thumbnails\.get\(rep\.id\) \|\| null/.test(activity), "my cases list carries thumbnail_url");
  ok(/r\.thumbnail_url \|\| first\?\.signed_url/.test(read("app/my-reports.tsx")), "card shows thumbnail_url");

  // 2. Observation map opens in the alert area, with a rounded point only.
  const delivery = require(path.join(root, "server/lib/roundedPoint.js"));
  eq(delivery.roundedPoint(59.91391, 10.75224), { latitude: 59.91, longitude: 10.75 }, "about 1 km precision");
  eq(delivery.roundedPoint(null, 10), null, "no point without coordinates");
  eq(delivery.roundedPoint(95, 10), null, "invalid latitude");
  const route = read("server/routes/geoAlertDelivery.js");
  ok(/delete report\.lat;/.test(route) && /delete report\.lng;/.test(route), "exact case location is not sent");
  ok(/mapCenter, recipientStatus/.test(route), "view returns mapCenter");
  const screen = read("app/area-alert/[id].tsx");
  ok(/params: \{ campaignId: String\(id \|\| ""\), kind, \.\.\.where \}/.test(screen), "alert passes the point to the observation screen");
  ok(/paramPoint\(params\.latitude, params\.longitude\)/.test(read("app/observation-create.tsx")), "observation screen starts at the passed point");

  console.log(`OK: T1.9AC thumbnails and observation map start passed (${n} assertions).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
