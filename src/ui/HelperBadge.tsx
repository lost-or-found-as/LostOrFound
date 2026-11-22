// src/ui/HelperBadge.tsx
// T1.9AX: the other party's helper level in a chat header: level, stars and number of returns.
// Never the balance. Renders nothing without a level.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { LEVEL_ICONS, levelKey, starText, type HelperStatus } from "../lib/helperBonus";
import { theme } from "./theme";

export function HelperBadge({ helper }: { helper: HelperStatus | null }) {
  const { t } = useI18n();
  if (!helper) return null;
  return (
    <View style={styles.row} accessibilityLabel={t("bonus.helperA11y", { level: t(levelKey(helper.level)), count: helper.returns })}>
      <Ionicons name={LEVEL_ICONS[helper.level] as any} size={14} color={theme.tone.info.icon} />
      <Text style={styles.text}>
        {t(levelKey(helper.level))}
        {helper.stars > 0 ? ` ${starText(helper.stars)}` : ""} · {t("bonus.returns", { count: helper.returns })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4 },
  text: { fontSize: 13, fontWeight: "700", color: theme.tone.info.fg },
});
