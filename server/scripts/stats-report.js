#!/usr/bin/env node
"use strict";
// T1.9AR: writes the owner's statistics report as one HTML file (counts only, no personal data).
// Run from the repository folder with the database's URL and service key in the environment
// (set for this run only, as for privacy-export.js):
//   node server/scripts/stats-report.js --out "C:\RN\LOF dokuments\statistikk"
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { buildStats, renderStatsHtml } = require("../lib/statsReport");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function all(supa, table, columns, filter) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supa.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function allUsers(supa) {
  const users = [];
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch.map((u) => ({ created_at: u.created_at, is_anonymous: !!u.is_anonymous })));
    if (batch.length < 1000) return users;
  }
  return users;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  const outDir = arg("out");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
  if (!outDir) throw new Error("Give --out (a folder outside the repository)");
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut.startsWith(path.resolve(__dirname, "..", ".."))) throw new Error("--out must be outside the repository");

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const [users, reports, matches, resolutions, orders] = await Promise.all([
    allUsers(supa),
    all(supa, "reports", "id,type,status,created_at,deleted_at,lat,lng,location_label"),
    all(supa, "matches", "lost_id"),
    all(supa, "resolution_proposals", "context_type,status,responded_at", (q) => q.eq("status", "ACCEPTED")),
    all(supa, "report_orders", "product_code,status,amount_ore,paid_at,created_at,refunded_at"),
  ]);
  const stats = buildStats({ users, reports, matches, resolutions, orders });
  fs.mkdirSync(resolvedOut, { recursive: true });
  const file = path.join(resolvedOut, `statistikk-${stats.generatedAt.slice(0, 10)}.html`);
  fs.writeFileSync(file, renderStatsHtml(stats), "utf8");

  await supa.from("admin_access_audit").insert({
    admin_user_id: null,
    action: "VIEW_STATS_REPORT",
    entity_type: "report",
    entity_id: null,
    reason: "Owner statistics report (counts only)",
    metadata: { reports: reports.length, users: users.length },
  });
  console.log(`OK: report written to ${file}`);
}

main().catch((e) => {
  console.error("STATS_FAILED:", e?.message || String(e));
  process.exitCode = 1;
});
