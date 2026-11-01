"use strict";
// T1.9O: one tap confirms a match, clearer text for the finder, a closed chat shows no prompts.
//   node .\scripts\test-t1-9o.js
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

const match = read("app/matches/[matchId].tsx");
ok(/label=\{t\("matchDetail\.confirm\.match"\)\} onPress=\{\(\) => void setStatus\("CONFIRMED"\)\}/.test(match), "Bekreft treff confirms with one tap");
ok(!/sheet === "confirm"/.test(match), "no second confirmation sheet");
ok(/visible=\{sheet === "dismiss"\}/.test(match), "Ikke min still asks first");
const chat = read("app/chat/[matchId].tsx");
ok(/else if \(match && !safety\.state\.closed\)/.test(chat), "no Merk som løst in a closed chat");
ok(/safety\.state\.closed \? null : \(/.test(chat), "no 'write the first message' in a closed chat");
const no = read("src/i18n/locales/no.ts");
ok(/"matchDetail\.waiting\.for\.approval\.from\.the\.owner":\s*"Du kan ikke skrive til eieren ennå"/.test(no), "finder is told chat waits for the owner");

console.log(`OK: T1.9O checks passed (${n} assertions).`);
