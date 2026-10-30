// src/lib/custodyDisplay.ts
// T1.9K: how "Hvor er gjenstanden nå?" is shown on a found report, to the finder and to the
// owner. The hand-in place only reaches the owner after the match is confirmed (server rule);
// before that the owner is told where it will appear.
import type { TranslationKey } from "../i18n/locales/en";

type Translate = (key: TranslationKey, params?: Record<string, string | number | null | undefined>) => string;

export function custodyText(
  custody: string | null | undefined,
  place: string | null | undefined,
  t: Translate,
  options: { placeHidden?: boolean } = {},
): string | null {
  switch (String(custody || "").toUpperCase()) {
    case "WITH_FINDER":
      return t("custody.withFinder");
    case "LEFT_AT_PLACE":
      return t("custody.leftAtPlace");
    case "HANDED_IN": {
      const where = String(place || "").trim();
      if (where) return t("custody.handedInAt", { place: where });
      return options.placeHidden ? t("custody.handedInHidden") : t("custody.handedIn");
    }
    default:
      return null;
  }
}
