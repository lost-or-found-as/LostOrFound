// app/(auth)/new-password.tsx
// T1.9S: opened from the password-reset e-mail (via auth-callback, which has already signed the
// user in with the link). The user chooses a new password and continues into the app.
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../src/lib/supabase";
import { MIN_PASSWORD_LENGTH, useAuth } from "../../src/contexts/AuthContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { userErrorMessage } from "../../src/lib/userError";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { Button } from "../../src/ui/kit";
import { theme } from "../../src/ui/theme";

export default function NewPasswordScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("signin.passwordRule", { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== repeat) {
      setError(t("signin.newPassword.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.replace("/(tabs)" as any);
    } catch (e) {
      setError(userErrorMessage(e, t, "auth.login.unknown.error", "auth.newPassword"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.brand}>Lost or Found</Text>
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">
              {t("signin.newPassword.title")}
            </Text>
            {!!user?.email && <Text style={s.lead}>{t("signin.newPassword.for", { email: user.email })}</Text>}
          </View>
          <View style={s.field}>
            <Text style={s.label}>{t("signin.newPassword.label")}</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel={t("signin.newPassword.label")}
              style={s.input}
            />
            <Text style={s.muted}>{t("signin.passwordRule", { count: MIN_PASSWORD_LENGTH })}</Text>
          </View>
          <View style={s.field}>
            <Text style={s.label}>{t("signin.newPassword.repeat")}</Text>
            <TextInput
              value={repeat}
              onChangeText={setRepeat}
              secureTextEntry
              textContentType="newPassword"
              accessibilityLabel={t("signin.newPassword.repeat")}
              style={s.input}
              onSubmitEditing={() => void save()}
            />
          </View>
          {!!error && <InlineNotice tone="error" title={error} style={s.notice} />}
          <Button label={t("signin.newPassword.save")} busy={busy} onPress={() => void save()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  content: { padding: 20, gap: 16 },
  brand: { fontSize: 14, fontWeight: "800", color: theme.colors.textSecondary },
  head: { gap: 6 },
  title: { fontSize: 30, fontWeight: "900", color: theme.colors.text },
  lead: { fontSize: 15, fontWeight: "600", color: theme.colors.textSecondary },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  muted: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  notice: { marginTop: 0, marginBottom: 0 },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: theme.colors.card,
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.colors.text,
  },
});
