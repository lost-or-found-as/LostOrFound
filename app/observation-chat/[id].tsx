// app/observation-chat/[id].tsx
// T1.9W: chat between the owner and the person who sent an observation. Looks like the match
// chat (app/chat/[matchId].tsx). Messages are polled every 4 seconds through the API.
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/ui/theme";
import { useI18n } from "../../src/i18n/I18nProvider";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { formatDayLabel, formatTime } from "../../src/i18n/formatters";
import { ChatClosedBar, ChatSafetyMenu, useChatSafety } from "../../src/ui/ChatSafety";
import { unblockChatPartner } from "../../src/lib/chatSafety";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { ScreenHeader } from "../../src/ui/kit";
import { useObservationResolution } from "../../src/lib/observationResolution";
import { ObservationResolution } from "../../src/ui/ObservationResolution";

type Msg = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };

const POLL_MS = 4000;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function Screen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language, t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const observationId = id ? String(id) : "";

  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);
  const resolution = useObservationResolution(observationId || undefined);
  // T1.9M: report and block. A closed chat replaces the message field with a notice.
  const safety = useChatSafety("observation", observationId);
  const [reportSent, setReportSent] = useState(false);
  const [unblocking, setUnblocking] = useState(false);

  const scrollToEnd = (animated: boolean) =>
    setTimeout(() => {
      try {
        listRef.current?.scrollToEnd({ animated });
      } catch {}
    }, 50);

  const auth = async () => {
    const session = await supabase.auth.getSession();
    setUid(session.data.session?.user?.id || "");
    return session.data.session?.access_token ?? null;
  };

  const load = useCallback(async () => {
    try {
      const authToken = await auth();
      // Fixed: this used to test the translate function instead of the token.
      if (!authToken) return;
      const r = await fetch(`${API_BASE_URL}/observation-chat/${id}/messages`, { headers: { Authorization: `Bearer ${authToken}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(codedError(String(j?.error || "OBSERVATION_CHAT_LOAD_FAILED")), { status: r.status });
      setMessages(j.messages || []);
      setLoadError(null);
    } catch (e: any) {
      console.warn("[observation-chat] load failed", e?.message || String(e));
      setLoadError(userErrorMessage(e, t, "chat.loadError", null));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const send = async () => {
    const body = text.replace(/\s+/g, " ").trim();
    if (!body) return;
    setSending(true);
    try {
      const authToken = await auth();
      const r = await fetch(`${API_BASE_URL}/observation-chat/${id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(codedError(String(j?.error || "OBSERVATION_CHAT_SEND_FAILED")), { status: r.status });
      setText("");
      setError(null);
      await load();
      scrollToEnd(true);
    } catch (e) {
      // The server refuses messages in a closed chat; then the closed bar explains it.
      const state = await safety.reload();
      setError(state?.closed ? null : userErrorMessage(e, t, "chat.sendError", "observation.chat"));
    } finally {
      setSending(false);
    }
  };

  const unblock = async () => {
    setUnblocking(true);
    try {
      safety.setState(await unblockChatPartner("observation", observationId));
    } catch (e) {
      setError(userErrorMessage(e, t, "errors.generic", "chat.safety"));
    } finally {
      setUnblocking(false);
    }
  };

  const canSend = !sending && !!text.trim();

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={t("observation.chat.title")}
        subtitle={t("observation.chat.subtitle")}
        onBack={() => router.back()}
        raised
        right={
          observationId ? (
            <ChatSafetyMenu
              kind="observation"
              id={observationId}
              partner="other"
              state={safety.state}
              onState={safety.setState}
              onReported={() => setReportSent(true)}
              aboutText={t("observation.chat.aboutBody")}
            />
          ) : null
        }
      >
        <ObservationResolution controller={resolution} variant="bar" canPropose={!safety.state.closed} />
      </ScreenHeader>
      <KeyboardAvoidingView style={s.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator />
            <Text style={s.muted}>{t("chat.loading")}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={s.flex1}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={s.listContent}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToEnd(false)}
            ListHeaderComponent={
              <View style={s.listHeader}>
                <InlineNotice tone="warning" icon="shield-checkmark-outline" title={t("chat.safety")} style={s.noMargin} />
                {reportSent && <InlineNotice tone="success" icon="checkmark-circle-outline" title={t("safety.reportSent")} style={s.noMargin} />}
                {!!loadError && (
                  <InlineNotice
                    tone="warning"
                    title={t("chat.loadError")}
                    body={loadError === t("chat.loadError") ? undefined : loadError}
                    actionLabel={t("errors.retry")}
                    onAction={() => void load()}
                    style={s.noMargin}
                  />
                )}
                {!!error && <InlineNotice tone="error" title={error} style={s.noMargin} />}
              </View>
            }
            ListEmptyComponent={
              safety.state.closed || loadError ? null : (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>{t("chat.emptyTitle")}</Text>
                  <Text style={s.muted}>{t("chat.emptyBody")}</Text>
                </View>
              )
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === uid;
              const previous = index > 0 ? messages[index - 1] : null;
              const showDate = !previous || dayKey(previous.created_at) !== dayKey(item.created_at);
              return (
                <View>
                  {showDate && (
                    <View style={s.dayRow}>
                      <Text style={s.dayText}>{formatDayLabel(item.created_at, language, t)}</Text>
                    </View>
                  )}
                  <View style={[s.msgCol, mine ? s.msgMine : s.msgOther]}>
                    <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
                      <Text style={[s.body, mine && s.bodyMine]}>{item.body}</Text>
                    </View>
                    <Text style={s.meta}>{formatTime(item.created_at, language)}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
        {safety.state.closed ? (
          <ChatClosedBar state={safety.state} partner="other" onUnblock={() => void unblock()} busy={unblocking} bottomInset={insets.bottom} />
        ) : (
          <View style={[s.composer, { paddingBottom: Math.max(12, insets.bottom + 4) }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t("chat.placeholder")}
              placeholderTextColor={theme.colors.textSecondary}
              accessibilityLabel={t("chat.messageLabel")}
              style={s.input}
              multiline
              maxLength={1000}
              editable={!sending}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={t("chat.send")}
              style={({ pressed }) => [s.sendBtn, !canSend && s.sendOff, pressed && s.pressed]}
            >
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  muted: { color: theme.colors.textSecondary, fontWeight: "600", fontSize: 14, textAlign: "center" },
  noMargin: { marginTop: 0 },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  listHeader: { gap: 10, marginBottom: 6 },
  empty: { flex: 1, minHeight: 200, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  dayRow: { alignItems: "center", marginVertical: 10 },
  dayText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.textSecondary,
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  msgCol: { maxWidth: "80%", marginBottom: 8, gap: 3 },
  msgMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  msgOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10 },
  bubbleMine: { backgroundColor: theme.colors.primary, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderBottomLeftRadius: 6 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "500", color: theme.colors.text },
  bodyMine: { color: "#FFFFFF" },
  meta: { fontSize: 11, fontWeight: "600", color: theme.colors.textSecondary, paddingHorizontal: 6 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  sendBtn: { width: 46, height: 46, borderRadius: 999, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(Screen);
