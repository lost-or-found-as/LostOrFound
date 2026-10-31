"use strict";
// T1.9L behavior test: per-user limits, request flood guard, photo metadata removal and
// error codes in test builds.
//   node .\scripts\test-t1-9l.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { requireTs } = require("./lib/ts-modules");

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

// 1. Photo metadata.
const { stripJpegMetadata } = require(path.join(root, "server", "lib", "jpegMetadata.js"));
const seg = (marker, payload) => {
  const b = Buffer.alloc(4 + payload.length);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(payload.length + 2, 2);
  Buffer.from(payload).copy(b, 4);
  return b;
};
const scan = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x10, 0x20, 0xff, 0xd9]);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, "JFIF\0"),
  seg(0xe1, "Exif\0\0GPS 59.91 10.75"),
  seg(0xe1, "http://ns.adobe.com/xap/1.0/ XMP"),
  seg(0xe2, "ICC_PROFILE"),
  seg(0xed, "Photoshop IPTC"),
  seg(0xfe, "camera comment"),
  seg(0xdb, "quant"),
  scan,
]);
const stripped = stripJpegMetadata(jpeg);
eq(stripped.removed, 4, "EXIF, XMP, IPTC and comment removed");
ok(!stripped.buffer.includes("GPS") && !stripped.buffer.includes("XMP") && !stripped.buffer.includes("comment"), "no GPS or metadata left");
ok(stripped.buffer.includes("JFIF") && stripped.buffer.includes("ICC_PROFILE") && stripped.buffer.includes("quant"), "image structure and colour profile kept");
ok(stripped.buffer.subarray(-scan.length).equals(scan), "image data untouched");
const clean = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, "JFIF\0"), scan]);
eq(stripJpegMetadata(clean).removed, 0, "clean photo unchanged");
eq(stripJpegMetadata(Buffer.from("not an image")).isJpeg, false, "other files left alone");
const broken = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x00])]);
ok(stripJpegMetadata(broken).buffer.equals(broken), "a damaged file is never cut");
const images = read("src/lib/images.ts");
ok(/manipulateAsync\(uri,\[\{resize:\{width:1600\}\}\],\{compress:\.82,format:ImageManipulator\.SaveFormat\.JPEG\}\)/.test(images), "app re-encodes every photo (drops metadata)");
ok(!/exif\s*:\s*true/.test(images), "app never asks the picker for EXIF");
const imageRoute = read("server/routes/reportImages.js");
ok(/await stripStoredImageMetadata\(path, reportId\);[\s\S]*supaAdmin\.from\("report_images"\)\.insert/.test(imageRoute), "server removes metadata before the photo is registered");

// 2. Limits.
const rl = require(path.join(root, "server", "lib", "rateLimits.js"));
eq([rl.limitFor("foundReports", false), rl.limitFor("foundReports", true)], [5, 2], "found reports: 5 per day, guests 2");
eq([rl.limitFor("messagesPerMinute", false), rl.limitFor("messagesPerDay", false), rl.limitFor("observations", false)], [30, 500, 20], "chat and observation limits");

function fakeDb(count) {
  const calls = [];
  const q = {
    select: () => q,
    eq: (k, v) => (calls.push(["eq", k, v]), q),
    gte: (k, v) => (calls.push(["gte", k, v]), q),
    then: (resolve) => resolve({ count, error: null }),
  };
  return { calls, from: (t) => (calls.push(["from", t]), q) };
}
(async () => {
  const NOW = Date.parse("2026-10-31T12:00:00Z");
  const db = fakeDb(4);
  const r1 = await rl.checkLimit(db, { name: "foundReports", table: "report_creation_events", column: "user_id", userId: "u1", filters: { report_type: "FOUND" }, now: NOW });
  eq([r1.allowed, r1.used, r1.limit], [true, 4, 5], "4 of 5 used: allowed");
  ok(db.calls.some((c) => c[1] === "report_type" && c[2] === "FOUND") && db.calls.some((c) => c[0] === "gte" && c[2] === "2026-10-30T12:00:00.000Z"), "counts found reports in the last 24 hours");
  const r2 = await rl.checkLimit(fakeDb(2), { name: "foundReports", table: "report_creation_events", column: "user_id", userId: "g", isGuest: true, now: NOW });
  eq(rl.limitResponse(r2), { error: "FOUND_REPORT_DAILY_LIMIT", limit: 2, used: 2 }, "guest at 2: refused with a code");

  const guard = rl.ipRateLimit({ windowMs: 60000, max: 3 });
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const res = { setHeader() {}, status(code) { statuses.push(code); return { json() {} }; } };
    guard({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: {} }, res, () => statuses.push(200));
  }
  guard({ headers: { "x-forwarded-for": "5.6.7.8" }, socket: {} }, { setHeader() {}, status: () => ({ json() {} }) }, () => statuses.push("other"));
  eq(statuses, [200, 200, 200, 429, "other"], "flood guard per address");

  // 3. Wiring.
  const reports = read("server/routes/reports.js");
  ok(/name: "foundReports",[\s\S]{0,200}filters: \{ report_type: "FOUND" \}/.test(reports) && /isGuest: isAnonymousUser\(user\)/.test(reports), "found report limit in create");
  ok(/for \(const name of \["messagesPerMinute", "messagesPerDay"\]\)/.test(read("server/routes/matches.js")), "chat limits");
  ok(/checkLimit\(supaAdmin,\{name:"observations"/.test(read("server/routes/observations.js")), "observation limit");
  ok(/app\.use\(ipRateLimit\(\{ windowMs: 60 \* 1000, max: 300 \}\)\)/.test(read("server/index.js")), "flood guard on all routes");

  // 4. App texts and test-build codes.
  const ue = requireTs(path.join(root, "src/lib/userError.ts"), { "./sentry": { reportHandledError: () => {} } });
  eq(ue.withTestCode("Kunne ikke lagre saken.", "INVALID_CUSTODY", true), "Kunne ikke lagre saken.\n(INVALID_CUSTODY)", "code shown in test builds");
  eq(ue.withTestCode("Kunne ikke lagre saken.", "INVALID_CUSTODY", false), "Kunne ikke lagre saken.", "no code in store builds");
  eq(ue.withTestCode("x", "Could not find the 'custody' column", true), "x", "raw server text is never shown");
  for (const code of ["FOUND_REPORT_DAILY_LIMIT", "MESSAGE_RATE_LIMIT", "OBSERVATION_DAILY_LIMIT", "TOO_MANY_REQUESTS"])
    ok(ue.knownErrorKey({ code }) != null, `text for ${code}`);

  console.log(`OK: T1.9L checks passed (${n} assertions).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
