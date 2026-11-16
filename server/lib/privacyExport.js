"use strict";
// T1.9AO: everything we hold about one account, as one JSON object, for an access or
// portability request (Personvern i Lost or Found, ch. 7). Other people's data is left out:
// who reported or blocked the user, the other party's messages, push tokens.
const EXPORT_VERSION = 1;
const ROW_LIMIT = 5000;

// [table, column holding the user's id, keys to leave out]
const USER_TABLES = Object.freeze([
  ["profiles", "id", []],
  ["reports", "user_id", []],
  ["notification_watch_areas", "user_id", []],
  ["notifications", "user_id", []],
  ["push_installations", "user_id", ["*token*"]],
  ["report_orders", "user_id", []],
  ["report_entitlements", "user_id", []],
  ["long_term_watches", "user_id", []],
  ["geo_alert_campaigns", "user_id", []],
  ["area_alert_observations", "observer_user_id", ["report_owner_user_id"]],
  ["observation_messages", "sender_id", []],
  ["messages", "sender_id", []],
  ["report_edits", "user_id", []],
  ["report_creation_events", "user_id", []],
  ["report_owner_sightings", "user_id", []],
  ["app_feedback", "user_id", []],
  ["image_analyses", "user_id", []],
  ["account_suspensions", "user_id", ["lifted_by"]],
  ["chat_reports", "reporter_id", ["reported_user_id", "message_snapshot", "handled_by"]],
  ["user_blocks", "blocker_id", ["blocked_id"]],
]);

// Rows that belong to the user's own cases.
const REPORT_TABLES = Object.freeze([
  ["report_images", "report_id", []],
  ["report_identifiers", "report_id", []],
]);

function strip(row, omit) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const hidden = omit.some((o) => (o.startsWith("*") && o.endsWith("*") ? k.toLowerCase().includes(o.slice(1, -1)) : k === o));
    if (!hidden) out[k] = v;
  }
  return out;
}

async function readTable(supa, table, column, values, omit) {
  let q = supa.from(table).select("*").limit(ROW_LIMIT);
  q = Array.isArray(values) ? q.in(column, values) : q.eq(column, values);
  const { data, error } = await q;
  if (error) return { error: error.code || error.message || "READ_FAILED", rows: [] };
  return { rows: (data || []).map((r) => strip(r, omit)) };
}

/** account = { id, email, created_at, last_sign_in_at, providers } from auth. */
async function buildPrivacyExport(supa, account, now = new Date()) {
  const out = {
    export_version: EXPORT_VERSION,
    created_at: now.toISOString(),
    controller: "Lost or Found AS, org.nr. 938 439 877, admin@lostorfound.app",
    account: {
      id: account.id,
      email: account.email || null,
      created_at: account.created_at || null,
      last_sign_in_at: account.last_sign_in_at || null,
      sign_in_methods: account.providers || [],
    },
    tables: {},
    problems: [],
  };
  for (const [table, column, omit] of USER_TABLES) {
    const r = await readTable(supa, table, column, account.id, omit);
    out.tables[table] = r.rows;
    if (r.error) out.problems.push({ table, error: r.error });
  }
  const reportIds = (out.tables.reports || []).map((r) => r.id).filter(Boolean);
  for (const [table, column, omit] of REPORT_TABLES) {
    if (!reportIds.length) {
      out.tables[table] = [];
      continue;
    }
    const r = await readTable(supa, table, column, reportIds, omit);
    out.tables[table] = r.rows;
    if (r.error) out.problems.push({ table, error: r.error });
  }
  return out;
}

module.exports = { buildPrivacyExport, USER_TABLES, REPORT_TABLES, strip, EXPORT_VERSION };
