// app/tag-thread.tsx
// T1.9BS: a conversation with a finder who scanned one of the user's QR tags. The finder reads the
// answers on their own web page; neither side sees the other's contact details.
import React, { useCallback, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { requireAccount } from "../src/ui/AccountRequired";
import { SkeletonList } from "../src/ui/Skeleton";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDateTimeCustom } from "../src/i18n/formatters";
import { Button, ConfirmSheet, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { haptic } from "../src/lib/haptics";
import {
  TAG_KIND_KEYS,
  TAG_MESSAGE_MAX,
  fetchTagThread,
  replyToTagThread,
  setTagThreadStatus,
  tagErrorKey,
  type ItemTag,
  type TagMessage,
  type TagThread,
} from "../src/lib/itemTags";

function Screen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = String(params.id || "");
  const [thread, setThread] = useState<TagThread | null>(null);
  const [tag, setTag] = useState<ItemTag | null>(null);
  const [messages, setMessages] = useState<TagMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const listRef = useRef<FlatList<TagMessage>>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void fetchTagThread(id)
        .then((r) => {
          if (!live) return;
          setThread(r.thread);
          setTag(r.tag);
          setMessages(r.messages);
          setError(null);
        })
        .catch((e: any) => live && (setMessages((prev) => prev ?? []), setError(t(tagErrorKey(String(e?.code || ""))))));
      return () => {
        live = false;
      };
    }, [id, t]),
  );

  const send = async () => {
    const body = text.trim();
    if (body.length < 2 || busy) return;
    try {
      setBusy(true);
      setError(null);
      const m = await replyToTagThread(id, body);
      haptic.tap();
      setMessages((prev) => [...(prev || []), m]);
      setThread((prev) => (prev ? { ...prev, status: "OPEN" } : prev));
      setText("");
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      haptic.warning();
      setError(t(tagErrorKey(String(e?.code || ""))));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: TagThread["status"]) => {
    try {
      setBusy(true);
      setError(null);
      await setTagThreadStatus(id, status);
      setThread((prev) => (prev ? { ...prev, status } : prev));
      setConfirmBlock(false);
    } catch (e: any) {
      setError(t(tagErrorKey(String(e?.code || ""))));
    } finally {
      setBusy(false);
    }
  };

  const when = (iso: string) => formatDateTimeCustom(new Date(iso), language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const title = tag ? tag.label || t(TAG_KIND_KEYS[tag.kind] || "tags.kind.other") : t("tags.thread.title");
  const blocked = thread?.status === "BLOCKED";
  const closed = thread?.status === "CLOSED";

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={title} subtitle={t("tags.thread.subtitle")} onBack={() => router.back()} raised />
      {messages === null ? (
        <SkeletonList rows={3} thumb={false} />
      ) : (
        <KeyboardAvoidingView style={s.flex} behavior={Platform.select({ ios: "padding", android: undefined })} keyboardVerticalOffset={0}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={s.list}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListHeaderComponent={<InlineNotice tone="info" icon="shield-checkmark-outline" title={t("tags.thread.privacy")} />}
            renderItem={({ item }) => {
              const mine = item.sender === "OWNER";
              return (
                <View style={[s.bubble, mine ? s.mine : s.theirs]}>
                  <Text style={[s.who, mine && s.mineText]}>
                    {t(mine ? "tags.thread.you" : "tags.thread.finder")} · {when(item.created_at)}
                  </Text>
                  <Text style={[s.body, mine && s.mineText]} selectable>
                    {item.body}
                  </Text>
                </View>
              );
            }}
            ListFooterComponent={
              <View style={s.footer}>
                {error ? <InlineNotice tone="error" title={error} /> : null}
                {blocked ? <InlineNotice tone="warning" title={t("tags.thread.blocked")} /> : null}
                {closed ? <InlineNotice tone="info" title={t("tags.thread.closed")} /> : null}
                {blocked ? (
                  <Button label={t("tags.thread.unblock")} variant="neutral" onPress={() => void changeStatus("OPEN")} busy={busy} />
                ) : closed ? (
                  <Button label={t("tags.thread.reopen")} variant="neutral" onPress={() => void changeStatus("OPEN")} busy={busy} />
                ) : thread ? (
                  <View style={s.actions}>
                    <Button label={t("tags.thread.close")} variant="neutral" onPress={() => void changeStatus("CLOSED")} busy={busy} style={s.flex} />
                    <Button label={t("tags.thread.block")} variant="neutral" onPress={() => setConfirmBlock(true)} busy={busy} style={s.flex} />
                  </View>
                ) : null}
              </View>
            }
          />
          {thread && !blocked ? (
            <View style={s.composer}>
              <TextInput
                accessibilityLabel={t("tags.thread.placeholder")}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={TAG_MESSAGE_MAX}
                placeholder={t("tags.thread.placeholder")}
                placeholderTextColor="#64748B"
                style={s.input}
              />
              <Button label={t("tags.thread.send")} onPress={send} busy={busy} disabled={text.trim().length < 2} />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      )}
      <ConfirmSheet
        visible={confirmBlock}
        title={t("tags.thread.blockTitle")}
        body={t("tags.thread.blockBody")}
        confirmLabel={t("tags.thread.block")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void changeStatus("BLOCKED")}
        onCancel={() => setConfirmBlock(false)}
        destructive
        busy={busy}
      />
    </View>
  );
}

export default requireAccount(Screen);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 16 },
  bubble: { maxWidth: "86%", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, gap: 2 },
  mine: { alignSelf: "flex-end", backgroundColor: theme.colors.primary },
  theirs: { alignSelf: "flex-start", backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  who: { fontSize: 11, fontWeight: "800", color: theme.colors.textSecondary },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.text },
  mineText: { color: "#FFFFFF" },
  footer: { gap: 10, marginTop: 6 },
  actions: { flexDirection: "row", gap: 10 },
  composer: { gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.card },
  input: {
    minHeight: 48,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: "#FFFFFF",
  },
});
