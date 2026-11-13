// src/lib/areaVisibility.ts
// T1.9AM: «Synlig i nærheten» – pure helpers for the order screen and the case screen.
import type { TranslationKey } from "../i18n/locales/en";
import type { GeoAlertStatus } from "./areaAlertStatus";

/** Radii the owner can pick (all accepted by the server). */
export const VISIBILITY_RADII = [500, 1000, 1500, 3000, 5000] as const;

/** A heading for a known server answer, or null for the general error text. */
export function visibilityNoticeKey(code: string): TranslationKey | null {
  const upper = String(code || "").toUpperCase();
  if (upper.includes("AREA_VISIBILITY_ALREADY_ACTIVE")) return "areaVisibility.alreadyTitle";
  if (upper.includes("PRODUCT_NOT_AVAILABLE")) return "areaAlertCreate.errorNotAvailableTitle";
  return null;
}

/**
 * What the case screen offers under «Få flere til å se etter».
 *   visibility – «Synlig i nærheten» can be bought (nothing makes the case visible now);
 *   alert – the area-alert option belongs in this card (no area alert yet; once one has been
 *           used, the area-alert service card handles it);
 *   visibleUntil – visibility that is running, bought on its own.
 * A running area alert already includes visibility, so then nothing is offered here.
 */
export function reachOffer(
  status: GeoAlertStatus | null,
  now = Date.now(),
): { visibility: boolean; alert: boolean; visibleUntil: string | null } {
  const until = status?.visibility?.activeUntil || null;
  const live = !!until && Date.parse(until) > now;
  if (live && status?.visibility?.viaAreaAlert) return { visibility: false, alert: false, visibleUntil: null };
  const alert = !status || (Number(status.activationCount || 0) === 0 && !status.activeUntil);
  return { visibility: !live, alert, visibleUntil: live ? until : null };
}
