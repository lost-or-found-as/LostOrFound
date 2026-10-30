// src/ui/kit/IconButton.tsx
// T1.9F: round 44 px button with one icon (back, info, more). Always has an accessible label.
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

type Props = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  bordered?: boolean;
  color?: string;
};

export function IconButton({ icon, label, onPress, bordered = true, color = theme.colors.primary }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.base, bordered && styles.bordered, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={21} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { width: 44, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bordered: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  pressed: { opacity: 0.7 },
});
