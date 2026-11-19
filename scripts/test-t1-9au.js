// scripts/test-t1-9au.js
// T1.9AU: map fixes from the first TestFlight test (19.11.2026).
//   node .\scripts\test-t1-9au.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const map = fs.readFileSync(path.join(root, "app/(report)/map.tsx"), "utf8");
const form = fs.readFileSync(path.join(root, "app/(report)/register.tsx"), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// 1. My location and the address search keep the chosen tab: only a place gets a pin.
ok(/const drawingShape = selectedArea \? selectedArea\.kind !== "CIRCLE" : mode !== "CIRCLE";/.test(map), "route or area is detected");
ok(/if \(isFound\) \{\s*setFoundPin\(point\);\s*\} else if \(drawingShape\) \{/.test(map), "route or area: the map only moves");
ok(/mapRef\.current\?\.animateToRegion\(\{ \.\.\.point, latitudeDelta: 0\.02, longitudeDelta: 0\.02 \}, 250\);\s*\};/.test(map), "the map still moves to the point");
ok((map.match(/showsUserLocation=\{showUser\}/g) || []).length === 2, "blue dot on both maps after my location");
ok(/setShowUser\(true\);\s*placePoint\(point\);/.test(map), "dot switched on by my location");

// 2. The small preview map zooms to the chosen place.
ok(/function PreviewMap\(/.test(form) && /onMapReady=\{\(\) => ref\.current\?\.animateToRegion\(region, 0\)\}/.test(form), "preview moves itself once ready");
ok(/key=\{`\$\{region\.latitude\},\$\{region\.longitude\},\$\{region\.latitudeDelta\}`\}/.test(form), "preview mounts anew for a new region");
ok(!/region=\{\{ latitude: lat, longitude: lng, latitudeDelta: 0\.02/.test(form), "no controlled region prop left on the preview");
ok(/previewDelta\(draft\.location\?\.radiusMeters\)/.test(form), "preview span follows the search radius");

console.log(`T1.9AU OK (${n} checks)`);
