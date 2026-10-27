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

// Statuses that count as a used activation (same set as geo_alert_activation_state).
const COUNTED_STATUSES = ["ACTIVE", "GRACE", "PAUSED", "EXPIRED"];
const LIVE_STATUSES = new Set(["ACTIVE", "GRACE", "PAUSED"]);

/**
 * T1.8E.5I: read-only area-alert status for one report, for the app's service card.
 * Rules 1 and 2 come from geo_alert_activation_state so the app and the guard agree.
 * "live" is decided by time, because expired rows are not always moved out of ACTIVE.
 */
async function getGeoAlertStatus(reportId, now = new Date()) {
  const state = await getGeoAlertActivationState(reportId);

  const { data: entitlements, error: entitlementError } = await supaAdmin
    .from("report_entitlements")
    .select("id,order_id,status,starts_at,current_period_end")
    .eq("report_id", reportId)
    .like("product_code", `${GEO_ALERT_PRODUCT_PREFIX}%`)
    .in("status", COUNTED_STATUSES)
    .order("starts_at", { ascending: true });
  if (entitlementError) throw entitlementError;

  const orderIds = (entitlements || []).map((row) => row.order_id).filter(Boolean);
  let campaignsByOrder = new Map();
  if (orderIds.length) {
    const { data: campaigns, error: campaignError } = await supaAdmin
      .from("geo_alert_campaigns")
      .select("id,order_id,radius_m")
      .in("order_id", orderIds);
    if (campaignError) throw campaignError;
    campaignsByOrder = new Map((campaigns || []).map((c) => [c.order_id, c]));
  }

  const nowMs = now.getTime();
  const activations = (entitlements || []).map((row) => {
    const campaign = campaignsByOrder.get(row.order_id) || null;
    const endsAt = row.current_period_end || null;
    return {
      startsAt: row.starts_at || null,
      endsAt,
      live:
        LIVE_STATUSES.has(String(row.status || "").toUpperCase()) &&
        Boolean(endsAt) &&
        new Date(endsAt).getTime() > nowMs,
      radiusM: campaign?.radius_m != null ? Number(campaign.radius_m) : null,
    };
  });

  const maxActivations = Number(state.maxActivations || 2);
  const activationCount = Number(state.activationCount || 0);
  return {
    activeUntil: state.activeUntil,
    activationCount,
    maxActivations,
    remaining: Math.max(0, maxActivations - activationCount),
    canOrder: !state.activeUntil && activationCount < maxActivations,
    activations,
  };
}

module.exports = {
  getGeoAlertStatus,
  GEO_ALERT_ALREADY_ACTIVE,
  GEO_ALERT_LIMIT_REACHED,
  isGeoAlertProduct,
  getGeoAlertActivationState,
  geoAlertBlockReason,
  mapGeoAlertGuardError,
  createGeoAlertEntitlement,
};
