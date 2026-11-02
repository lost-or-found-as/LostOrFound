// app/feedback-admin.tsx
// T1.9V: admin list of feedback from the app (Profil → Tilbakemeldinger, admins only).
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { requireAccount } from "../src/ui/AccountRequired";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDateTimeCustom } from "../src/i18n/formatters";
import { Button, EmptyState, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { FEEDBACK_KIND_KEYS, fetchAdminFeedback, markFeedbackDone, type FeedbackItem, type FeedbackKind } from "../src/lib/feedback";

type Tab = "new" | "done";

const KIND_COLORS: Record<FeedbackKind, { bg: string; fg: string }> = {
  IDEA: { bg: "#DBEAFE", fg: "#1E3A8A" },
  BUG: { bg: "#FEE2E2", fg: "#991B1B" },
  PRAISE: { bg: "#DCFCE7", fg: "#166534" },
  OTHER: { bg: "#F1F5F9", fg: "#334155" },
};

function Screen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [tab, setTab] = useState<Tab>("new");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setItems(await fetchAdminFeedback(tab));
      } catch {
        setError(t("feedbackAdmin.loadError"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (id: string) => {
    try {
      setBusyId(id);
      await markFeedbackDone(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      setError(t("feedbackAdmin.updateError"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("feedbackAdmin.title")} onBack={() => router.back()} raised>
        <View style={s.tabs} accessibilityRole="tablist">
          {(["new", "done"] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[s.tab, tab === key && s.tabOn]}
            >
              <Text style={[s.tabText, tab === key && s.tabTextOn]}>
                {t(key === "new" ? "feedbackAdmin.tabNew" : "feedbackAdmin.tabDone")}
                {key === "new" && tab === "new" && !loading ? ` · ${items.length}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScreenHeader>
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
        >
          {!!error && <InlineNotice tone="warning" title={error} actionLabel={t("errors.retry")} onAction={() => void load()} />}
          {!error && items.length === 0 && <EmptyState icon="chatbubbles-outline" title={t("feedbackAdmin.empty")} />}
          {items.map((item) => {
            const meta = [item.is_guest ? t("feedbackAdmin.guest") : null, item.platform, item.os_version, item.app_version, item.language]
              .filter(Boolean)
              .join(" · ");
            const color = KIND_COLORS[item.kind] ?? KIND_COLORS.OTHER;
            return (
              <View key={item.id} style={s.card}>
                <View style={s.cardTop}>
                  <Text style={[s.kind, { backgroundColor: color.bg, color: color.fg }]}>{t(FEEDBACK_KIND_KEYS[item.kind])}</Text>
                  <Text style={s.time}>
                    {formatDateTimeCustom(new Date(item.created_at), language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
                <Text style={s.message}>{item.message}</Text>
                {!!meta && <Text style={s.meta}>{meta}</Text>}
                {tab === "new" && (
                  <Button label={t("feedbackAdmin.markDone")} variant="neutral" busy={busyId === item.id} onPress={() => void done(item.id)} />
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

export default requireAccount(Screen);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 10 },
  tab: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  tabOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tabText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  tabTextOn: { color: "#FFFFFF" },
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kind: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  time: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  message: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.text },
  meta: { fontSize: 12, fontWeight: "700", color: theme.colors.textSecondary },
});
