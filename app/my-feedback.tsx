// app/my-feedback.tsx
// T1.9BP: the user's own feedback and any answers from Lost or Found.
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { requireAccount } from "../src/ui/AccountRequired";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDateTimeCustom } from "../src/i18n/formatters";
import { EmptyState, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { FEEDBACK_KIND_KEYS, fetchMyFeedback, type MyFeedback } from "../src/lib/feedback";

function Screen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const [items, setItems] = useState<MyFeedback[] | null>(null);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void fetchMyFeedback()
        .then((list) => live && (setItems(list), setError(false)))
        .catch(() => live && (setItems([]), setError(true)));
      return () => {
        live = false;
      };
    }, []),
  );

  const when = (iso: string) => formatDateTimeCustom(new Date(iso), language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("myFeedback.title")} onBack={() => router.back()} raised />
      {items === null ? (
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={error ? <InlineNotice tone="error" title={t("myFeedback.loadError")} /> : undefined}
          ListEmptyComponent={error ? undefined : <EmptyState icon="chatbubbles-outline" title={t("myFeedback.empty")} />}
          renderItem={({ item }) => (
            <View style={s.card}>
              <Text style={s.meta}>
                {t(FEEDBACK_KIND_KEYS[item.kind])} · {when(item.created_at)}
              </Text>
              <Text style={s.message}>{item.message}</Text>
              {item.reply_text ? (
                <View style={s.reply}>
                  <Text style={s.replyLabel}>
                    {t("myFeedback.replyFrom")}
                    {item.replied_at ? ` · ${when(item.replied_at)}` : ""}
                  </Text>
                  <Text style={s.replyText}>{item.reply_text}</Text>
                </View>
              ) : (
                <Text style={s.meta}>{t("myFeedback.noReply")}</Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

export default requireAccount(Screen);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { gap: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  meta: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  message: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.text },
  reply: { gap: 4, padding: 10, borderRadius: 12, backgroundColor: theme.tone.info.bg },
  replyLabel: { fontSize: 12, fontWeight: "800", color: theme.tone.info.fg },
  replyText: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.tone.info.fg },
});
