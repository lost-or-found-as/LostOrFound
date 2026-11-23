// app/thanks.tsx
// T1.9BP: thank-you cards this user has received from owners they helped. Only they see them.
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { requireAccount } from "../src/ui/AccountRequired";
import { useI18n } from "../src/i18n/I18nProvider";
import { ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { THANKS_TONES } from "../src/ui/TrustPanel";
import { THANKS_ICONS, fetchMyThanks, type ThanksCard } from "../src/lib/trust";
import { formatDateTimeCustom } from "../src/i18n/formatters";

function Screen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const [cards, setCards] = useState<ThanksCard[] | null>(null);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void fetchMyThanks()
        .then((list) => live && (setCards(list), setError(false)))
        .catch(() => live && (setCards([]), setError(true)));
      return () => {
        live = false;
      };
    }, []),
  );

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("thanks.title")} onBack={() => router.back()} raised />
      {cards === null ? (
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={error ? <InlineNotice tone="error" title={t("thanks.loadError")} /> : undefined}
          ListEmptyComponent={
            error ? undefined : (
              <View style={s.empty}>
                <Ionicons name="heart-outline" size={36} color={theme.colors.textSecondary} />
                <Text style={s.emptyText}>{t("thanks.empty")}</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const tone = THANKS_TONES[item.design] || THANKS_TONES.HEART;
            return (
              <View style={[s.card, { backgroundColor: tone.bg }]}>
                <Ionicons name={(THANKS_ICONS[item.design] || "heart") as any} size={22} color={tone.fg} />
                <View style={s.flex1}>
                  <Text style={[s.message, { color: tone.fg }]}>{item.message}</Text>
                  <Text style={[s.date, { color: tone.fg }]}>
                    {formatDateTimeCustom(new Date(item.created_at), language, { day: "numeric", month: "long", year: "numeric" })}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

export default requireAccount(Screen);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  empty: { alignItems: "center", gap: 12, paddingTop: 48, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center" },
  card: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 16, alignItems: "flex-start" },
  flex1: { flex: 1, gap: 6 },
  message: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  date: { fontSize: 13, fontWeight: "600" },
});
