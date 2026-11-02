"use strict";
const fs = require("fs");
const source = fs.readFileSync("app/alert-areas.tsx", "utf8");
// T1.9W: the collapsible map panel became a fixed map card above the lists; the intent (the map
// stays visible next to the settings) is checked through the map card style.
const required = [
  "mapCard: {",
  "statusBoxActive: {",
  "statusBoxBusy: {",
  "statusBoxOff: {",
];
for (const value of required) {
  if (!source.includes(value)) throw new Error(`Missing style definition: ${value}`);
}
console.log("OK: T1.8E.4.1.1 style definitions are present.");
