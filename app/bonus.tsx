// app/bonus.tsx
// T1.9AX: «Din bonus». Balance, what is waiting, the helper level with progress (stars after
// Mesterhjelper), the next expiry, how bonus is earned and the history. Only the user's own
// bonus; others only ever see the level. Shown only while the server has the bonus switched on.
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDate } from "../src/i18n/formatters";
import { ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { BONUS_EVENTS, BONUS_POINTS, fetchMyBonus, levelKey, starText, type MyBonus } from "../src/lib/helperBonus";
import type { TranslationKey } from "../src/i18n/locales/en";

export default function BonusScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [state, setState] = useState<{ loading: boolean; bonus: MyBonus | null }>({ loading: true, bonus: null });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void fetchMyBonus().then((bonus) => live && setState({ loading: false, bonus }));
      return () => {
        live = false;
      };
    }, []),
  );

  const b = state.bonus;
  const progress = (() => {
    if (!b?.next) return null;
    const from = b.next.kind === "LEVEL" ? (b.next.level === "HELPER" ? 0 : b.next.level === "SUPER_HELPER" ? 1 : 5) : b.next.at - 15;
    const span = Math.max(1, b.next.at - from);
    return Math.max(0, Math.min(1, (b.returns - from) / span));
  })();

  return (
    <View style={s.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("bonus.title")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.container}>
        {state.loading ? (
          <ActivityIndicator style={s.loading} />
        ) : !b || !b.enabled ? (
          <InlineNotice tone="info" title={t("bonus.offTitle")} body={t("bonus.offBody")} />
        ) : (
          <>
            <View style={s.card}>
              <Text style={s.muted}>{t("bonus.balance")}</Text>
              <Text style={s.balance} accessibilityLabel={t("bonus.balanceValue", { count: b.balance })}>
                {t("bonus.balanceValue", { count: b.balance })}
              </Text>
              {b.pending > 0 && <Text style={s.muted}>{t("bonus.pending", { count: b.pending })}</Text>}
              {b.nextExpiry && b.nextExpiry.points > 0 && (
                <Text style={s.mutedSmall}>
                  {t("bonus.expires", { count: b.nextExpiry.points, date: formatDate(b.nextExpiry.at, language) })}
                </Text>
              )}
            </View>

            <View style={s.card}>
              <Text style={s.h2}>{t("bonus.levelTitle")}</Text>
              {b.level ? (
                <View style={s.levelRow}>
                  <View style={s.levelBadge}>
                    <Ionicons name="ribbon-outline" size={16} color={theme.tone.info.icon} />
                    <Text style={s.levelText}>
                      {t(levelKey(b.level))}
                      {b.stars > 0 ? ` ${starText(b.stars)}` : ""}
                    </Text>
                  </View>
                  <Text style={s.muted}>{t("bonus.returns", { count: b.returns })}</Text>
                </View>
              ) : (
                <Text style={s.body}>{t("bonus.noLevel")}</Text>
              )}
              {b.next && progress != null && (
                <>
                  <View style={s.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
                    <View style={[s.barFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                  <Text style={s.mutedSmall}>
                    {b.next.kind === "LEVEL"
                      ? t("bonus.nextLevel", { count: b.returns, at: b.next.at, level: t(levelKey(b.next.level)) })
                      : t("bonus.nextStar", { count: b.returns, at: b.next.at })}
                  </Text>
                </>
              )}
              <Text style={s.mutedSmall}>{t("bonus.levelPrivacy")}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.h2}>{t("bonus.howTitle")}</Text>
              {BONUS_EVENTS.map((event) => (
                <View key={event} style={s.earnRow}>
                  <Text style={s.body}>{t(`bonus.event.${event}` as TranslationKey)}</Text>
                  <Text style={s.points}>+{BONUS_POINTS[event]}</Text>
                </View>
              ))}
              <Text style={s.mutedSmall}>{t("bonus.rules")}</Text>
              <Text style={s.mutedSmall}>{t("bonus.useSoon")}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.h2}>{t("bonus.historyTitle")}</Text>
              {b.history.length === 0 ? (
                <Text style={s.body}>{t("bonus.historyEmpty")}</Text>
              ) : (
                b.history.map((h, i) => (
                  <View key={`${h.at}-${i}`} style={s.historyRow}>
                    <View style={s.flex}>
                      <Text style={s.body}>{t(`bonus.event.${h.event}` as TranslationKey)}</Text>
                      <Text style={s.mutedSmall}>
                        {formatDate(h.at, language)}
                        {h.status === "PENDING" ? ` · ${t("bonus.status.PENDING")}` : h.status === "REVOKED" ? ` · ${t("bonus.status.REVOKED")}` : ""}
                      </Text>
                    </View>
                    <Text style={[s.points, h.status === "REVOKED" && s.pointsRevoked]}>+{h.points}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  loading: { marginTop: 40 },
  card: { backgroundColor: theme.colors.card, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, padding: 16, gap: 8 },
  h2: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  body: { fontSize: 15, color: theme.colors.text },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  mutedSmall: { fontSize: 13, color: theme.colors.textSecondary },
  balance: { fontSize: 32, fontWeight: "900", color: theme.colors.text },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  levelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.tone.info.bg,
    borderWidth: 1,
    borderColor: theme.tone.info.border,
  },
  levelText: { fontSize: 14, fontWeight: "800", color: theme.tone.info.fg },
  bar: { height: 8, borderRadius: 4, backgroundColor: theme.colors.divider, overflow: "hidden", marginTop: 4 },
  barFill: { height: 8, backgroundColor: theme.tone.info.icon },
  earnRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  flex: { flex: 1 },
  points: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  pointsRevoked: { color: theme.colors.textSecondary, textDecorationLine: "line-through" },
});
