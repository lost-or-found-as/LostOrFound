// src/i18n/translate.ts
// Plain translation without React, for helpers and tests. I18nProvider uses the same function.
// T1.9AH: the languages come from src/i18n/languages.ts (how to add one is described there).
// A key missing in a draft language falls back to English.
import { en, type TranslationKey } from "./locales/en";
import { no } from "./locales/no";
import { de } from "./locales/de";
import { ALL_LANGUAGES, languageInfo, type Lang } from "./languages";

export type { Lang } from "./languages";
export type TranslateParams = Record<string, string | number | null | undefined>;

export const SUPPORTED_LANGUAGES: readonly Lang[] = ALL_LANGUAGES;
export const isLang = (v: unknown): v is Lang => SUPPORTED_LANGUAGES.includes(v as Lang);

const dictionaries: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, no, de };

export function formatTemplate(template: string, params?: TranslateParams) {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = params[key];
    return value == null ? "" : String(value);
  });
}

// T1.9G: singular forms. When the language's plural rule says "one" and the key has a
// "<key>_one" variant, that variant is used ("1 mulig treff" / "3 mulige treff").
// T1.9AH: the rule comes from Intl.PluralRules, so a language with other rules (for example
// Polish "few") can add more variants later; Norwegian, English and German only need one/other.
function pluralCategory(language: Lang, count: number): string {
  try {
    return new Intl.PluralRules(languageInfo(language).locale).select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
}

function pluralKey(language: Lang, key: TranslationKey, params?: TranslateParams): TranslationKey {
  if (typeof params?.count !== "number" || pluralCategory(language, params.count) !== "one") return key;
  const one = `${key}_one` as TranslationKey;
  return one in en ? one : key;
}

export function translate(language: Lang, key: TranslationKey, params?: TranslateParams) {
  const k = pluralKey(language, key, params);
  return formatTemplate(dictionaries[language]?.[k] ?? en[k] ?? String(k), params);
}
