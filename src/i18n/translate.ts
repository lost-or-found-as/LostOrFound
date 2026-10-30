// src/i18n/translate.ts
// Plain translation without React, for helpers and tests. I18nProvider uses the same function.
// To add a language: add it to Lang and SUPPORTED_LANGUAGES, add a locale file with every key
// (check-i18n-parity), add names to src/i18n/catalog.ts and a locale tag in formatters.ts.
import { en, type TranslationKey } from "./locales/en";
import { no } from "./locales/no";

export type Lang = "no" | "en";
export type TranslateParams = Record<string, string | number | null | undefined>;

export const SUPPORTED_LANGUAGES: readonly Lang[] = ["no", "en"];
export const isLang = (v: unknown): v is Lang => SUPPORTED_LANGUAGES.includes(v as Lang);

const dictionaries: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, no };

export function formatTemplate(template: string, params?: TranslateParams) {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = params[key];
    return value == null ? "" : String(value);
  });
}

// T1.9G: singular forms. When params.count is 1 and the key has a "<key>_one" variant, that
// variant is used ("1 mulig treff" / "3 mulige treff"). Norwegian and English only need one and
// other; a language with more plural forms can extend this with Intl.PluralRules.
function pluralKey(key: TranslationKey, params?: TranslateParams): TranslationKey {
  if (params?.count !== 1) return key;
  const one = `${key}_one` as TranslationKey;
  return one in en ? one : key;
}

export function translate(language: Lang, key: TranslationKey, params?: TranslateParams) {
  const k = pluralKey(key, params);
  return formatTemplate(dictionaries[language]?.[k] ?? en[k] ?? String(k), params);
}
