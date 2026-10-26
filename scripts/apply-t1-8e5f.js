"use strict";
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const commercePath = path.join(root, "server", "routes", "reportCommerce.js");
const clientPath = path.join(root, "src", "lib", "reportCommerce.ts");
for (const p of [commercePath, clientPath]) if (!fs.existsSync(p)) throw new Error(`REQUIRED_FILE_NOT_FOUND: ${p}`);

function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  return source.replace(oldText, newText);
}

let commerce = fs.readFileSync(commercePath, "utf8");
if (!commerce.includes("[geo-alert][activation-replay-normalized]")) {
  commerce = replaceOnce(
    commerce,
    '    if (["ACTIVE", "REFUNDED", "CANCELLED"].includes(order.status))\n      return res.json({ order, idempotentReplay: true });',
    `    if (["ACTIVE", "REFUNDED", "CANCELLED"].includes(order.status)) {
      const { data: existingEntitlement, error: existingEntitlementError } =
        await supaAdmin
          .from("report_entitlements")
          .select("*")
          .eq("order_id", order.id)
          .eq("user_id", userId)
          .maybeSingle();
      if (existingEntitlementError) {
        console.error("[geo-alert][activation-replay-entitlement-load-failed]", {
          orderId: order.id,
          userId,
          errorCode: existingEntitlementError.code || null,
          errorMessage: existingEntitlementError.message || String(existingEntitlementError),
        });
      }
      const { data: existingCampaign, error: existingCampaignError } =
        await supaAdmin
          .from("geo_alert_campaigns")
          .select("id,status,ends_at")
          .eq("order_id", order.id)
          .maybeSingle();
      if (existingCampaignError) {
        console.error("[geo-alert][activation-replay-campaign-load-failed]", {
          orderId: order.id,
          userId,
          errorCode: existingCampaignError.code || null,
          errorMessage: existingCampaignError.message || String(existingCampaignError),
        });
      }
      console.info("[geo-alert][activation-replay-normalized]", {
        orderId: order.id,
        userId,
        orderStatus: order.status,
        campaignId: existingCampaign?.id || null,
      });
      return res.json({
        order,
        entitlement: existingEntitlement || null,
        campaignId: existingCampaign?.id || null,
        campaign: existingCampaign || null,
        areaAlertDispatch: null,
        testActivation: true,
        idempotentReplay: true,
      });
    }`,
    "normalize active activation replay"
  );
}
fs.writeFileSync(commercePath, commerce, "utf8");

let client = fs.readFileSync(clientPath, "utf8");
if (!client.includes("reconcileSuccessfulAreaAlertActivation")) {
  client = replaceOnce(
    client,
    `export function activateTestReportOrder(orderId: string) {
  return request<TestOrderActivationResult>(\`/orders/\${encodeURIComponent(orderId)}/test-activate\`, { method: "POST" });
}`,
    `function activeEntitlementFromOrder(order: any) {
  const rows = Array.isArray(order?.report_entitlements)
    ? order.report_entitlements
    : [];
  return rows.find((item: any) => String(item?.status || "").toUpperCase() === "ACTIVE") || rows[0] || null;
}

async function reconcileSuccessfulAreaAlertActivation(orderId: string, originalError: unknown) {
  try {
    const current = await fetchReportOrder(orderId);
    const order = current?.order;
    const status = String(order?.status || "").toUpperCase();
    const entitlement = activeEntitlementFromOrder(order);
    if (status === "ACTIVE" && entitlement?.current_period_end) {
      return {
        order,
        entitlement,
        campaignId: null,
        areaAlertDispatch: null,
        testActivation: true as const,
        reconciledAfterError: true,
      };
    }
  } catch {
    // Preserve the original activation error if reconciliation is unavailable.
  }
  throw originalError;
}

export async function activateTestReportOrder(orderId: string) {
  try {
    const result = await request<TestOrderActivationResult>(
      \`/orders/\${encodeURIComponent(orderId)}/test-activate\`,
      { method: "POST" },
    );
    if (
      String(result?.order?.status || "").toUpperCase() === "ACTIVE" &&
      result?.entitlement?.current_period_end
    ) {
      return result;
    }
    return reconcileSuccessfulAreaAlertActivation(
      orderId,
      new Error("AREA_ALERT_ACTIVATION_RESPONSE_INCOMPLETE"),
    );
  } catch (error) {
    return reconcileSuccessfulAreaAlertActivation(orderId, error);
  }
}`,
    "add activation reconciliation"
  );
}
fs.writeFileSync(clientPath, client, "utf8");
console.log("OK: Applied T1.8E.5F false area-alert error fix.");
