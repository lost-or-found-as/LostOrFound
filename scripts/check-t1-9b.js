"use strict";
// T1.9B static check: the NEW_MATCH notification holds the real match count.
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "supabase", "migrations", "20261029120000_t1_9b_match_notification_count.sql");
const sql = fs.readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
const errors = [];
if (!/count\(distinct m\.found_id\)/.test(sql)) errors.push("COUNT_NOT_FROM_MATCHES");
if (/v_existing_count\s*\+\s*1/.test(sql)) errors.push("COUNT_STILL_INCREMENTED_PER_INSERT");
if (!/elsif v_count > v_existing_count then[\s\S]*read_at = null/.test(sql)) errors.push("UNREAD_NOT_LIMITED_TO_MORE_MATCHES");
if (!/revoke execute on function public\.notify_new_match_to_notifications\(\) from public, anon, authenticated/.test(sql)) errors.push("CLIENT_EXECUTE_NOT_REVOKED");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("OK: T1.9B match notification count checks passed.");
