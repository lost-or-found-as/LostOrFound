// src/ui/kit/ScreenHeader.tsx
// T1.9F: the one screen header: round back button, title, optional subtitle and one item on
// the right (an InfoButton or a single action). Handles the top safe area itself.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "../../i18n/I18nProvider";
import { theme } from "../theme";
import { IconButton } from "./IconButton";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  // White header with a bottom border (chat); default sits on the screen background.
  raised?: boolean;
  children?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, onBack, right, raised, children }: Props) {
  const { t } = useI18n();
  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, raised && styles.raised]}>
      <View style={styles.row}>
        {onBack ? <IconButton icon="arrow-back" label={t("common.back")} onPress={onBack} /> : null}
        <View style={styles.text}>
          <Text style={[styles.title, raised && styles.titleRaised]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {right}
      </View>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.colors.bg, paddingHorizontal: 16, paddingBottom: 10, gap: 12 },
  raised: { backgroundColor: theme.colors.card, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 26, fontWeight: "900", color: theme.colors.text },
  titleRaised: { fontSize: 18 },
  subtitle: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
});
