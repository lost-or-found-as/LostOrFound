// src/i18n/languages.ts
// T1.9AH: the one list of app languages. Everything else (Lang, the language screen, number and
// date formatting, the device-language guess, push and the server) follows this list.
// To add a language:
//   1. add it here with ready: false,
//   2. add src/i18n/locales/<code>.ts (missing keys fall back to English while it is a draft),
//      a name for it in every catalog entry (src/i18n/catalog.ts), server/locales/<code>.json,
//      and "lang.name.<code>" in every locale file,
//   3. set ready: true when every key is translated (scripts/test-t1-9ah.js checks that).
// A draft language is only offered when EXPO_PUBLIC_SHOW_DRAFT_LANGUAGES=true (test builds).
export const LANGUAGES = [
  { code: "no", nativeName: "Norsk", locale: "nb-NO", ready: true },
  { code: "en", nativeName: "English", locale: "en-GB", ready: true },
  { code: "de", nativeName: "Deutsch", locale: "de-DE", ready: false },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export type LanguageInfo = (typeof LANGUAGES)[number];

/** Every language the code knows, ready or not. */
export const ALL_LANGUAGES: readonly Lang[] = LANGUAGES.map((l) => l.code);

/** Draft languages are shown in test builds only. */
export function draftLanguagesVisible(): boolean {
  return String(process.env.EXPO_PUBLIC_SHOW_DRAFT_LANGUAGES ?? "").toLowerCase() === "true";
}

/** The languages a user can pick in this build. */
export function selectableLanguages(): readonly LanguageInfo[] {
  const showDrafts = draftLanguagesVisible();
  return LANGUAGES.filter((l) => l.ready || showDrafts);
}

export function languageInfo(code: Lang): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[1];
}
