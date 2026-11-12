"use strict";
// T1.9AE: RevenueCat webhook (POST /revenuecat/webhook).
// Set up in RevenueCat → Project → Integrations → Webhooks with the URL
// https://api.lostorfound.app/revenuecat/webhook and an Authorization header equal to
// REVENUECAT_WEBHOOK_AUTH. Every event is stored once in payment_webhook_events.
//   NON_RENEWING_PURCHASE  pays the oldest open order for that store product (if the app did not)
//   CANCELLATION           a refunded one-time purchase: order and entitlement marked REFUNDED
//   other events           stored and ignored (no subscriptions are sold)
// A processing error answers 500 so RevenueCat retries; a duplicate event answers 200.
const express = require("express");
const router = express.Router();

const supaModule = require("../supabaseClient");
const supaAdmin = supaModule?.supaAdmin || supaModule?.supabaseAdmin || supaModule?.admin || supaModule?.client || supaModule;
const revenueCat = require("../lib/revenueCat");
const { payOrderWithTransaction, OPEN_ORDER_STATUSES } = require("../lib/storePurchase");
const { applyRefund } = require("../lib/storeRefund");

function activateOrderLazy(args) {
  // Loaded on use: reportCommerce.js is a large route module with its own dependencies.
  return require("./reportCommerce").activateOrder(args);
}

async function recordEvent(event) {
  const { data, error } = await supaAdmin
    .from("payment_webhook_events")
    .insert({
      provider: "REVENUECAT",
      provider_event_id: String(event.id),
      event_type: String(event.type || ""),
      status: "PROCESSING",
      attempt_count: 1,
      payload: event,
    })
    .select("id")
    .maybeSingle();
  if (!error) return { id: data?.id, duplicate: false };
  if (error.code !== "23505") throw error;
  // Seen before: process again only if the earlier attempt failed.
  const { data: previous, error: prevError } = await supaAdmin
    .from("payment_webhook_events")
    .select("id,status,attempt_count")
    .eq("provider", "REVENUECAT")
    .eq("provider_event_id", String(event.id))
    .maybeSingle();
  if (prevError) throw prevError;
  if (previous && previous.status === "FAILED") {
    await supaAdmin
      .from("payment_webhook_events")
      .update({ status: "PROCESSING", attempt_count: (previous.attempt_count || 0) + 1 })
      .eq("id", previous.id);
    return { id: previous.id, duplicate: false };
  }
  return { id: previous?.id, duplicate: true };
}

async function finishEvent(id, status, errorMessage = null) {
  if (!id) return;
  await supaAdmin
    .from("payment_webhook_events")
    .update({ status, processed_at: new Date().toISOString(), error_message: errorMessage })
    .eq("id", id);
}

async function handlePurchase(event) {
  const userId = String(event.app_user_id || "");
  const transactionId = String(event.transaction_id || "");
  if (!userId || !transactionId) return { status: "IGNORED", reason: "MISSING_USER_OR_TRANSACTION" };
  const sandbox = String(event.environment || "").toUpperCase() === "SANDBOX";
  if (sandbox && !revenueCat.sandboxAllowed()) return { status: "IGNORED", reason: "SANDBOX_NOT_ALLOWED" };

  const { data: existing, error: existingError } = await supaAdmin
    .from("report_orders")
    .select("id")
    .eq("provider", "REVENUECAT")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { status: "PROCESSED", reason: "ALREADY_LINKED", orderId: existing.id };

  const { data: orders, error: ordersError } = await supaAdmin
    .from("report_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("provider_product_id", String(event.product_id || ""))
    .in("status", OPEN_ORDER_STATUSES)
    .is("provider_transaction_id", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (ordersError) throw ordersError;
  const order = (orders || [])[0];
  // No open order: the app may still confirm it, or the user restores later. Kept for review.
  if (!order) return { status: "IGNORED", reason: "NO_OPEN_ORDER" };

  const result = await payOrderWithTransaction(
    { supaAdmin, activateOrder: activateOrderLazy },
    {
      order,
      userId,
      transaction: {
        transactionId,
        store: String(event.store || "").toUpperCase() || null,
        purchasedAt: event.purchased_at_ms ? new Date(Number(event.purchased_at_ms)).toISOString() : null,
        sandbox,
      },
      platform: revenueCat.orderPlatformForStore(event.store),
      extra: { store_price: event.price ?? null, store_currency: event.currency || null },
    },
  );
  if (result.status === 200) return { status: "PROCESSED", orderId: order.id };
  // A refused activation (for example a case that was closed meanwhile) is not retried.
  return { status: "IGNORED", reason: result.body?.error || `STATUS_${result.status}`, orderId: order.id };
}

async function handleCancellation(event) {
  const transactionId = String(event.transaction_id || "");
  if (!transactionId) return { status: "IGNORED", reason: "MISSING_TRANSACTION" };
  const result = await applyRefund(supaAdmin, {
    transactionId,
    reason: String(event.cancel_reason || "REFUNDED"),
    refundedAt: event.event_timestamp_ms ? new Date(Number(event.event_timestamp_ms)).toISOString() : new Date().toISOString(),
  });
  return result.orderId ? { status: "PROCESSED", orderId: result.orderId } : { status: "IGNORED", reason: "ORDER_NOT_FOUND" };
}

router.post("/webhook", async (req, res) => {
  if (!revenueCat.webhookAuthorized(req.header("Authorization"))) return res.status(401).json({ error: "UNAUTHORIZED" });
  const event = req.body?.event;
  if (!event?.id || !event?.type) return res.status(400).json({ error: "EVENT_REQUIRED" });

  let record = null;
  try {
    record = await recordEvent(event);
    if (record.duplicate) return res.json({ ok: true, duplicate: true });

    const type = String(event.type).toUpperCase();
    let outcome;
    if (type === "NON_RENEWING_PURCHASE") outcome = await handlePurchase(event);
    else if (type === "CANCELLATION") outcome = await handleCancellation(event);
    else outcome = { status: "IGNORED", reason: `EVENT_${type}` };

    await finishEvent(record.id, outcome.status, outcome.reason || null);
    console.info("[revenuecat][webhook]", { eventId: event.id, type, ...outcome });
    return res.json({ ok: true, ...outcome });
  } catch (e) {
    console.error("[revenuecat][webhook-failed]", { eventId: event.id, type: event.type, errorMessage: e?.message || String(e) });
    try {
      await finishEvent(record?.id, "FAILED", String(e?.message || e).slice(0, 500));
    } catch {
      // The retry from RevenueCat will record it again.
    }
    return res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});

module.exports = router;
module.exports._internal = { recordEvent, handlePurchase, handleCancellation };
