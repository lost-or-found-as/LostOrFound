// C:\RN\RepairLostOrFound\server\index.js
"use strict";

const path = require("path");
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

// Lås dotenv til server/.env (ikke repo-root)
require("dotenv").config({ path: path.join(__dirname, ".env") });

// ---- Konfig ----
const PORT = Number(process.env.PORT || 4242);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("[CONFIG] STRIPE_SECRET_KEY mangler i server/.env");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Enkel request-logg
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

function nokToOre(nok) {
  const n = Number(nok);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Ugyldig beløp");
  return Math.round(n * 100);
}

// ---- Diagnostikk ----
app.get("/__whoami", (_req, res) => {
  res.json({
    ok: true,
    cwd: process.cwd(),
    serverDir: __dirname,
    pid: process.pid,
    port: PORT,
    time: new Date().toISOString(),
  });
});

// Health/root
app.get("/", (_req, res) => res.json({ ok: true, message: "Server OK" }));

app.get("/payment-sheet", (_req, res) =>
  res.status(405).json({ ok: false, error: "Use POST /payment-sheet" })
);

// T1.9A: was reachable without login and created Stripe objects for anyone.
const { requireUser: requirePaymentUser } = require("./mw/auth");
app.post("/payment-sheet", requirePaymentUser, async (req, res) => {
  try {
    const { amountNok = 50 } = req.body || {};
    const customer = await stripe.customers.create();
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2024-06-20" }
    );
    const paymentIntent = await stripe.paymentIntents.create({
      amount: nokToOre(amountNok),
      currency: "nok",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (err) {
    console.error("[POST /payment-sheet] Error:", err);
    res.status(400).json({ ok: false, error: err?.message ?? "Ukjent feil" });
  }
});

// ---- Mount /storage ----
try {
  const storageRoutes = require("./routes/storage");
  app.use("/storage", storageRoutes);
  console.log("[BOOT] Mounted /storage routes");
} catch (e) {
  console.warn("[BOOT] /storage NOT mounted. Reason:");
  console.warn(e?.stack || e?.message || e);
  app.use("/storage", (_req, res) => {
    res.status(503).json({
      ok: false,
      error: "Storage routes not configured on server",
      devError: process.env.NODE_ENV === "production" ? undefined : (e?.message || String(e)),
      hint:
        "Sjekk at server/routes/storage.js kan lastes og at server/.env har SUPABASE_URL + SUPABASE_SERVICE_ROLE",
    });
  });
}


// ---- Mount /notifications ----
try {
  const notificationsRoutes = require("./routes/notifications");
  app.use("/notifications", notificationsRoutes);
  console.log("[BOOT] Mounted /notifications routes");
} catch (e) {
  console.warn("[BOOT] /notifications NOT mounted:", e?.message ?? e);
}
// ---- Mount /reports ----
try {
  const reportsRoutes = require("./routes/reports");
  app.use("/reports", reportsRoutes);
  console.log("[BOOT] Mounted /reports routes");
} catch (e) {
  console.warn("[BOOT] /reports NOT mounted:", e?.message || e);
}

// ---- Mount /reports (mine/with-activity) ----
try {
  const reportsActivityRoutes = require("./routes/reportsActivity");
  app.use("/reports", reportsActivityRoutes);
  console.log("[BOOT] Mounted /reports mine/with-activity routes");
} catch (e) {
  console.warn("[BOOT] /reportsActivity NOT mounted:", e?.message || e);
}

// ---- Mount /report images ----
try {
  const reportImagesRoutes = require("./routes/reportImages");
  app.use("/reports", reportImagesRoutes);
  console.log("[BOOT] Mounted /reports/:id/images routes");
} catch (e) {
  console.warn("[BOOT] /reports/:id/images NOT mounted:", e?.message || e);
}

// ---- Mount /matches ----
try {
  const matchesRoutes = require("./routes/matches");
  app.use("/matches", matchesRoutes);
  console.log("[BOOT] Mounted /matches routes");
} catch (e) {
  console.warn("[BOOT] /matches NOT mounted:", e?.message || e);
}

// ---- Mount /report-commerce ----
try {
  const reportCommerceRoutes = require("./routes/reportCommerce");
  app.use("/report-commerce", reportCommerceRoutes);
  console.log("[BOOT] Mounted /report-commerce routes");
} catch (e) {
  console.warn("[BOOT] /report-commerce NOT mounted:", e?.message || e);
}

// ---- Mount /push ----
try {
  const pushRoutes = require("./routes/push");
  app.use("/push", pushRoutes);
  console.log("[BOOT] Mounted /push routes");
} catch (e) {
  console.warn("[BOOT] /push NOT mounted:", e?.message || e);
}

// ---- Mount /alert-areas ----
try {
  const alertAreasRoutes = require("./routes/alertAreas");
  app.use("/alert-areas", alertAreasRoutes);
  console.log("[BOOT] Mounted /alert-areas routes");
} catch (e) {
  console.warn("[BOOT] /alert-areas NOT mounted:", e?.message || e);
}

// ---- Mount /geo-alert-delivery ----
try {
  const geoAlertDeliveryRoutes = require("./routes/geoAlertDelivery");
  app.use("/geo-alert-delivery", geoAlertDeliveryRoutes);
  console.log("[BOOT] Mounted /geo-alert-delivery routes");
} catch (e) {
  console.warn("[BOOT] /geo-alert-delivery NOT mounted:", e?.message || e);
}

// ---- Mount /geo-alert-preview ----
try {
  const geoAlertPreviewRoutes = require("./routes/geoAlertPreview");
  app.use("/geo-alert-preview", geoAlertPreviewRoutes);
  console.log("[BOOT] Mounted /geo-alert-preview routes");
} catch (e) {
  console.warn("[BOOT] /geo-alert-preview NOT mounted:", e?.message || e);
}


// ---- Mount /observations ----
try {
  const observationRoutes = require("./routes/observations");
  app.use("/observations", observationRoutes);
  console.log("[BOOT] Mounted /observations routes");
} catch (e) {
  console.warn("[BOOT] /observations NOT mounted:", e?.message || e);
}

// ---- Mount /observation-chat ----
try {
  const observationChatRoutes = require("./routes/observationChat");
  app.use("/observation-chat", observationChatRoutes);
  console.log("[BOOT] Mounted /observation-chat routes");
} catch (e) {
  console.warn("[BOOT] /observation-chat NOT mounted:", e?.message || e);
}

// ---- Mount /account ----
try {
  const accountRoutes = require("./routes/account");
  app.use("/account", accountRoutes);
  console.log("[BOOT] Mounted /account routes");
} catch (e) {
  console.warn("[BOOT] /account NOT mounted:", e?.message || e);
}

// ---- Mount /resolutions ----
try { const resolutionRoutes=require("./routes/resolutions"); app.use("/resolutions",resolutionRoutes); console.log("[BOOT] Mounted /resolutions routes"); } catch(e){ console.warn("[BOOT] /resolutions NOT mounted:",e?.message||e); }

// ---- Mount /geo ----
try {
  const geoRoutes = require("./routes/geo");
  app.use("/geo", geoRoutes);
  console.log("[BOOT] Mounted /geo routes");
} catch (e) {
  console.warn("[BOOT] /geo NOT mounted:", e?.message || e);
}

app.listen(PORT, () => {
  console.log(`Server kjører på http://127.0.0.1:${PORT}`);
  console.log(`[BOOT] cwd=${process.cwd()}`);
  console.log(`[BOOT] serverDir=${__dirname}`);
});
