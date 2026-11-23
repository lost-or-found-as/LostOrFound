// src/ui/kit/EmptyState.tsx
// T1.9F: what a list shows when it has nothing in it.
// T1.9BQ: a small illustration (the icon in soft circles) instead of a bare icon.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

type Props = {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon = "search-outline", title, body, action }: Props) {
  return (
    <View style={styles.box}>
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.ring}>
          <View style={styles.disc}>
            <Ionicons name={icon} size={34} color={theme.tone.info.icon} />
          </View>
        </View>
        <View style={[styles.spark, styles.sparkA]} />
        <View style={[styles.spark, styles.sparkB]} />
      </View>
      <Text style={styles.title} maxFontSizeMultiplier={1.5}>
        {title}
      </Text>
      {!!body && (
        <Text style={styles.body} maxFontSizeMultiplier={1.6}>
          {body}
        </Text>
      )}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  art: { width: 112, height: 96, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  ring: { width: 92, height: 92, borderRadius: 46, backgroundColor: theme.tone.info.bg, opacity: 0.9, alignItems: "center", justifyContent: "center" },
  disc: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.card, alignItems: "center", justifyContent: "center" },
  spark: { position: "absolute", borderRadius: 999, backgroundColor: theme.tone.info.icon, opacity: 0.35 },
  sparkA: { width: 10, height: 10, top: 6, right: 12 },
  sparkB: { width: 7, height: 7, bottom: 10, left: 10 },
  title: { fontSize: 16, fontWeight: "900", color: theme.colors.text, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center" },
});
