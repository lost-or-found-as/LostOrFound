"use strict";
// T1.9AE: a store refund (RevenueCat CANCELLATION for a one-time purchase) ends the service it
// paid for: the order and entitlement become REFUNDED, a running area alert stops showing in
// Nearby and a historic-case watch stops. A 30-day extension keeps the days already given.
// Repeatable: a second call for the same transaction changes nothing.
async function applyRefund(supaAdmin, { transactionId, reason, refundedAt }) {
  const { data: order, error } = await supaAdmin
    .from("report_orders")
    .select("id,status,entitlement_id,product_code,report_id")
    .eq("provider", "REVENUECAT")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return { orderId: null };
  if (order.status === "REFUNDED") return { orderId: order.id, alreadyRefunded: true };

  const when = refundedAt || new Date().toISOString();
  const orderUpdate = await supaAdmin
    .from("report_orders")
    .update({ status: "REFUNDED", refunded_at: when, refund_reason: String(reason || "REFUNDED").slice(0, 80), updated_at: when })
    .eq("id", order.id);
  if (orderUpdate.error) throw orderUpdate.error;

  if (order.entitlement_id) {
    const ent = await supaAdmin
      .from("report_entitlements")
      .update({ status: "REFUNDED", cancelled_at: when, updated_at: when })
      .eq("id", order.entitlement_id);
    if (ent.error) throw ent.error;

    const watch = await supaAdmin
      .from("long_term_watches")
      .update({ status: "CANCELLED", updated_at: when })
      .eq("entitlement_id", order.entitlement_id)
      .eq("status", "ACTIVE");
    if (watch.error) throw watch.error;
  }

  const campaign = await supaAdmin
    .from("geo_alert_campaigns")
    .update({ status: "CANCELLED", ends_at: when })
    .eq("order_id", order.id)
    .eq("status", "ACTIVE");
  if (campaign.error) throw campaign.error;

  return { orderId: order.id };
}

module.exports = { applyRefund };
