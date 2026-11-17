#!/usr/bin/env node
"use strict";
// T1.9AO: writes everything about one account to a JSON file, for an access request.
// Run from the repository folder with the database's URL and service key in the environment
// (the guarded PowerShell block in Personvern i Lost or Found sets them for this run only):
//   node server/scripts/privacy-export.js --email someone@example.com --out "C:\RN\LOF dokuments\innsyn" [--case 2026-001]
// The file is personal data: never put it in git, chat or e-mail other than to the person.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { buildPrivacyExport } = require("../lib/privacyExport");
const { findAccount } = require("../lib/accountDeletion");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  const email = arg("email");
  const userId = arg("user");
  const outDir = arg("out");
  const caseRef = arg("case") || null;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
  if (!email && !userId) throw new Error("Give --email or --user");
  if (!outDir) throw new Error("Give --out (a folder outside the repository)");
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut.startsWith(path.resolve(__dirname, "..", ".."))) throw new Error("--out must be outside the repository");

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const user = await findAccount(supa, { email, userId });
  if (!user) {
    console.log("NO_ACCOUNT: no account with that e-mail or id");
    process.exitCode = 2;
    return;
  }
  const account = {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    providers: user.app_metadata?.providers || [],
  };
  const data = await buildPrivacyExport(supa, account);
  fs.mkdirSync(resolvedOut, { recursive: true });
  const file = path.join(resolvedOut, `innsyn-${new Date().toISOString().slice(0, 10)}-${user.id.slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");

  await supa.from("admin_access_audit").insert({
    admin_user_id: null,
    action: "EXPORT_USER_DATA",
    entity_type: "user",
    entity_id: user.id,
    reason: "Data subject access request",
    case_reference: caseRef,
    metadata: { tables: Object.keys(data.tables).length, problems: data.problems.length },
  });

  const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
  console.log(`OK: ${rows} rows from ${Object.keys(data.tables).length} tables written to ${file}`);
  if (data.problems.length) console.log("PROBLEMS:", JSON.stringify(data.problems));
}

main().catch((e) => {
  console.error("EXPORT_FAILED:", e?.message || String(e));
  process.exitCode = 1;
});
