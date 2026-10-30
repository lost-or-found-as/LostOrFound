"use strict";
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const supaModule = require("../supabaseClient");
const supaAdmin =
  supaModule?.supaAdmin ||
  supaModule?.supabaseAdmin ||
  supaModule?.admin ||
  supaModule?.client ||
  supaModule;
const authModule = require("../mw/auth");
const requireUser = authModule?.requireUser || authModule;
const { calculateGeoAlertQuote } = require("../lib/geoAlertPricing");
const { dispatchAreaAlertCampaign } = require("../lib/geoAlertDispatch");
const {
  isGeoAlertProduct,
  getGeoAlertActivationState,
  geoAlertBlockReason,
  createGeoAlertEntitlement,
  getGeoAlertStatus,
} = require("../lib/geoAlertActivationGuard");
const {
  LONG_TERM_REQUEST_CODE,
  normalizeYears,
  longTermProductCode,
  isLongTermProduct,
  extensionCredits,
  longTermEligibility,
  longTermPeriod,
  longTermQuote,
  isLiveWatch,
} = require("../lib/longTermWatch");
const GEO_ALERT_DURATION_HOURS = 168;
const GEO_ALERT_REMINDER_COUNT = 0;
const VALID_GEO_ALERT_RADII = new Set([
  250, 500, 1000, 1500, 3000, 5000, 10000,
]);

if (!supaAdmin || typeof supaAdmin.from !== "function")
  throw new Error("Supabase admin client unavailable");

function testUsers() {
  return new Set(
    String(process.env.REPORT_COMMERCE_TEST_USER_IDS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}
function testModeAllowed(userId) {
  return (
    String(process.env.REPORT_COMMERCE_TEST_MODE || "").toLowerCase() ===
      "true" && testUsers().has(String(userId))
  );
}
function geoAlertTestUsers() {
  return new Set(
    String(process.env.GEO_ALERT_TEST_USER_IDS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}
function geoAlertTestModeAllowed(userId) {
  return (
    String(process.env.GEO_ALERT_TEST_MODE || "").toLowerCase() === "true" &&
    geoAlertTestUsers().has(String(userId))
  );
}
// T1.8E.5H: an area-alert entitlement without a campaign must not stay live, otherwise it
// would block the report (rule 1) without any alert having been sent.
async function cancelGeoAlertEntitlement(entitlementId, order, userId, reason) {
  const { error } = await supaAdmin
    .from("report_entitlements")
    .update({ status: "CANCELLED" })
    .eq("id", entitlementId);
  console.error("[geo-alert][entitlement-cancelled-after-failure]", {
    orderId: order.id,
    reportId: order.report_id,
    userId,
    entitlementId,
    reason,
    cancelErrorCode: error?.code || null,
    cancelErrorMessage: error?.message || null,
  });
}

async function ownedReport(reportId, userId) {
  const { data, error } = await supaAdmin
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
async function activeProduct(code) {
  const { data, error } = await supaAdmin
    .from("product_catalog")
    .select("*")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
// T1.9H: what a historic-case price depends on: the running watch, paid extensions and
// whether the case has had a historic period before (credit is given once).
async function loadLongTermContext(reportId, userId) {
  const [watchResult, ordersResult] = await Promise.all([
    supaAdmin
      .from("long_term_watches")
      .select("id, status, current_period_end, entitlement_id")
      .eq("report_id", reportId)
      .maybeSingle(),
    supaAdmin
      .from("report_orders")
      .select("product_code, status, paid_at, refunded_at")
      .eq("report_id", reportId)
      .eq("user_id", userId),
  ]);
  if (watchResult.error) throw watchResult.error;
  if (ordersResult.error) throw ordersResult.error;
  const orders = ordersResult.data || [];
  const hadLongTermBefore = orders.some(
    (o) => String(o.product_code || "").startsWith("LONG_TERM_WATCH") && !!o.paid_at && !o.refunded_at,
  );
  return {
    watch: watchResult.data || null,
    credits: extensionCredits(orders, hadLongTermBefore),
    hadLongTermBefore,
  };
}

async function resolveLongTermProduct(report, userId, yearsInput) {
  const years = normalizeYears(yearsInput);
  const context = await loadLongTermContext(report.id, userId);
  const eligibility = longTermEligibility(report, context.watch);
  if (!eligibility.ok) return { error: eligibility.error };
  const credits = eligibility.renew ? 0 : context.credits;
  const [product, fullYearProduct] = await Promise.all([
    activeProduct(longTermProductCode(years, credits)),
    activeProduct(longTermProductCode(years, 0)),
  ]);
  if (!product || !fullYearProduct) return { error: "PRODUCT_NOT_AVAILABLE" };
  const period = longTermPeriod(years, context.watch);
  return {
    years,
    credits,
    renew: eligibility.renew,
    product,
    quote: longTermQuote({ years, credits, product, fullYearProduct, period }),
  };
}

function requestId(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < 12 || v.length > 120)
    throw new Error("CLIENT_REQUEST_ID_INVALID");
  return v;
}

// T1.8E.5I: area-alert status for the report owner (service card and order screen).
router.get("/reports/:reportId/geo-alert-status", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = String(req.params.reportId || "").trim();
    const report = await ownedReport(reportId, userId);
    if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
    const status = await getGeoAlertStatus(reportId);
    return res.json({ ok: true, reportId, ...status });
  } catch (e) {
    console.error("[geo-alert][status-failed]", {
      reportId: req.params?.reportId || null,
      errorCode: e?.code || null,
      errorMessage: e?.message || String(e),
    });
    return res.status(500).json({ error: "GEO_ALERT_STATUS_FAILED" });
  }
});

router.get("/my-purchases", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const ordersResult = await supaAdmin
      .from("report_orders")
      .select(
        "id,report_id,product_code,status,amount_ore,currency,platform,provider,paid_at,created_at,report_entitlements(id,status,starts_at,current_period_end,auto_renews,provider)",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (ordersResult.error)
      return res.status(400).json({ error: ordersResult.error.message });
    const ids = [
      ...new Set(
        (ordersResult.data || []).map((x) => x.report_id).filter(Boolean),
      ),
    ];
    let reports = [];
    if (ids.length) {
      const result = await supaAdmin
        .from("reports")
        .select(
          "id,title,type,status,category,subcategory_key,subcategory_custom,color,brand,location_label,deleted_at",
        )
        .in("id", ids);
      if (result.error)
        return res.status(400).json({ error: result.error.message });
      reports = result.data || [];
    }
    const byId = new Map(reports.map((x) => [x.id, x]));
    const items = (ordersResult.data || []).map((order) => {
      const entitlement =
        (Array.isArray(order.report_entitlements)
          ? order.report_entitlements
          : [])[0] || null;
      return {
        id: order.id,
        reportId: order.report_id,
        productCode: order.product_code,
        status: String(
          entitlement?.status || order.status || "PENDING",
        ).toUpperCase(),
        amountOre: order.amount_ore,
        currency: order.currency,
        platform: order.platform,
        provider: entitlement?.provider || order.provider,
        purchasedAt: order.paid_at || order.created_at,
        startsAt: entitlement?.starts_at || null,
        currentPeriodEnd: entitlement?.current_period_end || null,
        autoRenews: entitlement?.auto_renews === true,
        report: byId.get(order.report_id) || null,
      };
    });
    return res.json({
      activePurchases: items.filter((x) => x.status === "ACTIVE"),
      purchaseHistory: items.filter((x) => x.status !== "ACTIVE"),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error?.message || "PURCHASE_HISTORY_LOAD_FAILED" });
  }
});
router.get("/catalog", requireUser, async (req, res) => {
  try {
    const { data, error } = await supaAdmin
      .from("product_catalog")
      .select(
        "code,name_no,name_en,product_type,billing_period,duration_count,base_price_ore,currency,apple_product_id,google_product_id,metadata",
      )
      .eq("active", true)
      .order("code");
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ products: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

// T1.9H: price for keeping a LOST case as a historic case for 1, 2 or 3 years.
router.post("/long-term/quote", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = String(req.body?.reportId || "");
    const report = await ownedReport(reportId, userId);
    if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
    const resolved = await resolveLongTermProduct(report, userId, req.body?.years);
    if (resolved.error)
      return res.status(resolved.error === "PRODUCT_NOT_AVAILABLE" ? 409 : 400).json({ error: resolved.error });
    return res.json({
      quote: { reportId, renew: resolved.renew, ...resolved.quote },
      note: "TEST_PRICE_NOT_FOR_STORE_RELEASE",
    });
  } catch (e) {
    const code = String(e?.code || e?.message || "");
    if (code === "INVALID_LONG_TERM_YEARS") return res.status(400).json({ error: code });
    console.error("[long-term][quote-failed]", { errorCode: e?.code || null, errorMessage: e?.message || String(e) });
    return res.status(500).json({ error: "LONG_TERM_QUOTE_FAILED" });
  }
});

router.post("/geo-alert/quote", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = String(req.body?.reportId || "");
    const report = await ownedReport(reportId, userId);
    if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
    if (String(report.type).toUpperCase() !== "LOST")
      return res.status(400).json({ error: "GEO_ALERT_REQUIRES_LOST_REPORT" });

    const quote = calculateGeoAlertQuote(req.body || {});
    const product = await activeProduct(quote.productCode);
    if (!product)
      return res.status(409).json({ error: "PRODUCT_NOT_AVAILABLE" });

    const quoteId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + quote.validForMinutes * 60000,
    ).toISOString();
    return res.json({
      quote: {
        quoteId,
        reportId,
        expiresAt,
        ...quote,
        amountOre: product.base_price_ore,
        currency: product.currency,
      },
      note: "TEST_PRICE_NOT_FOR_STORE_RELEASE",
    });
  } catch (e) {
    const code = String(e?.message || "");
    return res
      .status(code.startsWith("INVALID_") ? 400 : 500)
      .json({ error: code || "Server error" });
  }
});

router.post("/orders", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = String(req.body?.reportId || "");
    let productCode = String(req.body?.productCode || "").toUpperCase();
    const clientRequestId = requestId(req.body?.clientRequestId);
    const report = await ownedReport(reportId, userId);
    if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
    if (String(report.type).toUpperCase() !== "LOST")
      return res
        .status(400)
        .json({ error: "PAID_PRODUCTS_REQUIRE_LOST_REPORT" });

    let priceSnapshot = {};
    let geoQuote = null;
    let normalizedGeoAlert = null;
    if (productCode === "GEO_ALERT") {
      const requested = req.body?.geoAlert || {};
      const radiusM = Number(requested.radiusM);
      if (!VALID_GEO_ALERT_RADII.has(radiusM))
        return res.status(400).json({ error: "INVALID_RADIUS" });
      const populationDensityBand = String(
        requested.populationDensityBand || "LOW",
      ).toUpperCase();
      const { data: previewRows, error: previewError } = await supaAdmin.rpc(
        "preview_geo_alert_audience",
        {
          p_report_id: reportId,
          p_user_id: userId,
          p_radius_m: radiusM,
        },
      );
      if (previewError)
        return res.status(400).json({ error: previewError.message });
      const preview = Array.isArray(previewRows) ? previewRows[0] : previewRows;
      if (!preview)
        return res
          .status(404)
          .json({ error: "LOST_REPORT_WITH_LOCATION_NOT_FOUND" });
      normalizedGeoAlert = {
        radiusM,
        areaSqKm: Number(preview.area_sq_km),
        populationDensityBand,
        estimatedEligibleUsers: Number(preview.eligible_users || 0),
        estimatedEligibleInstallations: Number(
          preview.eligible_installations || 0,
        ),
        durationHours: GEO_ALERT_DURATION_HOURS,
        reminderCount: GEO_ALERT_REMINDER_COUNT,
      };
      geoQuote = calculateGeoAlertQuote(normalizedGeoAlert);
      productCode = geoQuote.productCode;
      priceSnapshot = geoQuote.priceSnapshot;
    }

    // T1.9H: the app asks for LONG_TERM_WATCH and a number of years; the server picks the
    // product variant (with or without credit for paid extensions).
    let longTermRequest = null;
    if (productCode === LONG_TERM_REQUEST_CODE) {
      const resolved = await resolveLongTermProduct(report, userId, req.body?.longTerm?.years);
      if (resolved.error)
        return res.status(resolved.error === "PRODUCT_NOT_AVAILABLE" ? 409 : 400).json({ error: resolved.error });
      productCode = resolved.product.code;
      priceSnapshot = { long_term: resolved.quote };
      longTermRequest = { years: resolved.years, credits: resolved.credits, renew: resolved.renew };
    } else if (isLongTermProduct(productCode)) {
      return res.status(400).json({ error: "LONG_TERM_PRODUCT_REQUIRES_YEARS" });
    }

    const product = await activeProduct(productCode);
    if (!product)
      return res.status(404).json({ error: "PRODUCT_NOT_AVAILABLE" });

    const payload = {
      user_id: userId,
      report_id: reportId,
      product_code: productCode,
      status: "PENDING",
      amount_ore: product.base_price_ore,
      currency: product.currency,
      platform: String(req.body?.platform || "TEST").toUpperCase(),
      provider: String(req.body?.provider || "TEST").toUpperCase(),
      client_request_id: clientRequestId,
      provider_product_id: req.body?.providerProductId || null,
      price_snapshot: {
        ...priceSnapshot,
        catalog_price_ore: product.base_price_ore,
        catalog_currency: product.currency,
      },
      request_payload: {
        occurredPrecision: req.body?.occurredPrecision || null,
        occurredYear: req.body?.occurredYear || null,
        occurredMonth: req.body?.occurredMonth || null,
        geoAlert: normalizedGeoAlert || req.body?.geoAlert || null,
        longTerm: longTermRequest,
      },
    };

    const { data: existing } = await supaAdmin
      .from("report_orders")
      .select("*")
      .eq("user_id", userId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing) return res.json({ order: existing, idempotentReplay: true });

    // T1.8E.5H: refuse a new area-alert order while one is live or the limit is reached.
    if (isGeoAlertProduct(productCode)) {
      const geoAlertState = await getGeoAlertActivationState(reportId);
      const block = geoAlertBlockReason(geoAlertState);
      if (block) {
        console.info("[geo-alert][order-blocked]", { reportId, userId, ...block });
        return res.status(409).json(block);
      }
    }

    const { data, error } = await supaAdmin
      .from("report_orders")
      .insert(payload)
      .select("*")
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ order: data, idempotentReplay: false });
  } catch (e) {
    const code = String(e?.code || e?.message || "");
    return res
      .status(code === "CLIENT_REQUEST_ID_INVALID" || code === "INVALID_LONG_TERM_YEARS" ? 400 : 500)
      .json({ error: code || "Server error" });
  }
});

router.get("/orders/:id", requireUser, async (req, res) => {
  try {
    const { data, error } = await supaAdmin
      .from("report_orders")
      .select("*, report_entitlements(*)")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    return res.json({ order: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

router.post("/orders/:id/test-activate", requireUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { data: order, error: oErr } = await supaAdmin
      .from("report_orders")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (oErr) return res.status(400).json({ error: oErr.message });
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    const isGeoAlertOrder = String(order.product_code || "").startsWith(
      "GEO_ALERT_TIER_",
    );
    const activationAllowed =
      testModeAllowed(userId) ||
      (isGeoAlertOrder && geoAlertTestModeAllowed(userId));
    if (!activationAllowed)
      return res.status(403).json({ error: "TEST_ACTIVATION_NOT_ALLOWED" });
    if (["ACTIVE", "REFUNDED", "CANCELLED"].includes(order.status)) {
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
    }

    // T1.8E.5J: only orders that are still open can be activated. Expired, superseded and
    // failed orders (for example PENDING orders expired by process_commerce_expiry) stop here.
    if (!["PENDING", "AUTHORIZED", "PAID"].includes(String(order.status || "").toUpperCase())) {
      console.info("[commerce][activation-refused-order-closed]", {
        orderId: order.id,
        reportId: order.report_id,
        userId,
        orderStatus: order.status,
      });
      return res.status(409).json({ error: "ORDER_NOT_ACTIVATABLE", orderStatus: order.status });
    }

    const report = await ownedReport(order.report_id, userId);
    if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
    const now = new Date();
    let periodEnd = null;
    let autoRenews = false;
    let longTermStart = null;
    if (order.product_code === "LONG_TERM_WATCH_ANNUAL") {
      periodEnd = new Date(now);
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
      autoRenews = true;
    } else if (order.product_code === "REPORT_REACTIVATION") {
      periodEnd = new Date(now.getTime() + 30 * 86400000);
    } else if (order.product_code.startsWith("GEO_ALERT_TIER_")) {
      periodEnd = new Date(now.getTime() + GEO_ALERT_DURATION_HOURS * 3600000);
    } else if (isLongTermProduct(order.product_code)) {
      // T1.9H: a renewal continues from the end of the running period.
      const context = await loadLongTermContext(order.report_id, userId);
      const years = Number(order.request_payload?.longTerm?.years || 0) || 1;
      const period = longTermPeriod(years, context.watch, now.getTime());
      longTermStart = new Date(period.startsAt);
      periodEnd = new Date(period.endsAt);
    } else return res.status(400).json({ error: "UNSUPPORTED_PRODUCT" });

    const providerTransactionId =
      order.provider_transaction_id || `test_${crypto.randomUUID()}`;
    let entitlement = null;
    if (isGeoAlertProduct(order.product_code)) {
      // T1.8E.5H: rules 1 and 2 are enforced atomically in the database.
      const guarded = await createGeoAlertEntitlement({
        orderId: order.id,
        userId,
        startsAt: now.toISOString(),
        periodEnd: periodEnd.toISOString(),
        provider: "TEST",
        providerTransactionId,
        metadata: { test_activation: true },
      });
      if (guarded.rejection) {
        console.info("[geo-alert][activation-blocked]", {
          orderId: order.id,
          reportId: order.report_id,
          userId,
          ...guarded.rejection,
        });
        return res.status(409).json(guarded.rejection);
      }
      if (guarded.error)
        return res.status(400).json({ error: guarded.error.message || "GEO_ALERT_ENTITLEMENT_FAILED" });
      entitlement = guarded.entitlement;
    } else {
      const { data: inserted, error: eErr } = await supaAdmin
        .from("report_entitlements")
        .insert({
          user_id: userId,
          report_id: order.report_id,
          product_code: order.product_code,
          order_id: order.id,
          status: "ACTIVE",
          starts_at: (longTermStart || now).toISOString(),
          current_period_end: periodEnd.toISOString(),
          auto_renews: autoRenews,
          provider: "TEST",
          provider_original_transaction_id: providerTransactionId,
          metadata: { test_activation: true },
        })
        .select("*")
        .single();
      if (eErr) return res.status(400).json({ error: eErr.message });
      entitlement = inserted;
    }

    if (order.product_code === "LONG_TERM_WATCH_ANNUAL") {
      const rp = order.request_payload || {};
      await supaAdmin.from("long_term_watches").upsert(
        {
          user_id: userId,
          report_id: order.report_id,
          entitlement_id: entitlement.id,
          status: "ACTIVE",
          loss_date_precision: rp.occurredPrecision || "EXACT",
          loss_year: rp.occurredYear || null,
          loss_month: rp.occurredMonth || null,
          starts_at: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          next_match_scan_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "report_id" },
      );
      await supaAdmin
        .from("reports")
        .update({
          long_term_candidate: true,
          occurred_precision: rp.occurredPrecision || "EXACT",
          occurred_year: rp.occurredYear || null,
          occurred_month: rp.occurredMonth || null,
        })
        .eq("id", order.report_id)
        .eq("user_id", userId);
    }

    if (isLongTermProduct(order.product_code)) {
      // T1.9H: the case stays active (and in matching at any age) until the watch ends.
      const { data: existingWatch } = await supaAdmin
        .from("long_term_watches")
        .select("starts_at, status, current_period_end")
        .eq("report_id", order.report_id)
        .maybeSingle();
      const keepStart = isLiveWatch(existingWatch, now.getTime()) && existingWatch?.starts_at;
      const watchResult = await supaAdmin.from("long_term_watches").upsert(
        {
          user_id: userId,
          report_id: order.report_id,
          entitlement_id: entitlement.id,
          status: "ACTIVE",
          loss_date_precision: report.occurred_precision || "EXACT",
          loss_year: report.occurred_year || null,
          loss_month: report.occurred_month || null,
          starts_at: keepStart ? existingWatch.starts_at : now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          next_match_scan_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "report_id" },
      );
      if (watchResult.error) {
        console.error("[long-term][watch-upsert-failed]", {
          orderId: order.id,
          reportId: order.report_id,
          errorCode: watchResult.error.code || null,
          errorMessage: watchResult.error.message || String(watchResult.error),
        });
        return res.status(400).json({ error: "LONG_TERM_ACTIVATION_FAILED" });
      }
      const reportUpdate = await supaAdmin
        .from("reports")
        .update({
          status: "ACTIVE",
          visible_until: periodEnd.toISOString(),
          archived_at: null,
          long_term_candidate: true,
        })
        .eq("id", order.report_id)
        .eq("user_id", userId);
      if (reportUpdate.error) {
        console.error("[long-term][report-update-failed]", {
          orderId: order.id,
          reportId: order.report_id,
          errorCode: reportUpdate.error.code || null,
          errorMessage: reportUpdate.error.message || String(reportUpdate.error),
        });
        return res.status(400).json({ error: "LONG_TERM_ACTIVATION_FAILED" });
      }
      try {
        // Compare with every active find, not only the last 30 days.
        await supaAdmin.rpc("refresh_matches_for_report", {
          p_report_id: order.report_id,
          p_candidate_limit: 50,
          p_max_distance_m: 3000,
          p_max_age_days: 365,
          p_min_score: 65,
          p_time_buffer_hours: 48,
        });
      } catch (e) {
        console.warn("[long-term] match refresh failed", e?.message || e);
      }
    }

    if (order.product_code === "REPORT_REACTIVATION") {
      await supaAdmin
        .from("reports")
        .update({
          status: "ACTIVE",
          visible_until: periodEnd.toISOString(),
          archived_at: null,
          closed_at: null,
        })
        .eq("id", order.report_id)
        .eq("user_id", userId);
      try {
        await supaAdmin.rpc("refresh_matches_for_report", {
          p_report_id: order.report_id,
          p_candidate_limit: 50,
          p_max_distance_m: 3000,
          p_max_age_days: 30,
          p_min_score: 65,
          p_time_buffer_hours: 48,
        });
      } catch (e) {
        console.warn("[commerce] match refresh failed", e?.message || e);
      }
    }

    if (order.product_code.startsWith("GEO_ALERT_TIER_")) {
      const g = order.request_payload?.geoAlert || {};
      if (report.lat == null || report.lng == null) {
        await cancelGeoAlertEntitlement(entitlement.id, order, userId, "REPORT_LOCATION_REQUIRED");
        return res
          .status(400)
          .json({ error: "GEO_ALERT_REPORT_LOCATION_REQUIRED" });
      }
      const campaignPoint =
        "SRID=4326;POINT(" +
        Number(report.lng) +
        " " +
        Number(report.lat) +
        ")";
      const { data: createdCampaign, error: campaignError } = await supaAdmin
        .from("geo_alert_campaigns")
        .insert({
          user_id: userId,
          report_id: order.report_id,
          order_id: order.id,
          status: "ACTIVE",
          geometry_type: "CIRCLE",
          geometry: campaignPoint,
          radius_m: Number(g.radiusM || 1500),
          area_sq_km: Number(g.areaSqKm || 0.01),
          population_density_band: String(
            g.populationDensityBand || "LOW",
          ).toUpperCase(),
          estimated_eligible_users: Number(g.estimatedEligibleUsers || 0),
          duration_hours: GEO_ALERT_DURATION_HOURS,
          reminder_count: GEO_ALERT_REMINDER_COUNT,
          price_tier: order.product_code,
          price_snapshot: order.price_snapshot || {},
          starts_at: now.toISOString(),
          ends_at: periodEnd.toISOString(),
          activated_at: now.toISOString(),
        })
        .select("id")
        .single();

      // T1.8E.5H: every activation gets its own campaign. Rules 1 and 2 were enforced
      // when the entitlement was created, so no campaign reuse is attempted here.
      if (campaignError || !createdCampaign?.id) {
        console.error("[geo-alert][campaign-create-failed]", {
          orderId: order.id,
          reportId: order.report_id,
          userId,
          productCode: order.product_code,
          errorCode: campaignError?.code || null,
          errorMessage: campaignError?.message || "Campaign was not created",
          errorDetails: campaignError?.details || null,
          errorHint: campaignError?.hint || null,
        });
        await cancelGeoAlertEntitlement(entitlement.id, order, userId, "CAMPAIGN_CREATE_FAILED");
        return res.status(400).json({ error: "GEO_ALERT_CAMPAIGN_CREATE_FAILED" });
      }
      order.created_campaign_id = createdCampaign.id;
    }

    const { data: updatedOrder, error: uErr } = await supaAdmin
      .from("report_orders")
      .update({
        status: "ACTIVE",
        paid_at: now.toISOString(),
        updated_at: now.toISOString(),
        provider_transaction_id: providerTransactionId,
        entitlement_id: entitlement.id,
      })
      .eq("id", order.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (uErr) {
      console.error("[geo-alert][order-activation-failed]", {
        orderId: order.id,
        reportId: order.report_id,
        userId,
        campaignId: order.created_campaign_id || null,
        errorCode: uErr.code || null,
        errorMessage: uErr.message || String(uErr),
        errorDetails: uErr.details || null,
      });
      return res
        .status(400)
        .json({ error: "GEO_ALERT_ORDER_ACTIVATION_FAILED" });
    }
    // T1.8E.5H: an area-alert activation supersedes every earlier live area-alert order for
    // the report, regardless of tier. Other products keep exact product matching.
    let supersedeQuery = supaAdmin
      .from("report_orders")
      .update({ status: "SUPERSEDED", updated_at: now.toISOString() })
      .eq("report_id", order.report_id)
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .neq("id", order.id);
    supersedeQuery = isGeoAlertProduct(order.product_code)
      ? supersedeQuery.like("product_code", "GEO_ALERT_TIER_%")
      : supersedeQuery.eq("product_code", order.product_code);
    // T1.9H: historic periods add up (a renewal follows the running period), so they never
    // supersede each other.
    const { data: supersededOrders, error: supersedeError } = isLongTermProduct(order.product_code)
      ? { data: [], error: null }
      : await supersedeQuery.select("id");

    if (supersedeError) {
      console.error("[geo-alert][previous-orders-supersede-failed]", {
        orderId: order.id,
        reportId: order.report_id,
        userId,
        errorCode: supersedeError.code || null,
        errorMessage: supersedeError.message || String(supersedeError),
      });
    } else {
      console.info("[geo-alert][previous-orders-superseded]", {
        orderId: order.id,
        reportId: order.report_id,
        userId,
        count: supersededOrders?.length || 0,
      });
    }

    let areaAlertDispatch = null;
    if (order.created_campaign_id) {
      try {
        areaAlertDispatch = await dispatchAreaAlertCampaign(
          order.created_campaign_id,
        );
        console.info("[geo-alert][dispatch-complete]", {
          orderId: order.id,
          reportId: order.report_id,
          userId,
          campaignId: order.created_campaign_id,
          dispatch: areaAlertDispatch,
        });
      console.info("[geo-alert][activation-delivery-result]", {
          orderId: order.id,
          reportId: order.report_id,
          userId,
          campaignId: order.created_campaign_id,
          delivery: areaAlertDispatch,
        });
        } catch (dispatchError) {
        console.error(
          "[commerce] area alert dispatch failed",
          dispatchError?.message || dispatchError,
        );
        areaAlertDispatch = { ok: false, error: "AREA_ALERT_DISPATCH_FAILED" };
      }
    }
    return res.json({
      order: updatedOrder,
      entitlement,
      campaignId: order.created_campaign_id || null,
      areaAlertDispatch,
      testActivation: true,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

module.exports = router;
