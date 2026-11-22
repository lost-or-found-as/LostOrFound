// src/ui/SolvedChatBar.tsx
// T1.9BM: under a chat about a solved case. While it is still open: when it closes. After: that
// the conversation can be read but not answered (replaces the composer).
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { formatDate } from "../i18n/formatters";
import { theme } from "./theme";

export function SolvedChatBar({ closesAt, closed, bottomInset = 0 }: { closesAt: string; closed: boolean; bottomInset?: number }) {
  const { language, t } = useI18n();
  const date = formatDate(closesAt, language);
  return (
    <View style={[styles.bar, closed && { paddingBottom: Math.max(12, bottomInset + 4) }]} accessibilityRole="summary">
      <Ionicons name={closed ? "lock-closed-outline" : "checkmark-circle-outline"} size={18} color={theme.tone.success.icon} />
      <Text style={styles.text}>{closed ? t("chat.solvedClosed") : t("chat.solvedOpenUntil", { date })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.tone.success.bg, borderTopWidth: 1, borderTopColor: theme.tone.success.border },
  text: { flex: 1, fontSize: 13, fontWeight: "700", color: theme.tone.success.fg },
});
