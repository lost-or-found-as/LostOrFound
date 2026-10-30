// src/ui/kit/Button.tsx
// T1.9F: the app's button. Variants: primary (dark), secondary (outlined), neutral (light
// border), danger (red). At least 50 px high so it is easy to hit.
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "neutral" | "danger";

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

const LOOK: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: theme.colors.primary, fg: "#FFFFFF", border: theme.colors.primary },
  secondary: { bg: theme.colors.card, fg: theme.colors.primary, border: theme.colors.primary },
  neutral: { bg: theme.colors.card, fg: theme.colors.text, border: theme.colors.border },
  danger: { bg: theme.colors.dangerStrong, fg: "#FFFFFF", border: theme.colors.dangerStrong },
};

export function Button({ label, onPress, variant = "primary", busy, disabled, style, accessibilityHint }: Props) {
  const look = LOOK[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: look.bg, borderColor: look.border },
        off && styles.off,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={look.fg} /> : <Text style={[styles.label, { color: look.fg }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  off: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
