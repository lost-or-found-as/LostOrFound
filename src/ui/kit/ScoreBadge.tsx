// src/ui/kit/ScoreBadge.tsx
// T1.9F: match level badge ("Svært godt treff", "Godt treff", "Mulig treff", "Lavt samsvar")
// and the info sheet content that explains the levels.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/locales/en";
import { theme } from "../theme";

export type ScoreLevel = "excellent" | "good" | "possible" | "low";

// Same limits as the matching on the server (55 = shown in lists).
export function scoreLevel(score: number): ScoreLevel {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "possible";
  return "low";
}

export const SCORE_LABEL_KEYS: Record<ScoreLevel, TranslationKey> = {
  excellent: "match.score.excellent",
  good: "match.score.good",
  possible: "match.score.possible",
  low: "match.score.low",
};

export function ScoreBadge({ score, level }: { score?: number; level?: ScoreLevel }) {
  const { t } = useI18n();
  const l = level ?? scoreLevel(Number(score || 0));
  const c = theme.score[l];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{t(SCORE_LABEL_KEYS[l])}</Text>
    </View>
  );
}

// Body of the "how we rate matches" info sheet.
export function ScoreLevelsExplained() {
  const { t } = useI18n();
  const rows: { level: ScoreLevel; key: TranslationKey }[] = [
    { level: "excellent", key: "info.matchLevels.excellent" },
    { level: "good", key: "info.matchLevels.good" },
    { level: "possible", key: "info.matchLevels.possible" },
  ];
  return (
    <View style={styles.list}>
      {rows.map((r) => (
        <View key={r.level} style={styles.row}>
          <View style={styles.badgeCol}>
            <ScoreBadge level={r.level} />
          </View>
          <Text style={styles.rowText}>{t(r.key)}</Text>
        </View>
      ))}
      <Text style={styles.footer}>{t("info.matchLevels.footer")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontSize: 12, fontWeight: "800" },
  list: { gap: 10 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  badgeCol: { width: 132 },
  rowText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#334155" },
  footer: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
});
