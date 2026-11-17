#!/usr/bin/env node
"use strict";
// T1.9AQ: deletes one account on request by e-mail (lostorfound.app/slett-konto), the same way
// as Profil → Slett konto in the app. Run from the repository folder with the database's URL and
// service key in the environment (set for this run only, as for privacy-export.js):
//   node server/scripts/delete-account.js --email someone@example.com [--case 2026-002]           (dry run)
//   node server/scripts/delete-account.js --email someone@example.com [--case 2026-002] --confirm (deletes)
// Only delete when the request came from the e-mail address the account is registered with.
const { createClient } = require("@supabase/supabase-js");
const { deleteAccount, ownedReports, findAccount } = require("../lib/accountDeletion");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  const email = arg("email");
  const userId = arg("user");
  const caseRef = arg("case") || null;
  const confirm = has("confirm");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
  if (!email && !userId) throw new Error("Give --email or --user");

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const user = await findAccount(supa, { email, userId });
  if (!user) {
    console.log("NO_ACCOUNT: no account with that e-mail or id");
    process.exitCode = 2;
    return;
  }
  const reports = await ownedReports(supa, user.id);
  console.log(`ACCOUNT: ${user.id} (${user.email || "no e-mail"}), created ${user.created_at}, ${reports.length} case(s)`);
  if (!confirm) {
    console.log("DRY_RUN: nothing deleted. Run again with --confirm to delete.");
    return;
  }

  // The same deletion as the app. reports.js reads the same environment for its own client.
  const { deleteOwnedReport } = require("../routes/reports");
  const { deletedReports } = await deleteAccount(user.id, { supa, deleteOwnedReport, log: console });

  await supa.from("admin_access_audit").insert({
    admin_user_id: null,
    action: "DELETE_USER_ACCOUNT",
    entity_type: "user",
    entity_id: user.id,
    reason: "Account deletion requested by e-mail",
    case_reference: caseRef,
    metadata: { deletedReports },
  });
  console.log(`OK: account ${user.id} deleted with ${deletedReports} case(s). Reply to the person that it is done.`);
}

main().catch((e) => {
  console.error("DELETE_FAILED:", e?.message || String(e));
  process.exitCode = 1;
});
