// src/lib/reportDescription.ts
// T1.9F: the secondary colour used to be stored as a text line at the end of the description
// ("Secondary color: Yellow" / "Tilleggsfarge: Gul"), in the reporter's language. It now has
// its own column, reports.secondary_color (a colour key). These helpers read both, and hide the
// old line wherever a description is shown.
import { COLOR_CATALOG, colorEntry, findByName } from "../i18n/catalog";

const LINE = /^[ \t]*(?:secondary colou?r|tilleggsfarge)[ \t]*:[ \t]*(.*?)[ \t]*$/gim;

/** Colour key for a stored key or a colour name in any app language ("Gul", "Light blue"). */
export function colorKeyFromName(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const candidates = [
    raw,
    raw.replace(/\s*\(.*\)\s*$/, ""), // "Mørkeblå (Navy)"
    ...raw.split("/").map((x) => x.trim()), // "Camo / Kamuflasje"
  ];
  for (const c of candidates) {
    const entry = colorEntry(c) ?? findByName(COLOR_CATALOG, c);
    if (entry) return entry.key;
  }
  return null;
}

/** The description without the old secondary colour line. */
export function reportDescriptionText(description: unknown): string {
  return String(description ?? "")
    .replace(LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Secondary colour key: the column first, then the old description line. */
export function reportSecondaryColor(report: { secondary_color?: string | null; description?: string | null } | null | undefined): string | null {
  const direct = String(report?.secondary_color ?? "").trim();
  if (direct) return colorKeyFromName(direct) ?? direct.toLowerCase();
  const text = String(report?.description ?? "");
  LINE.lastIndex = 0;
  const m = LINE.exec(text);
  LINE.lastIndex = 0;
  return m ? colorKeyFromName(m[1]) : null;
}
