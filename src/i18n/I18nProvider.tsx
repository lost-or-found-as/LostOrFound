// src/i18n/I18nProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import type { TranslationKey } from "./locales/en";
import { isLang, translate, type Lang, type TranslateParams as Params } from "./translate";

export { SUPPORTED_LANGUAGES, translate } from "./translate";
export type { Lang } from "./translate";
type I18nContextValue = {
  language: Lang;
  setLanguage: (language: Lang) => Promise<void>;
  t: (key: TranslationKey, params?: Params) => string;
};

const STORAGE_KEY = "app.language";
const I18nContext = createContext<I18nContextValue | null>(null);

function guessDeviceLanguage(): Lang {
  const first = Localization.getLocales()?.[0]?.languageCode;
  if (first === "nb" || first === "nn") return "no";
  // Devices in a language the app does not have yet keep the current default (Norwegian).
  return isLang(first) ? first : "no";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Lang>(guessDeviceLanguage());
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (active && isLang(saved)) setLanguageState(saved);
      } catch (error) {
        console.warn("[i18n] Could not read the saved language", error);
      }
    })();
    return () => { active = false; };
  }, []);

  const setLanguage = async (nextLanguage: Lang) => {
    setLanguageState(nextLanguage);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch (error) {
      console.warn("[i18n] Could not save the selected language", error);
    }
  };

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params),
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
