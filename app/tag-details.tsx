// app/tag-details.tsx
// T1.9BS: one QR tag: the code, print the stickers, try the finder's page, pause, rename, delete,
// and the conversations finders started.
import React, { useCallback, useState } from "react";
import { FlatList, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { requireAccount } from "../src/ui/AccountRequired";
import { SkeletonDetail } from "../src/ui/Skeleton";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDateTimeCustom } from "../src/i18n/formatters";
import { Button, ConfirmSheet, EmptyState, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { haptic } from "../src/lib/haptics";
import {
  TAG_KIND_ICONS,
  TAG_KIND_KEYS,
  TAG_LABEL_MAX,
  deleteTag,
  fetchTagThreads,
  tagErrorKey,
  tagUrlWithLanguage,
  updateTag,
  type ItemTag,
  type TagThread,
} from "../src/lib/itemTags";

function Screen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const params = useLocalSearchParams<{ id?: string; created?: string }>();
  const id = String(params.id || "");
  const [tag, setTag] = useState<ItemTag | null>(null);
  const [threads, setThreads] = useState<TagThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void fetchTagThreads(id)
        .then((r) => {
          if (!live) return;
          setTag(r.tag);
          setThreads(r.threads);
          setError(null);
        })
        .catch((e: any) => live && setError(t(tagErrorKey(String(e?.code || "")))))
        .finally(() => live && setLoading(false));
      return () => {
        live = false;
      };
    }, [id, t]),
  );

  const run = async (fn: () => Promise<void>) => {
    try {
      setBusy(true);
      setError(null);
      await fn();
    } catch (e: any) {
      haptic.warning();
      setError(t(tagErrorKey(String(e?.code || ""))));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (active: boolean) =>
    run(async () => {
      if (!tag) return;
      const before = tag;
      setTag({ ...tag, active });
      try {
        setTag(await updateTag(tag.id, { active }));
      } catch (e) {
        setTag(before);
        throw e;
      }
    });

  const saveLabel = () =>
    run(async () => {
      if (!tag) return;
      setTag(await updateTag(tag.id, { label }));
      setEditing(false);
      haptic.success();
    });

  const remove = () =>
    run(async () => {
      if (!tag) return;
      await deleteTag(tag.id);
      setConfirmDelete(false);
      router.back();
    });

  const when = (iso: string) => formatDateTimeCustom(new Date(iso), language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (loading) {
    return (
      <View style={s.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title={t("tags.title")} onBack={() => router.back()} raised />
        <SkeletonDetail label={t("tags.loading")} />
      </View>
    );
  }

  if (!tag) {
    return (
      <View style={s.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title={t("tags.title")} onBack={() => router.back()} raised />
        <View style={s.list}>
          <InlineNotice tone="error" title={error || t("tags.error.generic")} />
        </View>
      </View>
    );
  }

  const title = tag.label || t(TAG_KIND_KEYS[tag.kind] || "tags.kind.other");

  const header = (
    <View style={s.gap}>
      {params.created === "1" ? <InlineNotice tone="success" icon="checkmark-circle-outline" title={t("tags.created.title")} body={t("tags.created.body")} /> : null}
      {error ? <InlineNotice tone="error" title={error} /> : null}
      <View style={s.card}>
        <View style={s.codeRow}>
          <Ionicons name={(TAG_KIND_ICONS[tag.kind] || "pricetag-outline") as any} size={26} color={theme.colors.text} />
          <View style={s.flex}>
            <Text style={s.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={s.code} selectable>
              {tag.displayCode}
            </Text>
          </View>
        </View>
        {editing ? (
          <View style={s.gap}>
            <TextInput
              accessibilityLabel={t("tags.form.label")}
              value={label}
              onChangeText={setLabel}
              maxLength={TAG_LABEL_MAX}
              placeholder={t("tags.form.labelPlaceholder")}
              placeholderTextColor="#64748B"
              style={s.input}
              autoFocus
            />
            <Button label={t("tags.rename.save")} onPress={saveLabel} busy={busy} />
            <Button label={t("common.cancel")} variant="neutral" onPress={() => setEditing(false)} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            style={s.link}
            onPress={() => {
              setLabel(tag.label || "");
              setEditing(true);
            }}
          >
            <Ionicons name="create-outline" size={16} color={theme.colors.primary} />
            <Text style={s.linkText}>{t("tags.rename.button")}</Text>
          </Pressable>
        )}
        <View style={s.switchRow}>
          <View style={s.flex}>
            <Text style={s.switchTitle}>{t("tags.active.title")}</Text>
            <Text style={s.note}>{t(tag.active ? "tags.active.on" : "tags.active.off")}</Text>
          </View>
          <Switch accessibilityLabel={t("tags.active.title")} value={tag.active} onValueChange={toggleActive} disabled={busy} />
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{t("tags.print.title")}</Text>
        <Text style={s.note}>{t("tags.print.body")}</Text>
        <Button label={t("tags.print.button")} onPress={() => void WebBrowser.openBrowserAsync(tagUrlWithLanguage(tag.printUrl, language))} />
        <Button label={t("tags.preview.button")} variant="neutral" onPress={() => void WebBrowser.openBrowserAsync(tagUrlWithLanguage(tag.pageUrl, language))} />
        <Button
          label={t("tags.share.button")}
          variant="neutral"
          onPress={() => void Share.share({ message: `${t("tags.share.message")}\n${tag.pageUrl}` })}
        />
      </View>

      <Text style={s.section}>{t("tags.threads.title")}</Text>
    </View>
  );

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={title} onBack={() => router.back()} raised />
      <FlatList
        data={threads}
        keyExtractor={(x) => x.id}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t("tags.threads.empty")} body={t("tags.threads.emptyBody")} />}
        ListFooterComponent={
          <View style={s.footer}>
            <Button label={t("tags.delete.button")} variant="neutral" onPress={() => setConfirmDelete(true)} />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [s.row, pressed && s.pressed]}
            onPress={() => router.push({ pathname: "/tag-thread", params: { id: item.id } })}
          >
            <View style={s.flex}>
              <Text style={s.rowMeta}>
                {when(item.last_message_at)}
                {item.status === "CLOSED" ? ` · ${t("tags.thread.closedShort")}` : item.status === "BLOCKED" ? ` · ${t("tags.thread.blockedShort")}` : ""}
              </Text>
              <Text style={[s.rowBody, item.unread && s.unread]} numberOfLines={2}>
                {item.lastMessage ? `${item.lastMessage.sender === "OWNER" ? `${t("tags.thread.you")}: ` : ""}${item.lastMessage.body}` : ""}
              </Text>
            </View>
            {item.unread ? <View style={s.dot} /> : null}
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
          </Pressable>
        )}
      />
      <ConfirmSheet
        visible={confirmDelete}
        title={t("tags.delete.title")}
        body={t("tags.delete.body")}
        confirmLabel={t("tags.delete.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
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
  gap: { gap: 10 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 20, fontWeight: "900", color: theme.colors.text },
  code: { marginTop: 2, fontSize: 18, fontWeight: "800", letterSpacing: 2, color: theme.colors.textSecondary },
  cardTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  note: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: "#FFFFFF",
  },
  link: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 36 },
  linkText: { fontSize: 14, fontWeight: "800", color: theme.colors.primary },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.colors.border },
  switchTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  section: { marginTop: 8, fontSize: 13, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color: theme.colors.textSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  pressed: { opacity: 0.7 },
  rowMeta: { fontSize: 12, fontWeight: "800", color: theme.colors.textSecondary },
  rowBody: { marginTop: 2, fontSize: 15, lineHeight: 20, fontWeight: "600", color: theme.colors.text },
  unread: { fontWeight: "900" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.dangerStrong },
  footer: { marginTop: 16 },
});
