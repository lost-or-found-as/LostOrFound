// app/language.tsx
// T1.9W: language picker. Picking a language saves it and goes back.
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n, Lang } from "../src/i18n/I18nProvider";
import { ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";

export default function LanguageScreen() {
  const router = useRouter();
  const { language, setLanguage, t } = useI18n();

  const pick = async (lang: Lang) => {
    await setLanguage(lang);
    router.back();
  };

  const options: { lang: Lang; title: string; meta: string }[] = [
    { lang: "no", title: t("lang.norwegian"), meta: t("lang.norwegianMeta") },
    { lang: "en", title: t("lang.english"), meta: t("lang.englishMeta") },
  ];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("profile.language")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card} accessibilityRole="radiogroup">
          {options.map((option, index) => {
            const selected = language === option.lang;
            return (
              <React.Fragment key={option.lang}>
                {index > 0 && <View style={styles.divider} />}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={`${option.title}, ${option.meta}`}
                  style={({ pressed }) => [styles.row, selected && styles.rowActive, pressed && styles.pressed]}
                  onPress={() => void pick(option.lang)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{option.title}</Text>
                    <Text style={styles.rowMeta}>{option.meta}</Text>
                  </View>
                  {selected && <Ionicons name="checkmark" size={22} color={theme.colors.primary} />}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>

        <InlineNotice
          tone="info"
          icon="information-circle-outline"
          title={t("lang.tipTitle")}
          body={t("lang.tipBody")}
          style={styles.noMargin}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    overflow: "hidden",
  },
  row: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  rowActive: { backgroundColor: theme.colors.chipBg },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  rowMeta: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  divider: { height: 1, backgroundColor: theme.colors.border },
  noMargin: { marginTop: 0 },
  pressed: { opacity: 0.8 },
});
