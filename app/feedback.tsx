// app/feedback.tsx
// T1.9V: "Gi tilbakemelding" from Profile. Ideas, bugs and praise go to the admins (push, e-mail
// and the admin list in the app). App version, platform and language are sent with it.
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "../src/i18n/I18nProvider";
import { Button, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { FEEDBACK_KINDS, FEEDBACK_KIND_KEYS, FEEDBACK_MAX_LENGTH, sendFeedback, type FeedbackKind } from "../src/lib/feedback";

export default function FeedbackScreen() {
  const router = useRouter();
  const { t, language } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("IDEA");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = text.trim().length >= 3 && !busy;

  const send = async () => {
    if (!canSend) return;
    try {
      setBusy(true);
      setError(null);
      await sendFeedback({ kind, message: text, language });
      setSent(true);
      setText("");
    } catch (e: any) {
      const code = String(e?.code || e?.message || "");
      setError(code === "FEEDBACK_DAILY_LIMIT" ? t("feedback.error.limit") : t("feedback.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("feedback.title")} onBack={() => router.back()} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.select({ ios: "padding", android: undefined })}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {sent ? (
            <>
              <InlineNotice tone="success" icon="checkmark-circle-outline" title={t("feedback.sent.title")} body={t("feedback.sent.body")} />
              <Button label={t("feedback.sent.done")} onPress={() => router.back()} />
              <Button label={t("feedback.sent.more")} variant="secondary" onPress={() => setSent(false)} />
            </>
          ) : (
            <View style={s.card}>
              <Text style={s.intro}>{t("feedback.intro")}</Text>
              <View style={s.chips}>
                {FEEDBACK_KINDS.map((k) => (
                  <Pressable
                    key={k}
                    accessibilityRole="button"
                    accessibilityState={{ selected: k === kind }}
                    style={[s.chip, k === kind && s.chipOn]}
                    onPress={() => setKind(k)}
                  >
                    <Text style={[s.chipText, k === kind && s.chipTextOn]}>{t(FEEDBACK_KIND_KEYS[k])}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.label}>{t("feedback.messageLabel")}</Text>
              <TextInput
                accessibilityLabel={t("feedback.messageLabel")}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={FEEDBACK_MAX_LENGTH}
                placeholder={t("feedback.placeholder")}
                placeholderTextColor="#64748B"
                style={s.input}
                textAlignVertical="top"
              />
              <Text style={s.note}>{t("feedback.note")}</Text>
              {!!error && <InlineNotice tone="error" title={t("feedback.error.title")} body={error} />}
              <Button label={t("feedback.send")} onPress={send} busy={busy} disabled={!canSend} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  intro: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: theme.colors.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  chipTextOn: { color: "#FFFFFF" },
  label: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  input: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
    color: theme.colors.text,
    backgroundColor: "#FFFFFF",
  },
  note: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary },
});
