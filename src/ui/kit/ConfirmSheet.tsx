// src/ui/kit/ConfirmSheet.tsx
// T1.9F: asks the user to confirm an action, in place of a system Alert with buttons.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";

type Props = {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  busy?: boolean;
  // T1.9R: extra content above the buttons (e.g. a consent) and a confirm that waits for it.
  children?: React.ReactNode;
  confirmDisabled?: boolean;
};

export function ConfirmSheet({ visible, title, body, confirmLabel, cancelLabel, onConfirm, onCancel, destructive, busy, children, confirmDisabled }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onCancel} accessibilityLabel={cancelLabel}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {!!body && <Text style={styles.body}>{body}</Text>}
      {children}
      <View style={styles.row}>
        <Button label={cancelLabel} variant="neutral" onPress={onCancel} style={styles.flex} disabled={busy} />
        <Button
          label={confirmLabel}
          variant={destructive ? "danger" : "primary"}
          onPress={onConfirm}
          style={styles.flex}
          busy={busy}
          disabled={confirmDisabled}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: "900", color: theme.colors.text },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "500", color: "#334155" },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
});
