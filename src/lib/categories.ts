// src/lib/categories.ts
// T1.9E: compatibility views over src/i18n/catalog.ts, which is the only source of category,
// item and colour names. New code should use categoryName/itemName/colorName from the catalog.
import { CATEGORY_CATALOG, ITEM_CATALOG, itemEntry, itemName, itemSearchText } from "../i18n/catalog";

export type Option = { label: string; value: string };
export type SubOpt = { label: string; value: string };

// Norwegian names, kept for older pickers that store a key and translate on display.
export const CATEGORIES: Option[] = CATEGORY_CATALOG.map((e) => ({ label: e.names.no, value: e.key }));

export const SUBCATEGORIES: Record<string, SubOpt[]> = Object.fromEntries(
  Object.entries(ITEM_CATALOG).map(([category, list]) => [
    category,
    list.map((e) => ({ label: e.names.no, value: e.key })),
  ]),
);

export const OBJECT_LABELS_EN: Record<string, string> = Object.fromEntries(
  Object.values(ITEM_CATALOG).flatMap((list) => list.map((e) => [e.key, e.names.en] as const)),
);

export function objectLabel(value?: string, language: "no" | "en" = "no", category?: string) {
  if (!value) return "";
  return itemEntry(value, category) ? itemName(value, language, category) : value;
}

export function objectSearchText(value: string, noLabel: string, enLabel?: string) {
  return [itemSearchText(value), noLabel, enLabel ?? ""].join(" ");
}
