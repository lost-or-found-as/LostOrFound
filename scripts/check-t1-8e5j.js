"use strict";
// T1.8E.5J check. Migration definitions and backend wiring, then the T1.8E.5J behavior test
// and the earlier chain (T1.8E.5I -> 5H -> 5G.1). Run from the repository root:
//   node .\scripts\check-t1-8e5j.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };
const sql = read("supabase/migrations/20261027_t1_8e5j_commerce_expiry_and_estimates.sql").replace(/--[^\n]*/g, "");

function body(name) {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`, "i"));
  return m ? m[1] : null;
}

check(/^\s*begin;/i.test(sql) && /commit;\s*$/i.test(sql), "SQL_NOT_WRAPPED_IN_TRANSACTION");
check(/T1_8E5J_PRECONDITION_FAILED: pg_cron is not installed/.test(sql), "SQL_NO_PG_CRON_PRECONDITION");

const core = body("geo_alert_qualifying_users");
check(core !== null, "SQL_CORE_MISSING");
if (core) {
  check(!/push_installations/i.test(core), "SQL_CORE_DEPENDS_ON_PUSH");
  check(!/push_enabled\s*=\s*true/i.test(core), "SQL_CORE_FILTERS_ON_PUSH");
  check(/wa\.expires_at is null or wa\.expires_at > now\(\)/i.test(core), "SQL_CORE_NO_EXPIRY_FILTER");
  check(/wa\.user_id <> p_owner_id/i.test(core), "SQL_CORE_NO_OWNER_EXCLUSION");
  check(/wa\.area_type = 'POLYGON'[\s\S]*st_dwithin\(wa\.boundary/i.test(core), "SQL_CORE_NO_POLYGON");
  check(/st_dwithin\(wa\.center, p_point, wa\.radius_m \+ coalesce\(p_radius_m, 0\)\)/i.test(core), "SQL_CORE_CIRCLE_CHANGED");
}
for (const [name, code] of [["geo_alert_eligible_users", "DISPATCH"], ["preview_geo_alert_audience", "PREVIEW"]]) {
  const b = body(name);
  check(b !== null, `SQL_${code}_MISSING`);
  if (b) {
    check(/public\.geo_alert_qualifying_users\(/i.test(b), `SQL_${code}_NOT_USING_CORE`);
    check(!/notification_watch_areas/i.test(b), `SQL_${code}_DUPLICATES_AREA_RULE`);
  }
}
const preview = body("preview_geo_alert_audience");
if (preview) {
  check(/\(select count\(\*\) from users\)::integer/i.test(preview), "SQL_PREVIEW_USERS_NOT_FULL_AUDIENCE");
  check(/where u\.push_requested = true/i.test(preview), "SQL_PREVIEW_INSTALLATIONS_IGNORE_PUSH_CHOICE");
}
const refresh = body("refresh_geo_alert_estimate");
check(refresh !== null && /from public\.geo_alert_eligible_users\(p_campaign_id\)/i.test(refresh), "SQL_REFRESH_USERS_NOT_FROM_DISPATCH");
const expiry = body("process_commerce_expiry");
check(expiry !== null, "SQL_EXPIRY_MISSING");
if (expiry) {
  const iEnt = expiry.indexOf("update public.report_entitlements");
  const iOrd = expiry.indexOf("where o.status = 'ACTIVE'");
  check(iEnt >= 0 && iOrd > iEnt, "SQL_EXPIRY_ORDER_WRONG");
  check(/coalesce\(e\.auto_renews, false\) = false/i.test(expiry), "SQL_EXPIRY_TOUCHES_AUTO_RENEWING");
  check(/set status = 'COMPLETED',\s*completed_at = coalesce\(c\.completed_at, v_now\)/i.test(expiry), "SQL_EXPIRY_CAMPAIGNS");
  check(/o\.status in \('PENDING', 'AUTHORIZED'\)\s*and o\.created_at < v_now - interval '24 hours'/i.test(expiry), "SQL_EXPIRY_STALE_ORDERS");
  check(!/delete from/i.test(expiry), "SQL_EXPIRY_DELETES");
}
check(/cron\.schedule\(\s*'lost-or-found-commerce-expiry',\s*'7,22,37,52 \* \* \* \*'/.test(sql), "SQL_CRON_JOB_MISSING");
check(!/function public\.process_report_lifecycle/i.test(sql), "SQL_TOUCHES_REPORT_LIFECYCLE");
check(!/drop function/i.test(sql), "SQL_DROPS_FUNCTION");
for (const sig of ["geo_alert_qualifying_users\\(uuid, geography, integer, text\\)", "process_commerce_expiry\\(\\)", "preview_geo_alert_audience\\(uuid, uuid, integer\\)", "refresh_geo_alert_estimate\\(uuid\\)", "geo_alert_eligible_users\\(uuid\\)"])
  check(new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;`, "i").test(sql), `SQL_NOT_REVOKED_${sig.split("\\")[0]}`);

const rc = read("server/routes/reportCommerce.js");
const act = rc.slice(rc.indexOf('router.post("/orders/:id/test-activate"'));
const iReplay = act.indexOf('["ACTIVE", "REFUNDED", "CANCELLED"].includes(order.status)');
const iClosed = act.indexOf('error: "ORDER_NOT_ACTIVATABLE"');
const iGuard = act.indexOf("createGeoAlertEntitlement(");
check(iReplay > 0 && iClosed > iReplay && iGuard > iClosed, "ACTIVATION_CLOSED_ORDER_GUARD_ORDER");
check(/\["PENDING", "AUTHORIZED", "PAID"\]\.includes\(/.test(act), "ACTIVATION_OPEN_STATUSES_CHANGED");

for (const f of ["server/lib/messages.js", "server/lib/geoAlertDispatch.js", "server/routes/push.js", "server/routes/matches.js",
  "server/routes/observations.js", "server/routes/observationChat.js", "server/routes/resolutions.js", "server/routes/reportCommerce.js"]) {
  try { execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio: "pipe" }); }
  catch { failures.push(`SYNTAX_ERROR: ${f}`); }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`FAILED: ${failures.length} T1.8E.5J definition checks.`);
  process.exit(1);
}
console.log("OK: T1.8E.5J definition checks passed.");

for (const script of ["test-t1-8e5j.js", "check-t1-8e5i.js"]) {
  try { execFileSync(process.execPath, [path.join(root, "scripts", script)], { stdio: "inherit", cwd: root }); }
  catch { console.error(`FAILED: ${script}`); process.exit(1); }
}
console.log("OK: T1.8E.5J checks passed.");
