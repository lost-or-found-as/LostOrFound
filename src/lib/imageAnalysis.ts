// src/lib/imageAnalysis.ts
// T1.9AI: asks the server what a registration photo shows. T1.9AW: all photos of the registration
// (up to three) go together, so a photo of a label can add brand and size. The photo is shrunk to a small JPEG
// first (about 60-150 KB). Every failure returns null: the screen then simply shows the search,
// so registration never depends on the analysis.
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./config";

export type PhotoAlternative = { key: string; category: string | null };
export type PhotoSuggestion = {
  status: "OK" | "UNSURE" | "NO_ITEM";
  category: string | null;
  item: string | null;
  colors: string[];
  brand: string | null;
  // T1.9AW: a size read from a label, as written ("M", "38").
  size: string | null;
  alternatives: PhotoAlternative[];
};

const TIMEOUT_MS = 25000;
const MAX_PHOTOS = 3;

/** Small JPEG as base64 for the analysis (not the stored photo). */
async function analysisImage(uri: string): Promise<string | null> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 768 } }], {
    compress: 0.6,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return out.base64 ?? null;
}

/** The server's suggestion for one photo, or null (any error, limit or switch off). */
export async function analyzeReportPhoto(uri: string): Promise<PhotoSuggestion | null> {
  return analyzeReportPhotos([uri]);
}

/** T1.9AW: the server's suggestion for the photos of one item together, or null. */
export async function analyzeReportPhotos(uris: string[]): Promise<PhotoSuggestion | null> {
  try {
    const images: string[] = [];
    for (const uri of uris.slice(0, MAX_PHOTOS)) {
      const image = await analysisImage(uri);
      if (image) images.push(image);
    }
    if (!images.length) return null;
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}/image-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ images }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return toSuggestion(data);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Shapes the server answer; anything unexpected becomes null. */
export function toSuggestion(data: any): PhotoSuggestion | null {
  const status = data?.status;
  if (status !== "OK" && status !== "UNSURE" && status !== "NO_ITEM") return null;
  const s = data?.suggestion ?? {};
  return {
    status,
    category: typeof s.category === "string" ? s.category : null,
    item: typeof s.item === "string" ? s.item : null,
    colors: Array.isArray(s.colors) ? s.colors.filter((c: unknown) => typeof c === "string").slice(0, 2) : [],
    brand: typeof s.brand === "string" && s.brand.trim() ? s.brand.trim() : null,
    size: typeof s.size === "string" && s.size.trim() ? s.size.trim().slice(0, 30) : null,
    alternatives: Array.isArray(s.alternatives)
      ? s.alternatives
          .filter((a: any) => typeof a?.key === "string")
          .slice(0, 3)
          .map((a: any) => ({ key: a.key, category: typeof a.category === "string" ? a.category : null }))
      : [],
  };
}
