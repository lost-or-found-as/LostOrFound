"use strict";
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const commerce = fs.readFileSync(path.join(root, "server", "routes", "reportCommerce.js"), "utf8");
const client = fs.readFileSync(path.join(root, "src", "lib", "reportCommerce.ts"), "utf8");
for (const marker of [
  "[geo-alert][activation-replay-normalized]",
  'select("id,status,ends_at")',
  "entitlement: existingEntitlement || null",
  "idempotentReplay: true",
]) if (!commerce.includes(marker)) throw new Error(`MISSING_SERVER_MARKER: ${marker}`);
for (const marker of [
  "reconcileSuccessfulAreaAlertActivation",
  "AREA_ALERT_ACTIVATION_RESPONSE_INCOMPLETE",
  "reconciledAfterError: true",
  "activeEntitlementFromOrder",
]) if (!client.includes(marker)) throw new Error(`MISSING_CLIENT_MARKER: ${marker}`);
if (!client.includes("throw originalError")) throw new Error("ORIGINAL_ERROR_NOT_PRESERVED");
console.log("OK: T1.8E.5F checks passed.");
