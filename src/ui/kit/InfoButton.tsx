// src/ui/kit/InfoButton.tsx
// T1.9F: (i) button that opens a bottom sheet with an explanation. Use it on screens where a
// word or a rule needs more than a line of text. Content comes from the locale files.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nProvider";
import { theme } from "../theme";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

type Props = {
  title: string;
  body?: string;
  children?: React.ReactNode;
  // Accessible name of the button, e.g. "Hva betyr treffnivåene?". Defaults to the title.
  label?: string;
  bordered?: boolean;
};

export function InfoButton({ title, body, children, label, bordered = true }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon="information-circle-outline"
        label={label ?? title}
        onPress={() => setOpen(true)}
        bordered={bordered}
        color={bordered ? theme.colors.primary : theme.colors.textSecondary}
      />
      <InfoSheet visible={open} onClose={() => setOpen(false)} title={title} body={body} closeLabel={t("common.close")}>
        {children}
      </InfoSheet>
    </>
  );
}

export function InfoSheet({
  visible,
  onClose,
  title,
  body,
  children,
  closeLabel,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  children?: React.ReactNode;
  closeLabel: string;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={closeLabel}>
      <View style={styles.titleRow}>
        <Ionicons name="information-circle-outline" size={22} color={theme.tone.info.icon} />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {!!body && <Text style={styles.body}>{body}</Text>}
      {children}
      <Button label={closeLabel} onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 19, fontWeight: "900", color: theme.colors.text },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "500", color: "#334155" },
});
