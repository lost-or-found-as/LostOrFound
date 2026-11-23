// app/messages.tsx
// T1.9BJ: «Meldinger» – every conversation in one place: match chats (as owner or finder) and
// sightings from area alerts (as owner or helper), also after the case is solved.
// T1.9BL: filter (all, my cases, I help), active first and solved folded away below, the item's
// photo, the other person's helper level and a clear unread count.
import { requireAccount } from "../src/ui/AccountRequired";
import { SkeletonDetail, SkeletonList } from "../src/ui/Skeleton";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatTimeAgo } from "../src/i18n/formatters";
import { EmptyState, InfoButton, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { caseTitle } from "../src/lib/caseDisplay";
import { fetchInbox, inboxFilter, type InboxFilter as Filter, type InboxItem } from "../src/lib/inbox";
import { userErrorMessage } from "../src/lib/userError";
import { levelKey, starText, toHelperStatus } from "../src/lib/helperBonus";
import type { TranslationKey } from "../src/i18n/locales/en";


function MessagesScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showSolved, setShowSolved] = useState(false);

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

  const unread = (items || []).filter((i) => i.unread).length;
  const shown = useMemo(() => inboxFilter(items || [], filter), [items, filter]);
  const active = shown.filter((i) => !i.caseClosed);
  const solved = shown.filter((i) => i.caseClosed);
  const sections = [
    ...(active.length ? [{ key: "active", title: t("messages.section.active"), data: active }] : []),
    ...(solved.length ? [{ key: "solved", title: t("messages.section.solved", { count: solved.length }), data: showSolved ? solved : [] }] : []),
  ];

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

  const filters: { key: Filter; label: string }[] = [
    { key: "ALL", label: t("messages.filter.all") },
    { key: "MINE", label: t("messages.filter.mine") },
    { key: "HELPING", label: t("messages.filter.helping") },
  ];

  return (
    <View style={s.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={t("messages.title")}
        subtitle={items ? (unread > 0 ? t("messages.unreadCount", { count: unread }) : t("messages.count", { count: items.length })) : undefined}
        onBack={() => router.back()}
        right={<InfoButton title={t("messages.info.title")} body={t("messages.info.body")} />}
      >
        <View style={s.filters} accessibilityRole="tablist">
          {filters.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setFilter(f.key)}
                style={[s.filter, on && s.filterOn]}
              >
                <Text style={[s.filterText, on && s.filterTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScreenHeader>
      {error && <InlineNotice tone="warning" title={t("messages.loadErrorTitle")} body={error} actionLabel={t("errors.retry")} onAction={() => void load()} style={s.notice} />}
      {!items && !error ? (
        <SkeletonList rows={5} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          contentContainerStyle={s.list}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          ListEmptyComponent={items ? <EmptyState icon="chatbubbles-outline" title={t("messages.emptyTitle")} body={t("messages.emptyBody")} /> : undefined}
          renderSectionHeader={({ section }) =>
            section.key === "solved" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showSolved }}
                onPress={() => setShowSolved((v) => !v)}
                style={s.sectionRow}
              >
                <Text style={s.sectionTitle}>{section.title}</Text>
                <Ionicons name={showSolved ? "chevron-up" : "chevron-down"} size={16} color={theme.colors.textSecondary} />
              </Pressable>
            ) : (
              <Text style={[s.sectionTitle, s.sectionRow]}>{section.title}</Text>
            )
          }
          renderItem={({ item }) => {
            const title = item.subject ? caseTitle(item.subject as any, language) : t("messages.unknownCase");
            const icon = item.kind === "MATCH" ? "chatbubbles-outline" : item.observationType === "FOUND" ? "hand-left-outline" : "eye-outline";
            const helper = toHelperStatus(item.counterpart_helper);
            const preview = item.last
              ? `${item.last.mine ? t("messages.you") : ""}${item.last.body}`
              : item.kind === "OBSERVATION" ? t("messages.noChatYet") : t("messages.noMessagesYet");

            if (item.caseClosed) {
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={[title, t(roleKey(item)), t("messages.solved")].join(", ")}
                  onPress={() => open(item)}
                  style={({ pressed }) => [s.solvedRow, pressed && s.pressed]}
                >
                  <Ionicons name="checkmark-circle" size={18} color={theme.tone.success.icon} />
                  <Text style={s.solvedText} numberOfLines={1}>
                    {title} · {t(roleKey(item))}
                  </Text>
                  <Text style={s.time}>{formatTimeAgo(item.at, t, "short")}</Text>
                </Pressable>
              );
            }

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={[item.unread ? t("messages.unreadLabel") : "", title, t(roleKey(item)), preview].filter(Boolean).join(", ")}
                onPress={() => open(item)}
                style={({ pressed }) => [s.card, item.unread && s.cardUnread, pressed && s.pressed]}
              >
                {item.thumbnail_url ? (
                  <Image source={{ uri: item.thumbnail_url }} style={s.thumb} accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[s.thumb, s.thumbEmpty]}>
                    <Ionicons name={icon} size={20} color={theme.colors.primary} />
                  </View>
                )}
                <View style={s.text}>
                  <View style={s.row}>
                    <Text style={[s.title, item.unread && s.titleUnread]} numberOfLines={1}>{title}</Text>
                    {item.unread && <View style={s.dot} />}
                    <Text style={[s.time, item.unread && s.timeUnread]}>{formatTimeAgo(item.at, t, "short")}</Text>
                  </View>
                  <Text style={s.meta} numberOfLines={1}>
                    {t(roleKey(item))}
                    {helper ? (
                      <Text style={s.helper}>
                        {"  "}
                        {t(levelKey(helper.level))}
                        {helper.stars > 0 ? ` ${starText(helper.stars)}` : ""}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={[s.preview, item.unread && s.previewUnread]} numberOfLines={2}>{preview}</Text>
                </View>
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
  filters: { flexDirection: "row", gap: 6, backgroundColor: "#EEF2F6", borderRadius: 14, padding: 4 },
  filter: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  filterOn: { backgroundColor: theme.colors.card },
  filterText: { fontSize: 14, fontWeight: "700", color: theme.colors.textSecondary },
  filterTextOn: { color: theme.colors.text, fontWeight: "900" },
  list: { paddingHorizontal: 16, paddingBottom: 60, gap: 10 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, marginBottom: 4, minHeight: 32 },
  sectionTitle: { fontSize: 13, fontWeight: "900", letterSpacing: 0.6, color: theme.colors.textSecondary, textTransform: "uppercase" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.colors.card, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, padding: 12 },
  cardUnread: { borderColor: theme.colors.primary, borderWidth: 2 },
  pressed: { opacity: 0.86 },
  thumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: theme.tone.info.bg },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.colors.text },
  titleUnread: { fontWeight: "900" },
  time: { fontSize: 13, color: theme.colors.textSecondary },
  timeUnread: { color: theme.colors.primary, fontWeight: "800" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary },
  meta: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  helper: { fontSize: 13, fontWeight: "800", color: theme.tone.info.fg },
  preview: { fontSize: 14, color: theme.colors.textSecondary },
  previewUnread: { color: theme.colors.text, fontWeight: "700" },
  solvedRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  solvedText: { flex: 1, fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary },
});

export default requireAccount(MessagesScreen);
