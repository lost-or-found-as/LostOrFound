// app/chat/[matchId].tsx
// T1.9F: chat between the owner and the finder of a confirmed match.
// Messages and read receipts arrive live (Supabase realtime; subscribe after all callbacks are
// registered). "Lest" shows under your latest message once the other person has read it.
// The bar at the top lets either side propose that the case is resolved; the other confirms.
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { API_BASE_URL } from "../../src/lib/config";
import { useAuth } from "../../src/contexts/AuthContext";
import { theme } from "../../src/ui/theme";
import { useI18n } from "../../src/i18n/I18nProvider";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { formatDateTimeCustom, formatTime, type Translate } from "../../src/i18n/formatters";
import { setLastSeen } from "../../src/lib/unread";
import { caseTitle } from "../../src/lib/caseDisplay";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { Button, ConfirmSheet, InfoButton, ScreenHeader } from "../../src/ui/kit";

type Msg = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
type Resolution = { proposal?: { id: string; status: string } | null; role?: "PROPOSER" | "RESPONDER" | "PARTY" } | null;
type MatchInfo = { lost?: any; found?: any } | null;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateDividerLabel(iso: string, language: "no" | "en", t: Translate) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return t("time.today");
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("time.yesterday");
  return formatDateTimeCustom(date, language, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

async function authToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { language, t } = useI18n();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = useMemo(() => (Array.isArray(params?.matchId) ? params.matchId[0] : params?.matchId), [params?.matchId]);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo>(null);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);

  const scrollToEnd = (animated: boolean) =>
    setTimeout(() => {
      try {
        listRef.current?.scrollToEnd({ animated });
      } catch {}
    }, 40);

  // Records that this user has read the chat up to now (server row + local unread marker).
  const markRead = useCallback(async () => {
    if (!matchId || !user?.id) return;
    try {
      await setLastSeen(matchId);
      await supabase
        .from("conversation_reads")
        .upsert(
          { conversation_id: matchId, user_id: user.id, last_read_at: new Date().toISOString() },
          { onConflict: "conversation_id,user_id" },
        );
    } catch (e) {
      console.warn("[chat] mark read failed", e);
    }
  }, [matchId, user?.id]);

  const fetchOtherRead = useCallback(async () => {
    if (!matchId || !user?.id) return;
    const { data } = await supabase
      .from("conversation_reads")
      .select("user_id, last_read_at")
      .eq("conversation_id", matchId)
      .neq("user_id", user.id)
      .maybeSingle();
    setOtherReadAt((data as any)?.last_read_at ?? null);
  }, [matchId, user?.id]);

  const fetchMessages = useCallback(async () => {
    if (!matchId) return;
    try {
      const { data, error: dbError } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, created_at")
        .eq("conversation_id", matchId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (dbError) throw dbError;
      setMessages((data as any as Msg[]) ?? []);
      setError(null);
      scrollToEnd(false);
    } catch (e) {
      setError(userErrorMessage(e, t, "chat.loadError", "chat.load"));
    } finally {
      setLoading(false);
    }
  }, [matchId, t]);

  const loadMatch = useCallback(async () => {
    try {
      const token = await authToken();
      if (!token || !matchId) return;
      const r = await fetch(`${API_BASE_URL}/matches/${encodeURIComponent(matchId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setMatch(j?.match ?? null);
    } catch {}
  }, [matchId]);

  const loadResolution = useCallback(async () => {
    try {
      const token = await authToken();
      if (!token || !matchId) return;
      const r = await fetch(`${API_BASE_URL}/resolutions/context/MATCH/${encodeURIComponent(matchId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setResolution(j);
    } catch {}
  }, [matchId]);

  useEffect(() => {
    void loadMatch();
    void loadResolution();
  }, [loadMatch, loadResolution]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await fetchMessages();
        await fetchOtherRead();
        await markRead();
      })();
      return () => {};
    }, [fetchMessages, fetchOtherRead, markRead]),
  );

  // Live updates: register every .on(...) before .subscribe().
  useEffect(() => {
    if (!matchId || !user?.id) return;
    const channel = supabase
      .channel(`realtime:chat:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${matchId}` },
        (payload: any) => {
          const msg = payload?.new as Msg | undefined;
          if (!msg?.id) return;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev.filter((m) => !m.id.startsWith("tmp-") || m.body !== msg.body), msg]));
          scrollToEnd(true);
          if (msg.sender_id !== user.id) void markRead();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_reads", filter: `conversation_id=eq.${matchId}` },
        (payload: any) => {
          const row = payload?.new;
          if (row?.user_id && row.user_id !== user.id) setOtherReadAt(row.last_read_at ?? null);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, user?.id, markRead]);

  const sendMessage = useCallback(async () => {
    if (!matchId || !user?.id) return;
    const body = text.replace(/\s+/g, " ").trim();
    if (!body) return;
    setSending(true);
    setText("");
    const optimistic: Msg = { id: `tmp-${Date.now()}`, conversation_id: matchId, sender_id: user.id, body, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    scrollToEnd(true);
    try {
      const { error: dbError } = await supabase.from("messages").insert({ conversation_id: matchId, sender_id: user.id, body });
      if (dbError) throw dbError;
      setError(null);
      await fetchMessages();
      await markRead();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setText(body);
      setError(userErrorMessage(e, t, "chat.sendError", "chat.send"));
    } finally {
      setSending(false);
    }
  }, [matchId, user?.id, text, fetchMessages, markRead, t]);

  const proposeResolution = async () => {
    setResolutionBusy(true);
    try {
      const token = await authToken();
      const r = await fetch(`${API_BASE_URL}/resolutions/propose`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contextType: "MATCH", contextId: String(matchId) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && j?.error !== "RESOLUTION_ALREADY_PENDING") throw Object.assign(codedError(String(j?.error || "RESOLUTION_PROPOSE_FAILED")), { status: r.status });
      setProposeOpen(false);
      await loadResolution();
    } catch (e) {
      setProposeOpen(false);
      setError(userErrorMessage(e, t, "errors.generic", "resolution"));
    } finally {
      setResolutionBusy(false);
    }
  };

  const respondResolution = async (accept: boolean) => {
    const pid = resolution?.proposal?.id;
    if (!pid) return;
    setResolutionBusy(true);
    try {
      const token = await authToken();
      const r = await fetch(`${API_BASE_URL}/resolutions/${pid}/respond`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(codedError(String(j?.error || "RESOLUTION_RESPOND_FAILED")), { status: r.status });
      await loadResolution();
    } catch (e) {
      setError(userErrorMessage(e, t, "errors.generic", "resolution"));
    } finally {
      setResolutionBusy(false);
    }
  };

  if (!matchId) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title={t("chat.title")} onBack={() => router.back()} raised />
        <View style={styles.pad}>
          <InlineNotice tone="error" title={t("chat.unavailable")} />
        </View>
      </View>
    );
  }

  const youOwnLost = match?.lost?.user_id && match.lost.user_id === user?.id;
  const itemReport = match?.lost ?? match?.found;
  const title = itemReport ? caseTitle(itemReport, language) : t("chat.title");
  const subtitle = match ? t(youOwnLost ? "chat.subtitleOwner" : "chat.subtitleFinder") : t("chat.subtitle");

  const status = resolution?.proposal?.status;
  const role = resolution?.role;
  let resolutionBar: React.ReactNode = null;
  if (status === "ACCEPTED") {
    resolutionBar = (
      <InlineNotice tone="success" icon="checkmark-circle-outline" title={t("observation.resolution.closedTitle")} body={t("observation.resolution.closedBody")} style={styles.noMargin} />
    );
  } else if (status === "PENDING" && role === "PROPOSER") {
    resolutionBar = <InlineNotice tone="info" icon="time-outline" title={t("observation.resolution.pending")} style={styles.noMargin} />;
  } else if (status === "PENDING" && role === "RESPONDER") {
    resolutionBar = (
      <View style={styles.respondBox}>
        <Text style={styles.respondText}>{t("chat.resolution.confirmQuestion")}</Text>
        <View style={styles.respondRow}>
          <Button label={t("observation.resolution.decline")} variant="neutral" onPress={() => void respondResolution(false)} style={styles.flex1} disabled={resolutionBusy} />
          <Button label={t("observation.resolution.confirm")} onPress={() => void respondResolution(true)} style={styles.flex1} busy={resolutionBusy} />
        </View>
      </View>
    );
  } else if (match) {
    resolutionBar = (
      <View style={styles.resolveBar}>
        <Ionicons name="checkmark-circle-outline" size={20} color={theme.tone.success.icon} />
        <Text style={styles.resolveText}>{t("chat.resolvedQuestion")}</Text>
        <Pressable accessibilityRole="button" onPress={() => setProposeOpen(true)} style={({ pressed }) => [styles.resolveBtn, pressed && styles.pressed]}>
          <Text style={styles.resolveBtnText}>{t("chat.markResolved")}</Text>
        </Pressable>
      </View>
    );
  }

  const lastMineReadId = (() => {
    if (!otherReadAt) return null;
    const read = new Date(otherReadAt).getTime();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_id === user?.id && !m.id.startsWith("tmp-")) return new Date(m.created_at).getTime() <= read ? m.id : null;
    }
    return null;
  })();

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={() => router.back()}
        raised
        right={<InfoButton title={t("info.chat.title")} body={t("info.chat.body")} label={t("info.chat.label")} />}
      >
        {resolutionBar}
      </ScreenHeader>
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>{t("chat.loading")}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex1}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToEnd(false)}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <InlineNotice tone="warning" icon="shield-checkmark-outline" title={t("chat.safety")} style={styles.noMargin} />
                {!!error && <InlineNotice tone="error" title={error} style={styles.noMargin} />}
              </View>
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t("chat.emptyTitle")}</Text>
                <Text style={styles.muted}>{t("chat.emptyBody")}</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === user?.id;
              const previous = index > 0 ? messages[index - 1] : null;
              const showDate = !previous || dayKey(previous.created_at) !== dayKey(item.created_at);
              const meta = [formatTime(item.created_at, language), item.id === lastMineReadId ? t("chat.read") : null].filter(Boolean).join(" · ");
              return (
                <View>
                  {showDate && (
                    <View style={styles.dayRow}>
                      <Text style={styles.dayText}>{dateDividerLabel(item.created_at, language, t)}</Text>
                    </View>
                  )}
                  <View style={[styles.msgCol, mine ? styles.msgMine : styles.msgOther]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                      <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>
                    </View>
                    <Text style={styles.meta}>{meta}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
        <View style={[styles.composer, { paddingBottom: Math.max(12, insets.bottom + 4) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={theme.colors.textSecondary}
            accessibilityLabel={t("chat.messageLabel")}
            style={styles.input}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          <Pressable
            onPress={() => void sendMessage()}
            disabled={sending || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={t("chat.send")}
            style={({ pressed }) => [styles.sendBtn, (sending || !text.trim()) && styles.sendOff, pressed && styles.pressed]}
          >
            {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ConfirmSheet
        visible={proposeOpen}
        title={t("observation.resolution.proposeTitle")}
        body={t("chat.resolution.proposeBody")}
        confirmLabel={t("observation.resolution.sendProposal")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void proposeResolution()}
        onCancel={() => setProposeOpen(false)}
        busy={resolutionBusy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex1: { flex: 1 },
  pad: { padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  muted: { color: theme.colors.textSecondary, fontWeight: "600", fontSize: 14, textAlign: "center" },
  noMargin: { marginTop: 0 },
  resolveBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.tone.success.bg,
    borderWidth: 1,
    borderColor: theme.tone.success.border,
    borderRadius: 14,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 6,
  },
  resolveText: { flex: 1, fontSize: 13, fontWeight: "700", color: theme.tone.success.fg },
  resolveBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.tone.success.icon,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  resolveBtnText: { fontSize: 13, fontWeight: "800", color: theme.tone.success.fg },
  respondBox: {
    gap: 10,
    backgroundColor: theme.tone.info.bg,
    borderWidth: 1,
    borderColor: theme.tone.info.border,
    borderRadius: 14,
    padding: 12,
  },
  respondText: { fontSize: 14, fontWeight: "700", color: theme.tone.info.fg },
  respondRow: { flexDirection: "row", gap: 10 },
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
export default requireAccount(ChatScreen);
