"use strict";
// T1.9AB: Security Advisor clean-up (pinned search paths, pg_trgm out of public, fewer callable
// SECURITY DEFINER functions).
//   node .\scripts\test-t1-9ab.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261106100000_t1_9ab_security_advisor_cleanup.sql"), "utf8");
let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n++;
};

for (const fn of ["get_matches_for_report", "set_updated_at", "refresh_matches_for_report", "pgrst_watch", "set_report_location"])
  ok(sql.includes(`'${fn}'`), `${fn} gets a pinned search_path`);
ok(/alter routine %s set search_path = public, extensions/.test(sql), "path is public, extensions");
ok(/alter extension pg_trgm set schema extensions/.test(sql), "pg_trgm moves to extensions");
ok(/exception when insufficient_privilege then\s+raise warning 'PG_TRGM_NOT_MOVED/.test(sql), "a move we may not do only warns");
ok(/revoke execute on function public\.refresh_matches_on_identifier_change\(\) from public, anon, authenticated/.test(sql), "trigger function not callable by clients");
ok(/revoke execute on function public\.is_conversation_participant\(uuid\) from public, anon/.test(sql), "participant check not callable without a session");
ok(/grant execute on function public\.is_conversation_participant\(uuid\) to authenticated, service_role/.test(sql), "chat policies keep working for signed-in users");

console.log(`OK: T1.9AB Security Advisor clean-up checks passed (${n} assertions).`);
