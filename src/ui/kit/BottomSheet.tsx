// src/ui/kit/BottomSheet.tsx
// T1.9F: panel that slides up from the bottom (info texts, confirmations, menus).
// Tapping the dimmed area or the system back gesture closes it.
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
};

export function BottomSheet({ visible, onClose, children, accessibilityLabel }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={accessibilityLabel} />
        <View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 12) }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 999, backgroundColor: "#CBD5E1" },
});
