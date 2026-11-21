// app/messages.tsx
// T1.9BJ: «Meldinger» – every conversation in one place: match chats (as owner or finder) and
// sightings from area alerts (as owner or helper), also after the case is solved.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatTimeAgo } from "../src/i18n/formatters";
import { EmptyState, InfoButton, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { caseTitle } from "../src/lib/caseDisplay";
import { fetchInbox, type InboxItem } from "../src/lib/inbox";
import { userErrorMessage } from "../src/lib/userError";
import type { TranslationKey } from "../src/i18n/locales/en";

function MessagesScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchInbox());
      setError(null);
    } catch (e) {
      setError(userErrorMessage(e, t, "messages.loadError", "messages.load"));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const open = (item: InboxItem) => {
    if (item.kind === "MATCH") router.push(`/chat/${item.id}`);
    else if (item.hasConversation) router.push(`/observation-chat/${item.id}`);
    else router.push(`/observation/${item.id}`);
  };

  const roleKey = (item: InboxItem): TranslationKey =>
    item.kind === "MATCH"
      ? item.role === "OWNER" ? "messages.role.matchOwner" : "messages.role.matchFinder"
      : item.role === "OWNER"
        ? "messages.role.sightingOwner"
        : item.observationType === "FOUND" ? "messages.role.helperFound" : "messages.role.helperSeen";

  return (
    <View style={s.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={t("messages.title")}
        subtitle={items ? t("messages.count", { count: items.length }) : undefined}
        onBack={() => router.back()}
        right={<InfoButton title={t("messages.info.title")} body={t("messages.info.body")} />}
      />
      {error && <InlineNotice tone="warning" title={t("messages.loadErrorTitle")} body={error} actionLabel={t("errors.retry")} onAction={() => void load()} style={s.notice} />}
      {!items && !error ? (
        <ActivityIndicator style={s.loading} color={theme.colors.primary} />
      ) : (
        <FlatList
          data={items || []}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          ListEmptyComponent={items ? <EmptyState icon="chatbubbles-outline" title={t("messages.emptyTitle")} body={t("messages.emptyBody")} /> : undefined}
          renderItem={({ item }) => {
            const title = item.subject ? caseTitle(item.subject as any, language) : t("messages.unknownCase");
            const icon = item.kind === "MATCH" ? "chatbubbles-outline" : item.observationType === "FOUND" ? "hand-left-outline" : "eye-outline";
            const preview = item.last
              ? `${item.last.mine ? t("messages.you") : ""}${item.last.body}`
              : item.kind === "OBSERVATION" ? t("messages.noChatYet") : t("messages.noMessagesYet");
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={[item.unread ? t("messages.unreadLabel") : "", title, t(roleKey(item)), preview].filter(Boolean).join(", ")}
                onPress={() => open(item)}
                style={({ pressed }) => [s.card, pressed && s.pressed]}
              >
                <View style={s.icon}>
                  <Ionicons name={icon} size={20} color={theme.colors.primary} />
                </View>
                <View style={s.text}>
                  <View style={s.row}>
                    <Text style={[s.title, item.unread && s.titleUnread]} numberOfLines={1}>{title}</Text>
                    <Text style={s.time}>{formatTimeAgo(item.at, t, "short")}</Text>
                    {item.unread && <View style={s.dot} />}
                  </View>
                  <View style={s.tags}>
                    <Text style={s.role}>{t(roleKey(item))}</Text>
                    {item.caseClosed && <Text style={s.solved}>{t("messages.solved")}</Text>}
                  </View>
                  <Text style={[s.preview, item.unread && s.previewUnread]} numberOfLines={2}>{preview}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  loading: { marginTop: 40 },
  notice: { marginHorizontal: 16 },
  list: { padding: 16, gap: 10, paddingBottom: 60 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.colors.card, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, padding: 14 },
  pressed: { opacity: 0.86 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.tone.info.bg, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.colors.text },
  titleUnread: { fontWeight: "900" },
  time: { fontSize: 13, color: theme.colors.textSecondary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary },
  tags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  role: { fontSize: 12, fontWeight: "800", color: theme.colors.textSecondary, backgroundColor: "#EEF2F6", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  solved: { fontSize: 12, fontWeight: "800", color: "#166534", backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  preview: { fontSize: 14, color: theme.colors.textSecondary },
  previewUnread: { color: theme.colors.text, fontWeight: "600" },
});

export default requireAccount(MessagesScreen);
