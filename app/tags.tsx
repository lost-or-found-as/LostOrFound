// app/tags.tsx
// T1.9BS: «QR-merker». The user makes a digital tag (and prints it), or claims a printed code.
// A finder who scans it writes to the owner on a web page, without the app.
import React, { useCallback, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { requireAccount } from "../src/ui/AccountRequired";
import { SkeletonList } from "../src/ui/Skeleton";
import { useI18n } from "../src/i18n/I18nProvider";
import { Button, EmptyState, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { haptic } from "../src/lib/haptics";
import {
  TAG_KINDS,
  TAG_KIND_ICONS,
  TAG_KIND_KEYS,
  TAG_LABEL_MAX,
  claimTag,
  createTag,
  fetchMyTags,
  formatTagCodeInput,
  tagErrorKey,
  type ItemTag,
  type TagKind,
} from "../src/lib/itemTags";

type Mode = "none" | "new" | "claim";

function Screen() {
  const router = useRouter();
  const { t } = useI18n();
  const [tags, setTags] = useState<ItemTag[] | null>(null);
  const [maxTags, setMaxTags] = useState(20);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<Mode>("none");
  const [kind, setKind] = useState<TagKind>("KEYS");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    void fetchMyTags()
      .then((r) => live && (setTags(r.tags), setMaxTags(r.maxTags), setLoadError(false)))
      .catch(() => live && (setTags((prev) => prev ?? []), setLoadError(true)));
    return () => {
      live = false;
    };
  }, []);
  useFocusEffect(load);

  const open = (m: Mode) => {
    setMode(m);
    setError(null);
    setLabel("");
    setCode("");
    setKind("KEYS");
  };

  const canSave = !busy && (mode === "new" || (mode === "claim" && code.replace(/-/g, "").length === 8));
  const save = async () => {
    if (!canSave) return;
    try {
      setBusy(true);
      setError(null);
      const tag = mode === "claim" ? await claimTag({ code, label, kind }) : await createTag({ label, kind });
      haptic.success();
      setMode("none");
      setTags((prev) => [tag, ...(prev || [])]);
      router.push({ pathname: "/tag-details", params: { id: tag.id, created: "1" } });
    } catch (e: any) {
      haptic.warning();
      setError(t(tagErrorKey(String(e?.code || e?.message || ""))));
    } finally {
      setBusy(false);
    }
  };

  const full = (tags?.length || 0) >= maxTags;

  const form =
    mode === "none" ? null : (
      <View style={s.card}>
        <Text style={s.cardTitle}>{t(mode === "claim" ? "tags.claim.title" : "tags.new.title")}</Text>
        {mode === "claim" ? (
          <>
            <Text style={s.label}>{t("tags.claim.codeLabel")}</Text>
            <TextInput
              accessibilityLabel={t("tags.claim.codeLabel")}
              value={code}
              onChangeText={(v) => setCode(formatTagCodeInput(v))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              placeholder="ABCD-2345"
              placeholderTextColor="#64748B"
              style={[s.input, s.codeInput]}
            />
          </>
        ) : null}
        <Text style={s.label}>{t("tags.form.kind")}</Text>
        <View style={s.chips}>
          {TAG_KINDS.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityState={{ selected: k === kind }}
              style={[s.chip, k === kind && s.chipOn]}
              onPress={() => setKind(k)}
            >
              <Ionicons name={TAG_KIND_ICONS[k] as any} size={16} color={k === kind ? "#FFFFFF" : theme.colors.text} />
              <Text style={[s.chipText, k === kind && s.chipTextOn]}>{t(TAG_KIND_KEYS[k])}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.label}>{t("tags.form.label")}</Text>
        <TextInput
          accessibilityLabel={t("tags.form.label")}
          value={label}
          onChangeText={setLabel}
          maxLength={TAG_LABEL_MAX}
          placeholder={t("tags.form.labelPlaceholder")}
          placeholderTextColor="#64748B"
          style={s.input}
        />
        <Text style={s.note}>{t("tags.form.labelNote")}</Text>
        {!!error && <InlineNotice tone="error" title={error} />}
        <Button label={t(mode === "claim" ? "tags.claim.save" : "tags.new.save")} onPress={save} busy={busy} disabled={!canSave} />
        <Button label={t("common.cancel")} variant="neutral" onPress={() => setMode("none")} />
      </View>
    );

  const header = (
    <View style={s.headerGap}>
      {loadError ? <InlineNotice tone="error" title={t("tags.loadError")} /> : null}
      <View style={s.intro}>
        <Ionicons name="qr-code-outline" size={28} color={theme.tone.info.fg} />
        <Text style={s.introText}>{t("tags.intro")}</Text>
      </View>
      {form}
      {mode === "none" ? (
        full ? (
          <InlineNotice tone="info" title={t("tags.error.limit")} />
        ) : (
          <>
            <Button label={t("tags.new.button")} onPress={() => open("new")} />
            <Button label={t("tags.claim.button")} variant="neutral" onPress={() => open("claim")} />
          </>
        )
      ) : null}
      {tags && tags.length ? <Text style={s.section}>{t("tags.mine")}</Text> : null}
    </View>
  );

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("tags.title")} onBack={() => router.back()} raised />
      {tags === null ? (
        <SkeletonList rows={3} />
      ) : (
        <KeyboardAvoidingView style={s.flex} behavior={Platform.select({ ios: "padding", android: undefined })}>
          <FlatList
            data={tags}
            keyExtractor={(x) => x.id}
            contentContainerStyle={s.list}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={header}
            ListEmptyComponent={loadError || mode !== "none" ? undefined : <EmptyState icon="pricetag-outline" title={t("tags.empty")} body={t("tags.emptyBody")} />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                onPress={() => router.push({ pathname: "/tag-details", params: { id: item.id } })}
              >
                <View style={s.rowIcon}>
                  <Ionicons name={(TAG_KIND_ICONS[item.kind] || "pricetag-outline") as any} size={22} color={theme.colors.text} />
                </View>
                <View style={s.flex}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {item.label || t(TAG_KIND_KEYS[item.kind] || "tags.kind.other")}
                  </Text>
                  <Text style={s.rowMeta}>
                    {item.displayCode}
                    {item.active ? "" : ` · ${t("tags.paused")}`}
                    {item.threads ? ` · ${t("tags.threadCount", { count: item.threads })}` : ""}
                  </Text>
                </View>
                {item.unread ? (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{item.unread}</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          />
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

export default requireAccount(Screen);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  headerGap: { gap: 10, marginBottom: 2 },
  intro: { flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: 16, backgroundColor: theme.tone.info.bg },
  introText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.tone.info.fg },
  card: { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  cardTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  label: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
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
  codeInput: { fontSize: 22, fontWeight: "800", letterSpacing: 2, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  chipTextOn: { color: "#FFFFFF" },
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
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg },
  rowTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  rowMeta: { marginTop: 2, fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.dangerStrong },
  badgeText: { fontSize: 12, fontWeight: "900", color: "#FFFFFF" },
});
