"use strict";
// T1.9A static checks: client access lock-down migration.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "supabase", "migrations");
const MIGRATION = "20261028200000_t1_9a_lock_down_client_access.sql";
const errors = [];
const check = (ok, code) => { if (!ok) errors.push(code); };

const sql = fs.readFileSync(path.join(dir, MIGRATION), "utf8").replace(/--[^\n]*/g, "");

for (const p of [
  "reports_select_all", "reports_insert_self", "reports_update_owner", "profiles_read_all",
  "matches_select_all", "matches_update_owner", "Read items - public", "Insert items - public",
  "Update items - public (temporary)", "report_images_insert", "report_images_delete_own",
  "authenticated can read report-images", "authenticated can update report-images",
  "authenticated can upload report-images",
]) {
  check(sql.includes(`drop policy if exists "${p}"`), `OPEN_POLICY_NOT_DROPPED: ${p}`);
}
check(/revoke execute on function %s from public, anon, authenticated/.test(sql), "FUNCTION_EXECUTE_NOT_REVOKED");
check(/alter default privileges[\s\S]*revoke execute on functions from public, anon, authenticated/.test(sql), "DEFAULT_PRIVILEGES_NOT_SET");
check(/sender_id = auth\.uid\(\)/.test(sql), "MESSAGE_SENDER_NOT_BOUND_TO_CALLER");
check(/is_anonymous/.test(sql), "GUEST_NOT_EXCLUDED");
check(!/^\s*(begin|commit);/im.test(sql), "MANUAL_TRANSACTION_IN_MIGRATION");

// No later migration may reopen a table to everyone.
for (const f of fs.readdirSync(dir).filter((f) => f > MIGRATION)) {
  const s = fs.readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, "");
  check(!/create policy[^;]*(using|with check)\s*\(\s*true\s*\)/i.test(s), `POLICY_OPEN_TO_ALL: ${f}`);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("OK: T1.9A lock-down migration checks passed.");
