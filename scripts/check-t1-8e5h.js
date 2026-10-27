"use strict";
// T1.8E.5H check. Verifies definitions (migration, cleanup, backend branching) and then runs
// the behavior test and the T1.8E.5G.1 regression check. Run from the repository root:
//   node .\scripts\check-t1-8e5h.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const noComments = (s) => s.replace(/--[^\n]*/g, "");
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

// ---------------------------------------------------------------- migration
const MIGRATION = "supabase/legacy_migrations/20261027_t1_8e5h_geo_alert_activation_rules.sql";
const sql = noComments(read(MIGRATION));

check(/^\s*begin;/i.test(sql) && /commit;\s*$/i.test(sql), "SQL_NOT_WRAPPED_IN_TRANSACTION");
check(/T1_8E5H_PRECONDITION_FAILED: overlapping area-alert entitlements/.test(sql), "SQL_MISSING_OVERLAP_PRECONDITION");
check(/create extension if not exists btree_gist/i.test(sql), "SQL_MISSING_BTREE_GIST");
check(/drop constraint if exists report_orders_status_check/i.test(sql) && /'SUPERSEDED'/.test(sql), "SQL_ORDERS_SUPERSEDED_NOT_ALLOWED");
for (const s of ["PENDING", "AUTHORIZED", "PAID", "ACTIVE", "CANCELLED", "REFUNDED", "FAILED", "EXPIRED"])
  check(new RegExp(`report_orders_status_check[\\s\\S]*'${s}'`).test(sql), `SQL_ORDERS_STATUS_LOST_${s}`);

const exclusion = sql.match(/add constraint report_entitlements_geo_alert_no_overlap([\s\S]*?);/i);
check(Boolean(exclusion), "SQL_MISSING_EXCLUSION_CONSTRAINT");
if (exclusion) {
  const e = exclusion[1];
  check(/exclude using gist/i.test(e), "SQL_EXCLUSION_NOT_GIST");
  check(/report_id with =/i.test(e), "SQL_EXCLUSION_NOT_PER_REPORT");
  check(/tstzrange\(starts_at, current_period_end, '\[\)'\) with &&/i.test(e), "SQL_EXCLUSION_NOT_TIME_BASED");
  check(/product_code like 'GEO_ALERT_TIER_%'/i.test(e), "SQL_EXCLUSION_NOT_ALL_TIERS");
  check(!/product_code\s*=\s*/i.test(e), "SQL_EXCLUSION_PER_TIER");
}
check(/drop constraint if exists report_entitlements_geo_alert_no_overlap/i.test(sql), "SQL_EXCLUSION_NOT_REPEATABLE");

function fnBody(name) {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`, "i"));
  return m ? m[1] : null;
}
const state = fnBody("geo_alert_activation_state");
const create = fnBody("geo_alert_create_entitlement");
check(state !== null, "SQL_STATE_FUNCTION_MISSING");
if (state) {
  check(/current_period_end > now\(\)/i.test(state), "SQL_STATE_ACTIVE_NOT_TIME_BASED");
  check(/'EXPIRED'/.test(state) && /activation_count/.test(state), "SQL_STATE_COUNT_IGNORES_EXPIRED");
  check(!/'CANCELLED'/.test(state) && !/'REFUNDED'/.test(state), "SQL_STATE_COUNTS_CANCELLED_OR_REFUNDED");
  check(/2 as max_activations/i.test(state), "SQL_STATE_MAX_NOT_TWO");
}
check(create !== null, "SQL_CREATE_FUNCTION_MISSING");
if (create) {
  const iLock = create.search(/from public\.reports where id = v_order\.report_id for update/i);
  const iExpire = create.search(/set status = 'EXPIRED'/i);
  const iState = create.search(/geo_alert_activation_state\(v_order\.report_id\)/i);
  const iActive = create.indexOf("GEO_ALERT_ALREADY_ACTIVE");
  const iLimit = create.indexOf("GEO_ALERT_LIMIT_REACHED");
  const iInsert = create.search(/insert into public\.report_entitlements/i);
  check(iLock > 0, "SQL_CREATE_NO_REPORT_LOCK");
  check(iExpire > iLock, "SQL_CREATE_NO_LAZY_EXPIRY_AFTER_LOCK");
  check(/set status = 'COMPLETED'/i.test(create), "SQL_CREATE_NO_CAMPAIGN_COMPLETION");
  check(iState > iExpire, "SQL_CREATE_STATE_BEFORE_EXPIRY");
  check(iActive > iState && iLimit > iActive, "SQL_CREATE_RULE_ORDER_WRONG");
  check(iInsert > iLimit, "SQL_CREATE_INSERT_BEFORE_RULES");
  check(/GEO_ALERT_ORDER_INVALID_PRODUCT/.test(create), "SQL_CREATE_ACCEPTS_OTHER_PRODUCTS");
  check(/where id = p_order_id and user_id = p_user_id/i.test(create), "SQL_CREATE_NO_ORDER_OWNERSHIP");
}
for (const sig of ["geo_alert_activation_state\\(uuid\\)", "geo_alert_create_entitlement\\(uuid, uuid, timestamptz, timestamptz, text, text, jsonb\\)"]) {
  check(new RegExp(`revoke all on function public\\.${sig}\\s+from public, anon, authenticated;`, "i").test(sql), `SQL_NOT_REVOKED_${sig.split("\\")[0]}`);
  check(new RegExp(`grant execute on function public\\.${sig}\\s+to service_role;`, "i").test(sql), `SQL_NOT_GRANTED_${sig.split("\\")[0]}`);
}

// ---------------------------------------------------------------- cleanup
const cleanup = read("scripts/sql/cleanup-t1-8e5h-overlapping-geo-alerts.sql");
check(!fs.existsSync(path.join(root, "supabase/migrations/cleanup-t1-8e5h-overlapping-geo-alerts.sql")), "CLEANUP_STORED_AS_MIGRATION");
check(/T1_8E5H_CLEANUP_FAILED: expected 6 cancelled rows/.test(cleanup), "CLEANUP_NOT_VERIFIED");
check((cleanup.match(/and status = 'ACTIVE';/g) || []).length === 3, "CLEANUP_NOT_GUARDED_BY_STATUS");
for (const id of ["7909a99c-fe4a-4e65-8eb0-70da328f390c", "7d15f6b7-7565-453a-802a-a6c1536cd501",
  "bc7bf2af-674c-4f23-ad5c-fb701bccd35e", "6e1c470a-8ad0-4e6c-9fdb-8a8cdebc972e",
  "3ece7ad3-9367-4d69-9371-ea6b6806008b", "87fc9cfb-f948-4fc2-9b3f-47c622ac03cf"])
  check(cleanup.includes(id), `CLEANUP_MISSING_${id.slice(0, 8)}`);
check(!/delete from/i.test(cleanup), "CLEANUP_DELETES_ROWS");

// ---------------------------------------------------------------- backend
const guard = read("server/lib/geoAlertActivationGuard.js");
const rc = read("server/routes/reportCommerce.js");

check(/rpc\("geo_alert_activation_state"/.test(guard), "GUARD_NO_STATE_RPC");
check(/rpc\("geo_alert_create_entitlement"/.test(guard), "GUARD_NO_CREATE_RPC");
check(/"23P01"/.test(guard), "GUARD_EXCLUSION_NOT_MAPPED");

const orderRoute = rc.slice(rc.indexOf('router.post("/orders",'), rc.indexOf('router.get("/orders/:id"'));
const iReplay = orderRoute.indexOf("idempotentReplay: true");
const iBlock = orderRoute.indexOf("geoAlertBlockReason(");
const iOrderInsert = orderRoute.indexOf(".insert(payload)");
check(iBlock > iReplay && iOrderInsert > iBlock, "ORDER_GUARD_NOT_BEFORE_INSERT");
check(/res\.status\(409\)\.json\(block\)/.test(orderRoute), "ORDER_GUARD_NOT_409");

const act = rc.slice(rc.indexOf('router.post("/orders/:id/test-activate"'));
const iGuarded = act.indexOf("createGeoAlertEntitlement(");
const iCampaign = act.indexOf('.from("geo_alert_campaigns")\n        .insert(');
const iDispatch = act.indexOf("dispatchAreaAlertCampaign(");
check(iGuarded > 0, "ACTIVATION_NOT_GUARDED");
check(iCampaign > iGuarded && iDispatch > iCampaign, "ACTIVATION_ORDER_WRONG");
check(/res\.status\(409\)\.json\(guarded\.rejection\)/.test(act), "ACTIVATION_REJECTION_NOT_409");
check(!/"23505"/.test(act), "CAMPAIGN_REUSE_BRANCH_REMAINS");
check(!/GEO_ALERT_CAMPAIGN_REUSE_FAILED|existing-campaign-reused/.test(rc), "CAMPAIGN_REUSE_CODE_REMAINS");
check((rc.match(/await cancelGeoAlertEntitlement\(/g) || []).length === 2, "COMPENSATION_MISSING");
check(/like\("product_code", "GEO_ALERT_TIER_%"\)/.test(act), "SUPERSEDE_NOT_CROSS_TIER");
check(/eq\("product_code", order\.product_code\)/.test(act), "SUPERSEDE_OTHER_PRODUCTS_CHANGED");

for (const f of ["server/routes/reportCommerce.js", "server/lib/geoAlertActivationGuard.js"]) {
  try { execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio: "pipe" }); }
  catch { failures.push(`SYNTAX_ERROR: ${f}`); }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`FAILED: ${failures.length} T1.8E.5H definition checks.`);
  process.exit(1);
}
console.log("OK: T1.8E.5H definition checks passed.");

for (const script of ["test-t1-8e5h-activation.js", "check-t1-8e5g1.js"]) {
  try { execFileSync(process.execPath, [path.join(root, "scripts", script)], { stdio: "inherit", cwd: root }); }
  catch { console.error(`FAILED: ${script}`); process.exit(1); }
}
console.log("OK: T1.8E.5H checks passed.");
