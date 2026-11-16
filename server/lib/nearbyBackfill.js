"use strict";
// T1.9AN: someone who adds, moves or turns on an alert area while an area alert or «Synlig i
// nærheten» is running there gets those cases in «I nærheten» (in-app only, never a push).
// Runs after the area is saved; a failure is logged and never fails the save.
const { supaAdmin } = require("../supabaseClient");

async function backfillNearby(userId, reason) {
  if (!userId) return 0;
  try {
    const { data, error } = await supaAdmin.rpc("geo_alert_backfill_user", { p_user_id: userId });
    if (error) throw error;
    const added = Number(Array.isArray(data) ? data[0] : data) || 0;
    if (added > 0) console.info("[nearby-backfill][added]", { reason, added });
    return added;
  } catch (e) {
    console.error("[nearby-backfill][failed]", { reason, errorCode: e?.code || null, errorMessage: e?.message || String(e) });
    return 0;
  }
}

module.exports = { backfillNearby };
