#!/usr/bin/env node
"use strict";
// T1.9AY: admin tasks for reported cases and bonus checks, until the admin screen in the app has
// them. Run from the repository folder with the database URL and service key set for this run only:
//   node server/scripts/content-admin.js list                  reported and hidden cases
//   node server/scripts/content-admin.js restore <reportId>    show a hidden case again
//   node server/scripts/content-admin.js hide <reportId>       hide a case by hand
//   node server/scripts/content-admin.js bonus-flags           accounts whose bonus looks arranged
//   node server/scripts/content-admin.js revoke-bonus <ledgerId>
// Prints ids, reasons and short texts only; no e-mail addresses or names.
const { createClient } = require("@supabase/supabase-js");
const contentReports = require("../lib/contentReports");
const { bonusFlags, revokeBonus } = require("../lib/helperBonus");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
  const [cmd, id] = process.argv.slice(2);
  const supa = createClient(url, key, { auth: { persistSession: false } });
  if (cmd === "list") {
    const items = await contentReports.listReported(supa);
    if (!items.length) return console.log("NO_OPEN_REPORTS");
    for (const it of items) {
      const r = it.report || {};
      console.log(`${it.reportId}  ${r.hidden_at ? `HIDDEN(${r.hidden_reason})` : "VISIBLE"}  ${it.reports.length} report(s): ${[...new Set(it.reports.map((x) => x.reason))].join(", ")}`);
      console.log(`  ${String(r.title || "").slice(0, 80)} | ${String(r.description || "").slice(0, 120)}`);
    }
    return;
  }
  if (cmd === "restore" && id) {
    await contentReports.restoreReport(supa, id);
    return console.log(`RESTORED ${id}`);
  }
  if (cmd === "hide" && id) {
    const row = await contentReports.hideReport(supa, id, "ADMIN");
    if (row) await contentReports.revokePendingBonus(supa, id);
    return console.log(row ? `HIDDEN ${id}` : `ALREADY_HIDDEN_OR_MISSING ${id}`);
  }
  if (cmd === "bonus-flags") {
    const flags = await bonusFlags({ supa });
    if (!flags.length) return console.log("NO_FLAGS");
    for (const f of flags) {
      console.log(`${f.userId}  ${f.reasons.join(",")}  ${f.points} bonus from ${f.partners} account(s)`);
      for (const r of f.rows) console.log(`  ${r.id}  ${r.event} +${r.points} ${r.status} ${r.at.slice(0, 10)}`);
    }
    return;
  }
  if (cmd === "revoke-bonus" && id) {
    return console.log((await revokeBonus({ supa, ledgerId: id, reason: "ADMIN" })) ? `REVOKED ${id}` : `NOT_CHANGED ${id}`);
  }
  console.log("Usage: list | restore <reportId> | hide <reportId> | bonus-flags | revoke-bonus <ledgerId>");
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exitCode = 1;
});
