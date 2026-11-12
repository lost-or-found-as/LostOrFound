"use strict";
// T1.9Y: writes server/data/itemCatalog.json from the app catalog (src/i18n/catalog.ts), so the
// server can name items, categories and colours in the recipient's language (push texts).
// Run after changing the catalog:   node .\scripts\build-server-catalog.js
// scripts/test-t1-9y.js fails when the JSON is out of date.
const fs = require("fs");
const path = require("path");
const { requireTs } = require("./lib/ts-modules");
const { SUPPORTED_LANGUAGES } = require("../server/lib/languages");

const root = path.resolve(__dirname, "..");
const OUT = path.join(root, "server", "data", "itemCatalog.json");

function buildServerCatalog() {
  const c = requireTs(path.join(root, "src/i18n/catalog.ts"));
  const names = (e) => Object.fromEntries(SUPPORTED_LANGUAGES.filter((l) => e.names[l]).map((l) => [l, e.names[l]]));
  const items = {};
  for (const list of Object.values(c.ITEM_CATALOG)) for (const e of list) if (!items[e.key]) items[e.key] = names(e);
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  // T1.9AI: which categories each item belongs to (photo analysis checks the pair).
  const itemCategories = {};
  for (const [category, list] of Object.entries(c.ITEM_CATALOG))
    for (const e of list) (itemCategories[e.key] = itemCategories[e.key] || []).includes(category) || itemCategories[e.key].push(category);
  return {
    categories: sorted(Object.fromEntries(c.CATEGORY_CATALOG.map((e) => [e.key, names(e)]))),
    items: sorted(items),
    itemCategories: sorted(itemCategories),
    colors: sorted(Object.fromEntries(c.COLOR_CATALOG.map((e) => [e.key, names(e)]))),
  };
}

module.exports = { buildServerCatalog, OUT };

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(buildServerCatalog(), null, 1) + "\n");
  console.log(`Wrote ${path.relative(root, OUT)}`);
}
