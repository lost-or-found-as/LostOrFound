// src/i18n/locales/de.ts
// T1.9AH: German (draft). Missing keys fall back to English until the language is complete;
// scripts/test-t1-9ah.js reports how far it is and blocks ready: true while keys are missing.
import type { TranslationKey } from "./en";

export const de: Partial<Record<TranslationKey, string>> = {
  "lang.title": "Sprache wählen",
  "lang.back": "Zurück",
  "lang.name.no": "Norwegisch (Bokmål)",
  "lang.name.en": "Englisch",
  "lang.name.de": "Deutsch",
  "lang.tipTitle": "Tipp",
  "lang.tipBody": "Deine Auswahl wird auf dem Gerät gespeichert und beim nächsten Öffnen der App verwendet.",
  "profile.language": "Sprache",
};
