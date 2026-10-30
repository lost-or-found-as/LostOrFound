// src/ui/kit/EmptyState.tsx
// T1.9F: what a list shows when it has nothing in it.
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
      <Ionicons name={icon} size={28} color={theme.colors.textSecondary} />
      <Text style={styles.title}>{title}</Text>
      {!!body && <Text style={styles.body}>{body}</Text>}
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
  title: { fontSize: 16, fontWeight: "900", color: theme.colors.text, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center" },
});
