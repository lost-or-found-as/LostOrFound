// T1.9R: consent before a purchase that starts at once – the right of withdrawal then lapses
// (angrerettloven § 22). The buy button stays disabled until this is ticked.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { openLegal } from "../lib/legal";
import { theme } from "./theme";

export function WithdrawalConsent({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const { language, t } = useI18n();
  return (
    <View style={s.wrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={theme.colors.primary} />
        <Text style={s.text}>{t("purchase.withdrawalConsent")}</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => void openLegal("terms", language)} style={s.link}>
        <Text style={s.linkText}>{t("purchase.readTerms")}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 2 },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  pressed: { opacity: 0.85 },
  text: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.text },
  link: { minHeight: 36, justifyContent: "center", paddingLeft: 36 },
  linkText: { fontSize: 14, fontWeight: "800", color: theme.colors.text, textDecorationLine: "underline" },
});
