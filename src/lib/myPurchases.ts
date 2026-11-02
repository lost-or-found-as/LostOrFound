// src/lib/myPurchases.ts
// T1.9X: helpers for "Mine kjøp". Orders come from the server (/report-commerce/my-purchases), so
// services given free in the pilot show up too. Store restore errors are turned into plain text.
import type { TranslationKey } from "../i18n/locales/en";

export type PurchaseRowInput = {
  productCode: string;
  status: string;
  amountOre: number | null;
};

// Product name text key by product code.
export function productNameKey(code: string): TranslationKey {
  const c = String(code || "").toUpperCase();
  if (c.startsWith("GEO_ALERT")) return "purchases.areaAlert";
  if (c.startsWith("LONG_TERM_WATCH")) return "purchases.historicCase";
  if (c === "REPORT_REACTIVATION") return "purchases.extension";
  return "purchases.otherService";
}

// Unpaid or failed orders are not purchases; they are left out of the history.
const HIDDEN_STATUSES = new Set(["PENDING", "AUTHORIZED", "FAILED"]);
export function visibleHistory<T extends PurchaseRowInput>(items: T[]): T[] {
  return items.filter((x) => !HIDDEN_STATUSES.has(String(x.status || "").toUpperCase()));
}

export function isFreePurchase(item: PurchaseRowInput): boolean {
  return !item.amountOre || item.amountOre <= 0;
}

// Status text key for a row in TIDLIGERE.
export function historyStatusKey(status: string): TranslationKey {
  switch (String(status || "").toUpperCase()) {
    case "REFUNDED":
      return "purchases.refunded";
    case "CANCELLED":
      return "purchases.cancelled";
    case "EXPIRED":
      return "purchases.expired";
    default:
      return "purchases.completed";
  }
}

// RevenueCat restore errors. A store that is not set up (wrong or missing key, no products) gives
// codes such as 16 (unknown backend error) or 23 (configuration error); those get the
// "store not connected yet" text instead of "Unknown error (16)".
const STORE_NOT_READY_CODES = new Set(["16", "23", "11", "CONFIGURATION_ERROR", "UNKNOWN_BACKEND_ERROR", "INVALID_CREDENTIALS_ERROR"]);
export function restoreErrorKey(err: unknown): TranslationKey {
  const e = (err ?? {}) as { code?: unknown; message?: unknown; readableErrorCode?: unknown };
  const codes = [e.code, e.readableErrorCode].map((v) => String(v ?? "").toUpperCase());
  const message = String(e.message ?? "").toLowerCase();
  if (codes.some((c) => STORE_NOT_READY_CODES.has(c)) || /api key|configur|credential|singleton/.test(message))
    return "purchases.storeNotReady";
  if (/network|offline|internet/.test(message)) return "purchases.restoreNetwork";
  return "purchases.restoreGeneric";
}
