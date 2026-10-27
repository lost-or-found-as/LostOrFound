"use strict";
// T1.8E.5G.1 check. Verifies definitions (SQL function bodies, backend branching) and then
// runs the behavior test. Run from the repository root:
//   node .\scripts\check-t1-8e5g1.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

// ---------------------------------------------------------------- migration
const MIGRATION = "supabase/migrations/20261027_t1_8e5g1_area_alert_user_eligibility.sql";
const sql = read(MIGRATION);
const stripComments = (s) => s.replace(/--[^\n]*/g, "");
const code = stripComments(sql);

function functionBody(name) {
  const re = new RegExp(
    `create (?:or replace )?function public\\.${name}\\(p_campaign_id uuid\\)[\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    "i",
  );
  const m = code.match(re);
  return m ? m[1] : null;
}

const users = functionBody("geo_alert_eligible_users");
const installs = functionBody("geo_alert_eligible_installations");
const inApp = functionBody("geo_alert_create_in_app_notifications");

check(/^\s*begin;/i.test(code) && /commit;\s*$/i.test(code), "SQL_NOT_WRAPPED_IN_TRANSACTION");
check(/notifications_notification_key_uidx/.test(code), "SQL_MISSING_DEDUP_INDEX_PRECONDITION");
check(/raise exception 'T1_8E5G1_PRECONDITION_FAILED: geo_alert_eligible_users is referenced/.test(code),
  "SQL_MISSING_DEPENDENCY_PRECONDITION");
check(/drop function if exists public\.geo_alert_eligible_users\(uuid\);/i.test(code), "SQL_USERS_NOT_REPEATABLE");

check(users !== null, "SQL_USERS_FUNCTION_MISSING");
if (users) {
  check(!/push_installations/i.test(users), "SQL_USERS_DEPENDS_ON_PUSH_INSTALLATIONS");
  check(/wa\.active\s*=\s*true/i.test(users), "SQL_USERS_MISSING_ACTIVE_FILTER");
  check(/wa\.expires_at is null or wa\.expires_at > now\(\)/i.test(users), "SQL_USERS_MISSING_EXPIRY_FILTER");
  check(/wa\.user_id\s*<>\s*c\.report_owner_id/i.test(users), "SQL_USERS_MISSING_SENDER_EXCLUSION");
  check(/all_categories\s*=\s*true[\s\S]*category_keys/i.test(users), "SQL_USERS_MISSING_CATEGORY_FILTER");
  check(/st_dwithin\(wa\.boundary/i.test(users) && /st_dwithin\(wa\.center/i.test(users), "SQL_USERS_MISSING_GEOGRAPHY");
  check(/upper\(c\.status::text\)\s*=\s*'ACTIVE'/i.test(users), "SQL_USERS_MISSING_CAMPAIGN_STATE");
  check(/upper\(r\.type::text\)\s*=\s*'LOST'/i.test(users), "SQL_USERS_MISSING_REPORT_STATE");
  check(/bool_or\(q\.push_enabled\)[\s\S]*as push_requested/i.test(users), "SQL_USERS_MISSING_PUSH_REQUESTED");
  check(!/wa\.push_enabled\s*=\s*true/i.test(users), "SQL_USERS_FILTERS_ON_PUSH_ENABLED");
  check(/distinct on \(q\.recipient_user_id\)/i.test(users), "SQL_USERS_NOT_ONE_ROW_PER_USER");
}

check(installs !== null, "SQL_INSTALLATIONS_FUNCTION_MISSING");
if (installs) {
  check(/from public\.geo_alert_eligible_users\(p_campaign_id\)/i.test(installs), "SQL_INSTALLATIONS_NOT_DERIVED_FROM_USERS");
  check(!/notification_watch_areas/i.test(installs), "SQL_INSTALLATIONS_DUPLICATES_QUALIFICATION");
  check(/u\.push_requested\s*=\s*true/i.test(installs), "SQL_INSTALLATIONS_IGNORES_PUSH_REQUESTED");
  check(/pi\.active\s*=\s*true/i.test(installs), "SQL_INSTALLATIONS_MISSING_ACTIVE");
  check(/pi\.permission_status\s*=\s*'granted'/i.test(installs), "SQL_INSTALLATIONS_MISSING_GRANTED");
  check(/distinct on \(pi\.installation_id\)/i.test(installs), "SQL_INSTALLATIONS_NOT_ONE_ROW_PER_INSTALLATION");
}

check(inApp !== null, "SQL_IN_APP_FUNCTION_MISSING");
if (inApp) {
  check(/from public\.geo_alert_eligible_users\(p_campaign_id\)/i.test(inApp), "SQL_IN_APP_NOT_DERIVED_FROM_USERS");
  check(!/push_installations/i.test(inApp), "SQL_IN_APP_DEPENDS_ON_PUSH");
  check(/on conflict \(notification_key\) where notification_key is not null do nothing/i.test(inApp), "SQL_IN_APP_NOT_IDEMPOTENT");
  check(/'AREA_ALERT:' \|\| e\.campaign_id::text \|\| ':' \|\| e\.recipient_user_id::text/i.test(inApp), "SQL_IN_APP_KEY_FORMAT_CHANGED");
}

for (const name of ["geo_alert_eligible_users", "geo_alert_eligible_installations", "geo_alert_create_in_app_notifications"]) {
  check(new RegExp(`revoke all on function public\\.${name}\\(uuid\\) from public, anon, authenticated;`, "i").test(code), `SQL_${name.toUpperCase()}_NOT_REVOKED`);
  check(new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to service_role;`, "i").test(code), `SQL_${name.toUpperCase()}_NOT_GRANTED`);
}

// ---------------------------------------------------------------- backend
const dispatch = read("server/lib/geoAlertDispatch.js");
const access = read("server/lib/areaAlertAccess.js");
const notifications = read("server/routes/notifications.js");
const delivery = read("server/routes/geoAlertDelivery.js");

const iInApp = dispatch.indexOf('"geo_alert_create_in_app_notifications"');
const iInstalls = dispatch.indexOf('"geo_alert_eligible_installations"');
const iSend = dispatch.indexOf("await expoSend(messages)");
check(iInApp > 0, "DISPATCH_MISSING_IN_APP_RPC");
check(iInstalls > iInApp, "DISPATCH_PUSH_BEFORE_NEARBY");
check(iSend > iInstalls, "DISPATCH_SEND_ORDER_WRONG");
check(!/\.from\("notifications"\)/.test(dispatch), "DISPATCH_WRITES_NOTIFICATIONS_DIRECTLY");
check(!/"geo_alert_eligible_users"/.test(dispatch), "DISPATCH_DUPLICATES_USER_QUALIFICATION");
check(/try\s*\{\s*tickets = await expoSend\(messages\);\s*\}\s*catch/.test(dispatch), "DISPATCH_PUSH_FAILURE_NOT_ISOLATED");
check(/if \(accepted\.length\)/.test(dispatch), "DISPATCH_SENDS_WITHOUT_INSTALLATIONS");
for (const field of ["eligible:", "notificationsCreated,", "pushEligible:", "sent:", "skippedAsDuplicate,", "failed,", "pushError,"])
  check(dispatch.includes(field), `DISPATCH_RESULT_MISSING_${field.replace(/[^a-zA-Z]/g, "").toUpperCase()}`);
check(/onConflict: "campaign_id,installation_id", ignoreDuplicates: true/.test(dispatch), "DISPATCH_RECIPIENT_DEDUP_CHANGED");

check(/\.from\("geo_alert_recipients"\)[\s\S]*?\.limit\(1\)/.test(access), "ACCESS_RECIPIENT_LOOKUP_NOT_LIMITED");
check(/\.eq\("type", "AREA_ALERT"\)[\s\S]*?\.limit\(1\)/.test(access), "ACCESS_NOTIFICATION_LOOKUP_NOT_LIMITED");
check(!/maybeSingle/.test(access), "ACCESS_USES_MAYBE_SINGLE");

for (const [label, src] of [["NOTIFICATIONS", notifications], ["DELIVERY", delivery]]) {
  check(/require\("\.\.\/lib\/areaAlertAccess"\)/.test(src), `${label}_NOT_USING_SHARED_ACCESS`);
  check(/await getAreaAlertAccess\(/.test(src), `${label}_NOT_CALLING_SHARED_ACCESS`);
  check(!/\.from\("geo_alert_recipients"\)[\s\S]{0,200}\.maybeSingle\(\)/.test(src), `${label}_RECIPIENT_MAYBE_SINGLE_REMAINS`);
}

// ---------------------------------------------------------------- syntax + behavior
for (const f of ["server/lib/geoAlertDispatch.js", "server/lib/areaAlertAccess.js", "server/routes/notifications.js", "server/routes/geoAlertDelivery.js"]) {
  try { execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio: "pipe" }); }
  catch { failures.push(`SYNTAX_ERROR: ${f}`); }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`FAILED: ${failures.length} T1.8E.5G.1 definition checks.`);
  process.exit(1);
}
console.log("OK: T1.8E.5G.1 definition checks passed.");

try {
  execFileSync(process.execPath, [path.join(root, "scripts", "test-t1-8e5g1-dispatch.js")], { stdio: "inherit", cwd: root });
} catch {
  console.error("FAILED: T1.8E.5G.1 behavior test.");
  process.exit(1);
}
console.log("OK: T1.8E.5G.1 checks passed.");
