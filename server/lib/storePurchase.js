"use strict";
// T1.9AE: tie a verified store transaction to an order, then activate it with the shared
// activation path. Used by the app's confirm call, the purchase sync and the RevenueCat webhook.
// The database's unique index on (provider, provider_transaction_id) makes sure one store
// transaction can never pay for two orders, even when the app and the webhook race.
const OPEN_ORDER_STATUSES = ["PENDING", "AUTHORIZED", "PAID"];

/**
 * deps: { supaAdmin, activateOrder }
 * input: { order, userId, transaction: { transactionId, store, purchasedAt, sandbox }, platform, extra }
 * returns { status, body }
 */
async function payOrderWithTransaction(deps, { order, userId, transaction, platform, extra = {} }) {
  const { supaAdmin, activateOrder } = deps;
  const status = String(order.status || "").toUpperCase();

  // Already paid by this transaction: replay the activation result.
  if (order.provider === "REVENUECAT" && order.provider_transaction_id === transaction.transactionId) {
    return activateOrder({
      order,
      userId,
      provider: "REVENUECAT",
      providerTransactionId: transaction.transactionId,
      metadata: { store: transaction.store, sandbox: transaction.sandbox },
    });
  }
  if (!OPEN_ORDER_STATUSES.includes(status)) return { status: 409, body: { error: "ORDER_NOT_ACTIVATABLE", orderStatus: order.status } };

  // Claim the transaction for this order (fails on the unique index if another order has it).
  const { data: claimed, error: claimError } = await supaAdmin
    .from("report_orders")
    .update({
      provider: "REVENUECAT",
      platform,
      provider_transaction_id: transaction.transactionId,
      price_snapshot: {
        ...(order.price_snapshot || {}),
        store: transaction.store || null,
        store_purchased_at: transaction.purchasedAt || null,
        sandbox: transaction.sandbox === true,
        ...extra,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("user_id", userId)
    .is("provider_transaction_id", null)
    .select("*")
    .maybeSingle();
  if (claimError) {
    if (claimError.code === "23505") return { status: 409, body: { error: "TRANSACTION_ALREADY_USED" } };
    return { status: 400, body: { error: claimError.message || "ORDER_CLAIM_FAILED" } };
  }
  if (!claimed) return { status: 409, body: { error: "ORDER_ALREADY_HAS_TRANSACTION" } };

  return activateOrder({
    order: claimed,
    userId,
    provider: "REVENUECAT",
    providerTransactionId: transaction.transactionId,
    metadata: { store: transaction.store || null, sandbox: transaction.sandbox === true },
  });
}

/** Has another order already used this store transaction? */
async function transactionInUse(supaAdmin, transactionId) {
  const { data, error } = await supaAdmin
    .from("report_orders")
    .select("id")
    .eq("provider", "REVENUECAT")
    .eq("provider_transaction_id", transactionId)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

module.exports = { payOrderWithTransaction, transactionInUse, OPEN_ORDER_STATUSES };
