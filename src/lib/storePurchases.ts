// src/lib/storePurchases.ts
// T1.9AE: buying a paid service through the App Store / Google Play via RevenueCat.
// Flow: the server creates the order and names the store product (provider_product_id); the app
// buys that product with RevenueCat (signed in as the Supabase user id, so the server can look it
// up); the server confirms the transaction with RevenueCat before anything is activated.
// Free pilot orders (amount 0) never touch the store.
import { Platform } from "react-native";
import { getRevenueCatApiKey, getRevenueCatPlatform } from "./revenueCatInit";
import { hasRealRevenueCatKey } from "./revenueCatEnv";

export type StorePurchaseErrorCode =
  | "STORE_NOT_READY"
  | "STORE_PRODUCT_NOT_FOUND"
  | "PURCHASE_CANCELLED"
  | "PURCHASE_PENDING"
  | "PURCHASE_FAILED";

export function storeError(code: StorePurchaseErrorCode, cause?: unknown): Error & { code: string; cause?: unknown } {
  return Object.assign(new Error(code), { code, cause });
}

function loadPurchases(): any | null {
  try {
    const mod = require("react-native-purchases");
    return mod?.default ?? mod?.Purchases ?? mod ?? null;
  } catch {
    return null;
  }
}

/** RevenueCat error codes from the SDK mapped to our codes. */
export function mapStoreError(error: any): StorePurchaseErrorCode {
  const code = String(error?.code ?? "");
  if (error?.userCancelled === true || code === "1") return "PURCHASE_CANCELLED";
  if (code === "20") return "PURCHASE_PENDING";
  if (code === "5") return "STORE_PRODUCT_NOT_FOUND";
  if (["11", "16", "23"].includes(code)) return "STORE_NOT_READY";
  return "PURCHASE_FAILED";
}

/** Configure RevenueCat once and make sure it is signed in as this user. */
export async function ensureStoreReady(userId: string): Promise<any> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw storeError("STORE_NOT_READY");
  const Purchases = loadPurchases();
  const apiKey = getRevenueCatApiKey(getRevenueCatPlatform());
  if (!Purchases?.configure || !hasRealRevenueCatKey(apiKey)) throw storeError("STORE_NOT_READY");
  try {
    const configured = await Purchases.isConfigured?.();
    if (!configured) {
      Purchases.configure({ apiKey, appUserID: userId });
    } else {
      const current = await Purchases.getAppUserID?.();
      if (current !== userId) await Purchases.logIn(userId);
    }
    return Purchases;
  } catch (e) {
    throw storeError("STORE_NOT_READY", e);
  }
}

/** Sign RevenueCat out when the user signs out, so the next account does not inherit purchases. */
export async function signOutStore(): Promise<void> {
  const Purchases = loadPurchases();
  try {
    if (Purchases && (await Purchases.isConfigured?.()) && !(await Purchases.isAnonymous?.())) await Purchases.logOut();
  } catch {
    // Nothing to sign out of.
  }
}

/**
 * Buys one store product and returns the store transaction id.
 * Throws an Error whose code is a StorePurchaseErrorCode.
 */
export async function buyStoreProduct(userId: string, storeProductId: string): Promise<string> {
  const Purchases = await ensureStoreReady(userId);
  let product: any = null;
  try {
    const category = Purchases.PRODUCT_CATEGORY?.NON_SUBSCRIPTION ?? "NON_SUBSCRIPTION";
    const products = await Purchases.getProducts([storeProductId], category);
    product = (products || []).find((p: any) => p?.identifier === storeProductId) ?? null;
  } catch (e) {
    throw storeError(mapStoreError(e), e);
  }
  if (!product) throw storeError("STORE_PRODUCT_NOT_FOUND");
  try {
    const result = await Purchases.purchaseStoreProduct(product);
    const fromResult = result?.transaction?.transactionIdentifier;
    if (fromResult) return String(fromResult);
    // Older SDK shapes: newest transaction for this product in the customer info.
    const list: any[] = result?.customerInfo?.nonSubscriptionTransactions ?? [];
    const latest = list
      .filter((t) => t?.productIdentifier === storeProductId)
      .sort((a, b) => Date.parse(b?.purchaseDate || "") - Date.parse(a?.purchaseDate || ""))[0];
    if (latest?.transactionIdentifier) return String(latest.transactionIdentifier);
    throw storeError("PURCHASE_FAILED");
  } catch (e: any) {
    if (e?.code && ["STORE_NOT_READY", "STORE_PRODUCT_NOT_FOUND", "PURCHASE_CANCELLED", "PURCHASE_PENDING", "PURCHASE_FAILED"].includes(e.code)) throw e;
    throw storeError(mapStoreError(e), e);
  }
}
