// src/lib/petSearchTips.ts
// T1.9BR: «Slik leter du» on a lost animal: a short tip and a checklist by kind of animal.
// The ticks stay on this phone only.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TranslationKey } from "../i18n/locales/en";

export type PetKind = "DOG" | "CAT" | "OTHER";
export const DYREID_URL = "https://www.dyreid.no";

export function petKind(subcategoryKey: string | null | undefined): PetKind {
  const k = String(subcategoryKey || "").toUpperCase();
  return k === "DOG" ? "DOG" : k === "CAT" ? "CAT" : "OTHER";
}

export type TipItem = { id: string; label: TranslationKey; link?: string };

const CHIP: TipItem = { id: "chip", label: "petTips.item.chip", link: DYREID_URL };
const POSTER: TipItem = { id: "poster", label: "petTips.item.poster" };

export const PET_TIPS: Record<PetKind, { lead: TranslationKey; items: TipItem[] }> = {
  CAT: {
    lead: "petTips.lead.cat",
    items: [
      { id: "sheds", label: "petTips.item.catSheds" },
      { id: "scent", label: "petTips.item.catScent" },
      { id: "dusk", label: "petTips.item.catDusk" },
      CHIP,
      POSTER,
    ],
  },
  DOG: {
    lead: "petTips.lead.dog",
    items: [
      { id: "route", label: "petTips.item.dogRoute" },
      { id: "home", label: "petTips.item.dogHome" },
      { id: "calm", label: "petTips.item.dogCalm" },
      CHIP,
      POSTER,
    ],
  },
  OTHER: {
    lead: "petTips.lead.other",
    items: [
      { id: "near", label: "petTips.item.otherNear" },
      { id: "food", label: "petTips.item.otherFood" },
      { id: "vets", label: "petTips.item.otherVets" },
      POSTER,
    ],
  },
};

const key = (reportId: string) => `lof.petTips.${reportId}`;

export async function loadTicks(reportId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key(reportId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveTicks(reportId: string, ticks: string[]) {
  try {
    await AsyncStorage.setItem(key(reportId), JSON.stringify(ticks));
  } catch {
    // Ticks are only a help; nothing to do.
  }
}

export function toggleTick(ticks: string[], id: string): string[] {
  return ticks.includes(id) ? ticks.filter((x) => x !== id) : [...ticks, id];
}
