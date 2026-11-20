// scripts/test-t1-9aw.js
// T1.9AW: all photos analysed together (brand and size from a label photo) and an optional size.
//   node .\scripts\test-t1-9aw.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const lib = require(path.join(root, "server/lib/imageAnalysis.js"));
const { normalizeItemSize } = require(path.join(root, "server/lib/reportItemSize.js"));
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

async function main() {
  // 1. Several photos in one request; the old single-photo body still works.
  const jpeg = "/9j/" + "A".repeat(400);
  eq(lib.requestImages({ images: [jpeg, jpeg] }).length, 2, "two photos accepted");
  eq(lib.requestImages({ image: jpeg }).length, 1, "older builds send one photo");
  assert.throws(() => lib.requestImages({ images: [jpeg, jpeg, jpeg, jpeg] }), /TOO_MANY_IMAGES/); n++;
  assert.throws(() => lib.requestImages({ images: [] }), /IMAGE_INVALID/); n++;
  assert.throws(() => lib.requestImages({ images: [jpeg, "not-a-jpeg"] }), /IMAGE_INVALID/); n++;
  const big = "/9j/" + "A".repeat(Math.ceil((lib.MAX_IMAGE_BYTES - 1000) * 4 / 3 / 4) * 4);
  assert.throws(() => lib.requestImages({ images: [big, big] }), /IMAGE_TOO_LARGE/); n++;

  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"category":"CLOTHING_ACCESSORIES","item":"FLEECE_JACKET","colors":["green"],"brand":"Bergans","size":"M","confidence":"high","alternatives":[]}' }], usage: {} }) };
  };
  const answer = await lib.askModel([jpeg, jpeg], { env: { ANTHROPIC_API_KEY: "x" }, fetchImpl });
  const content = sent.messages[0].content;
  eq(content.filter((c) => c.type === "image").length, 2, "both photos sent to the model");
  ok(content.some((c) => c.type === "text" && c.text === "Photo 2:"), "photos are numbered");
  ok(/same item/.test(content[content.length - 1].text), "model told the photos show one item");
  const v = lib.validateSuggestion(answer.raw);
  eq([v.brand, v.size], ["Bergans", "M"], "brand and size from the label");
  eq(lib.validateSuggestion({ category: "PETS", item: "CAT", size: "L", confidence: "high" }).size, null, "animals have no size");
  eq(lib.validateSuggestion({ item: "SHOES", size: "  EU   42 ", confidence: "high" }).size, "EU 42", "size cleaned");
  const prompt = lib.systemPrompt();
  ok(/"size":"<size or null>"/.test(prompt) && /size tag/.test(prompt), "prompt asks for a size from a label");
  ok(/Brand and size labels sewn or printed/.test(prompt) && /Never copy names, addresses, phone numbers/.test(prompt), "labels allowed, personal details not");
  ok(/Never read out or repeat text from cards, IDs, passports/.test(prompt), "documents still off limits");

  const route = read("server/routes/imageAnalysis.js");
  ok(/images = analysis\.requestImages\(req\.body\)/.test(route) && /askModel\(images\)/.test(route), "route sends all photos");

  // 2. Size on the report.
  eq(normalizeItemSize("CLOTHING_ACCESSORIES", "FLEECE_JACKET", "  M  "), "M", "size kept");
  eq(normalizeItemSize("PETS", "DOG", "L"), null, "never for animals");
  eq(normalizeItemSize("JEWELRY", "RING", "x".repeat(40)).length, 30, "30 characters at most");
  eq(normalizeItemSize("BAGS_LUGGAGE", "BACKPACK", "   "), null, "empty becomes null");
  const mig = read("supabase/migrations/20261120100000_t1_9aw_item_size.sql");
  ok(/add column if not exists item_size text/.test(mig) && /char_length\(item_size\) between 1 and 30/.test(mig), "migration is repeatable with a length check");
  const reports = read("server/routes/reports.js");
  ok(/\.\.\.\(itemSize \? \{ item_size: itemSize \} : \{\}\)/.test(reports), "create sends the size only when set");
  ok(/if \("item_size" in input\) patch\.item_size = /.test(reports), "size can be edited");
  ok(/a case that is \(or becomes\) an animal has no size/.test(reports), "an animal drops the size on edit");
  ok((read("server/routes/matches.js").match(/brand, item_size,/g) || []).length === 2, "match comparison gets both sizes");
  ok(!/item_size/.test(read("server/routes/share.js")), "size is not on the public share page");

  // 3. App.
  const form = read("app/(report)/register.tsx");
  ok(/void runPhotoAnalysis\(next, !!draft\.subcategoryKey\);/.test(form), "every added photo sends all photos");
  ok(/const applyPhotoExtras = \(\) =>/.test(form) && /t\("register\.photo\.extrasLabel"\)/.test(form), "new details come on their own card");
  ok(/if \(photoExtras\.size && !String\(draft\.itemSize \|\| ""\)\.trim\(\)\)/.test(form), "extras only fill empty fields");
  ok(/\{!animal && \(\s*<View style=\{s\.field\}>\s*<Text style=\{s\.label\}>\s*\{t\("register\.details\.size"\)\}/.test(form), "size field hidden for animals");
  ok(/showsLetterSizes\(draft\.category, draft\.subcategoryKey\)/.test(form), "quick sizes for clothes");
  const helper = read("src/lib/imageAnalysis.ts");
  ok(/body: JSON\.stringify\(\{ images \}\)/.test(helper) && /size: typeof s\.size === "string"/.test(helper), "app sends photos and reads size");
  const rf = read("src/lib/registerForm.ts");
  ok(/item_size: isAnimal\(draft\.category, draft\.subcategoryKey\) \? undefined : itemSizeText\(draft\.itemSize\) \|\| undefined/.test(rf), "size in the report body");
  ok(/Row label=\{t\("caseDetail\.size"\)\} value=\{r\.item_size\}/.test(read("app/report-details/[id].tsx")), "size on the case");
  ok(/labelKey: "matchDetail\.compare\.size"/.test(read("app/matches/[matchId].tsx")) && /mark: same \? "good" : "unknown"/.test(read("app/matches/[matchId].tsx")), "size compared, a difference stays neutral");
  ok(/itemSize: r\.item_size \|\| ""/.test(rf) && /if \(!animal && body\.item_size === undefined\) body\.item_size = null;/.test(rf), "edit keeps (or clears) the size");

  console.log(`T1.9AW OK (${n} checks)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
