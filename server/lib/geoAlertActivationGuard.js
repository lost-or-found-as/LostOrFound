"use strict";
const { supaAdmin } = require("../supabaseClient");

// T1.8E.5H area-alert activation rules.
//   Rule 1: at most one live area alert per report.
//   Rule 2: at most two paid area-alert activations per report.
// The database is the source of truth: geo_alert_create_entitlement enforces both rules
// under a row lock, and an exclusion constraint prevents overlapping live entitlements.

const GEO_ALERT_PRODUCT_PREFIX = "GEO_ALERT_TIER_";
const GEO_ALERT_ALREADY_ACTIVE = "GEO_ALERT_ALREADY_ACTIVE";
const GEO_ALERT_LIMIT_REACHED = "GEO_ALERT_LIMIT_REACHED";

function isGeoAlertProduct(productCode) {
  return String(productCode || "").startsWith(GEO_ALERT_PRODUCT_PREFIX);
}

async function getGeoAlertActivationState(reportId) {
  const { data, error } = await supaAdmin.rpc("geo_alert_activation_state", {
    p_report_id: reportId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    activeUntil: row?.active_until || null,
    activationCount: Number(row?.activation_count || 0),
    maxActivations: Number(row?.max_activations || 2),
  };
}

/** Returns a 409 body when a new area alert may not be ordered, otherwise null. */
function geoAlertBlockReason(state) {
  if (state?.activeUntil)
    return { error: GEO_ALERT_ALREADY_ACTIVE, activeUntil: state.activeUntil };
  if (Number(state?.activationCount || 0) >= Number(state?.maxActivations || 2))
    return {
      error: GEO_ALERT_LIMIT_REACHED,
      activationCount: Number(state.activationCount),
      maxActivations: Number(state.maxActivations || 2),
    };
  return null;
}

/** Maps a database rejection from geo_alert_create_entitlement to a 409 body, or null. */
function mapGeoAlertGuardError(error) {
  const message = String(error?.message || "");
  if (message.includes(GEO_ALERT_ALREADY_ACTIVE))
    return { error: GEO_ALERT_ALREADY_ACTIVE, activeUntil: error?.details || null };
  if (message.includes(GEO_ALERT_LIMIT_REACHED))
    return {
      error: GEO_ALERT_LIMIT_REACHED,
      activationCount: Number(error?.details || 0) || null,
      maxActivations: 2,
    };
  // Exclusion constraint violation: an overlapping live area alert exists.
  if (String(error?.code || "") === "23P01")
    return { error: GEO_ALERT_ALREADY_ACTIVE, activeUntil: null };
  return null;
}

/**
 * Creates the entitlement for an area-alert order through the guarded database function.
 * @returns {Promise<{ entitlement: object } | { rejection: object } | { error: object }>}
 */
async function createGeoAlertEntitlement({
  orderId,
  userId,
  startsAt,
  periodEnd,
  provider,
  providerTransactionId,
  metadata,
}) {
  const { data, error } = await supaAdmin.rpc("geo_alert_create_entitlement", {
    p_order_id: orderId,
    p_user_id: userId,
    p_starts_at: startsAt,
    p_period_end: periodEnd,
    p_provider: provider || "TEST",
    p_provider_transaction_id: providerTransactionId,
    p_metadata: metadata || {},
  });
  if (error) {
    const rejection = mapGeoAlertGuardError(error);
    if (rejection) return { rejection };
    return { error };
  }
  const entitlement = Array.isArray(data) ? data[0] : data;
  if (!entitlement?.id) return { error: { message: "GEO_ALERT_ENTITLEMENT_NOT_CREATED" } };
  return { entitlement };
}

module.exports = {
  GEO_ALERT_ALREADY_ACTIVE,
  GEO_ALERT_LIMIT_REACHED,
  isGeoAlertProduct,
  getGeoAlertActivationState,
  geoAlertBlockReason,
  mapGeoAlertGuardError,
  createGeoAlertEntitlement,
};
