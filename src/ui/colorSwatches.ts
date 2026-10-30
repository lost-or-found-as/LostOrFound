// src/ui/colorSwatches.ts
// T1.9K: what each colour key looks like as a tappable swatch in the registration.
// Keys come from COLOR_CATALOG (src/i18n/catalog.ts); names are shown from the catalog.
// Patterned, multicolour, camouflage, unknown and other have no single colour, so they get a
// light swatch with an icon instead.

export type Swatch = { fill: string; dark: boolean; icon?: "color-palette-outline" | "grid-outline" | "leaf-outline" | "help" | "ellipsis-horizontal" };

export const COLOR_SWATCHES: Record<string, Swatch> = {
  black: { fill: "#111827", dark: true },
  white: { fill: "#FFFFFF", dark: false },
  gray: { fill: "#9CA3AF", dark: false },
  red: { fill: "#DC2626", dark: true },
  orange: { fill: "#EA580C", dark: true },
  yellow: { fill: "#EAB308", dark: false },
  green: { fill: "#16A34A", dark: true },
  blue: { fill: "#2563EB", dark: true },
  purple: { fill: "#7C3AED", dark: true },
  brown: { fill: "#92400E", dark: true },
  pink: { fill: "#F472B6", dark: false },
  beige: { fill: "#E7D7B8", dark: false },
  navy: { fill: "#1E3A8A", dark: true },
  "light-blue": { fill: "#93C5FD", dark: false },
  turquoise: { fill: "#14B8A6", dark: false },
  burgundy: { fill: "#7F1D1D", dark: true },
  lime: { fill: "#A3E635", dark: false },
  cyan: { fill: "#22D3EE", dark: false },
  magenta: { fill: "#C026D3", dark: true },
  olive: { fill: "#65712B", dark: true },
  gold: { fill: "#D4A017", dark: false },
  silver: { fill: "#C0C6CF", dark: false },
  bronze: { fill: "#A0632B", dark: true },
  camo: { fill: "#F1F5F9", dark: false, icon: "leaf-outline" },
  multicolor: { fill: "#F1F5F9", dark: false, icon: "color-palette-outline" },
  patterned: { fill: "#F1F5F9", dark: false, icon: "grid-outline" },
  unknown: { fill: "#F1F5F9", dark: false, icon: "help" },
  other: { fill: "#F1F5F9", dark: false, icon: "ellipsis-horizontal" },
};

/** The colours shown before "Flere farger" is opened. */
export const COMMON_COLOR_KEYS = ["black", "white", "gray", "red", "orange", "yellow", "green", "blue", "purple", "brown", "pink"];

/**
 * Tapping a swatch: the first chosen colour is the main colour, the second the secondary one.
 * Tapping a chosen colour removes it (the secondary moves up when the main one is removed);
 * a third colour replaces the secondary one.
 */
export function nextColors(main: string, secondary: string, tapped: string): { color: string; colorSecondary: string } {
  if (tapped === main) return { color: secondary, colorSecondary: "" };
  if (tapped === secondary) return { color: main, colorSecondary: "" };
  if (!main) return { color: tapped, colorSecondary: secondary };
  return { color: main, colorSecondary: tapped };
}
