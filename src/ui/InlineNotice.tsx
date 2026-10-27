import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// T1.8E.5I: in-screen notice used instead of native alert dialogs.
type Tone = "warning" | "info" | "error";

const TONES: Record<Tone, { bg: string; border: string; title: string; body: string; icon: string; button: string }> = {
  warning: { bg: "#FFFBEB", border: "#FCD34D", title: "#78350F", body: "#92400E", icon: "#92400E", button: "#D97706" },
  info: { bg: "#EFF6FF", border: "#BFDBFE", title: "#1E3A8A", body: "#1E40AF", icon: "#1D4ED8", button: "#2563EB" },
  error: { bg: "#FFF1F2", border: "#FECDD3", title: "#881337", body: "#9F1239", icon: "#BE123C", button: "#E11D48" },
};

type Props = {
  tone?: Tone;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
};

export function InlineNotice({ tone = "warning", icon = "alert-circle-outline", title, body, actionLabel, onAction, busy }: Props) {
  const c = TONES[tone];
  return (
    <View accessibilityRole="alert" style={[styles.box, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={styles.row}>
        <Ionicons name={icon} size={20} color={c.icon} style={styles.icon} />
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: c.title }]}>{title}</Text>
          {!!body && <Text style={[styles.body, { color: c.body }]}>{body}</Text>}
        </View>
      </View>
      {!!actionLabel && !!onAction && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onAction}
          style={[styles.button, { borderColor: c.button }, busy && styles.disabled]}
        >
          {busy ? <ActivityIndicator color={c.title} /> : <Text style={[styles.buttonText, { color: c.title }]}>{actionLabel}</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  icon: { marginTop: 1 },
  textCol: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  button: {
    alignSelf: "flex-start",
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.6 },
});
