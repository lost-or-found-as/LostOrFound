import { API_BASE_URL } from "./config";
import { supabase } from "./supabase";

export type GeoAlertPreviewInput = {
  reportId: string;
  // T1.9BG: an area alert sends places (place, route, area); «Synlig i nærheten» a radius.
  radiusM?: number;
  places?: Array<{ kind: string; radiusMeters: number | null; points: Array<{ latitude: number; longitude: number }> }>;
  durationHours: 24 | 72 | 168;
  reminderCount: 0 | 1 | 2;
  populationDensityBand?: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  // T1.9AM: VISIBILITY prices «Synlig i nærheten» by the people who follow the area.
  kind?: "ALERT" | "VISIBILITY";
};

export type GeoAlertPreviewResult = {
  ok: true;
  preview: {
    reportId: string;
    latitude: number;
    longitude: number;
    radiusM: number | null;
    areaSqKm: number;
    categoryKey: string;
    durationHours: number;
    reminderCount: number;
    populationDensityBand: string;
  };
  quote: {
    productCode: string;
    tier: number;
    amountOre: number;
    // T1.9T: list price, free during the pilot, and the push recipients as a band.
    listPriceOre: number;
    pilotFree: boolean;
    recipients: RecipientBand;
    currency: string;
    validForMinutes: number;
    priceSnapshot: Record<string, unknown>;
  };
  note: string;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("AUTH_REQUIRED");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function previewGeoAlert(input: GeoAlertPreviewInput): Promise<GeoAlertPreviewResult> {
  const response = await fetch(`${API_BASE_URL}/geo-alert-preview`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP_${response.status}_INVALID_RESPONSE`); }
  if (!response.ok) throw new Error(data?.error || `HTTP_${response.status}`);
  return data as GeoAlertPreviewResult;
}

// T1.9BF: how many get the alert, as a wide range ("10–50"). Builds the text from min/max, and
// falls back to the rounded value from servers before T1.9BF.
export type RecipientBand = { kind: "NONE" | "FEW" | "ABOUT"; value: number; min?: number; max?: number | null };

export function recipientRange(band: RecipientBand | null | undefined): { min: number; max: number | null } | null {
  if (!band || band.kind !== "ABOUT") return null;
  if (typeof band.min === "number") return { min: band.min, max: typeof band.max === "number" ? band.max : null };
  return { min: band.value, max: band.value };
}

/** Text for a range band: "{{min}}–{{max}} …" or "Over {{min}} …". */
export function rangeText(
  band: RecipientBand,
  t: (key: any, params?: Record<string, string | number>) => string,
  rangeKey: string,
  overKey: string,
): string {
  const r = recipientRange(band);
  if (!r) return "";
  return r.max === null ? t(overKey, { min: r.min }) : t(rangeKey, { min: r.min, max: r.max });
}
