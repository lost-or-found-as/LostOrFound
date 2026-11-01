// T1.9R: links to the public privacy policy and terms (served by the backend under /legal).
// EXPO_PUBLIC_LEGAL_BASE_URL can point them elsewhere later (for example https://lostorfound.app).
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "./config";

export type LegalDoc = "privacy" | "terms";

export function legalUrl(doc: LegalDoc, language: "no" | "en"): string {
  const base = (process.env.EXPO_PUBLIC_LEGAL_BASE_URL || "").trim() || API_BASE_URL;
  return `${base.replace(/\/+$/, "")}/legal/${doc}?lang=${language}`;
}

export function openLegal(doc: LegalDoc, language: "no" | "en") {
  return WebBrowser.openBrowserAsync(legalUrl(doc, language)).catch(() => null);
}
