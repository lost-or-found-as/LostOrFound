// app/(auth)/login.tsx
// T1.9S: sign in, create account, check-your-e-mail and forgot password in one screen.
// - The back button goes back, or to the start page when there is nothing behind.
// - Guests can explore the app and report found items; a lost report needs an account.
// - Google is offered on Android only until Sign in with Apple can be added on iPhone
//   (Apple requires both together).
// - Errors are shown in the screen, never as system alerts.
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { theme } from "../../src/ui/theme";
import { MIN_PASSWORD_LENGTH, useAuth } from "../../src/contexts/AuthContext";
import { supabase } from "../../src/lib/supabase";
import { ensureProfileRow } from "../../src/lib/profile";
import { useI18n } from "../../src/i18n/I18nProvider";
import { rememberGuestForClaim } from "../../src/lib/guestClaim";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { openLegal } from "../../src/lib/legal";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { BottomSheet, Button, IconButton } from "../../src/ui/kit";

type Mode = "login" | "signup" | "checkEmail";
const SHOW_GOOGLE = Platform.OS === "android";

function withTimeout<T>(p: Promise<T>, ms = 20000) {
  return Promise.race<T>([p, new Promise<T>((_, reject) => setTimeout(() => reject(codedError("TIMEOUT")), ms))]);
}

function isLostIntent(intent?: string, upgrade?: string, returnTo?: string) {
  return intent === "lost" || upgrade === "1" || String(returnTo ?? "").includes("create-report") || String(returnTo ?? "").includes("register");
}

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string; intent?: string; upgrade?: string; mode?: string }>();
  const { signInWithPassword, signUpWithPassword, refresh } = useAuth();
  const { language, t } = useI18n();

  const [mode, setMode] = useState<Mode>(params?.mode === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<null | "email" | "google" | "guest" | "resend">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotState, setForgotState] = useState<"idle" | "sending" | "sent">("idle");
  const [forgotError, setForgotError] = useState<string | null>(null);

  const returnTo = typeof params?.returnTo === "string" && params.returnTo.trim() ? params.returnTo : "";
  const lostIntent = useMemo(() => isLostIntent(params?.intent, params?.upgrade, returnTo), [params?.intent, params?.upgrade, returnTo]);
  const redirectTo = useMemo(() => Linking.createURL("auth-callback"), []);
  const recoveryRedirect = useMemo(() => Linking.createURL("auth-callback", { queryParams: { next: "new-password" } }), []);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/" as any));
  const goToApp = useCallback(() => router.replace((returnTo || "/") as any), [router, returnTo]);
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const submitEmail = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError(t("signin.missingFields"));
      return;
    }
    setBusy("email");
    try {
      if (mode === "signup") {
        const result = await withTimeout(signUpWithPassword(email.trim(), password));
        if (result.needsEmailConfirmation) {
          setMode("checkEmail");
          return;
        }
      } else {
        await withTimeout(signInWithPassword(email.trim(), password));
      }
      goToApp();
    } catch (e) {
      setError(userErrorMessage(e, t, "auth.login.unknown.error", mode === "signup" ? "auth.signup" : "auth.login"));
    } finally {
      setBusy(null);
    }
  };

  const resendConfirmation = async () => {
    setBusy("resend");
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (resendError) throw resendError;
      setInfo(t("signin.check.resent"));
    } catch (e) {
      setError(userErrorMessage(e, t, "auth.login.unknown.error", "auth.resend"));
    } finally {
      setBusy(null);
    }
  };

  const openMailApp = () => {
    void Linking.openURL(Platform.OS === "ios" ? "message://" : "mailto:").catch(() => {});
  };

  const sendReset = async () => {
    setForgotError(null);
    if (!forgotEmail.trim()) {
      setForgotError(t("signin.forgot.missing"));
      return;
    }
    setForgotState("sending");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), { redirectTo: recoveryRedirect });
      if (resetError) throw resetError;
      setForgotState("sent");
    } catch (e) {
      setForgotState("idle");
      setForgotError(userErrorMessage(e, t, "auth.login.unknown.error", "auth.reset"));
    }
  };

  const signInGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      await rememberGuestForClaim();
      const res: any = await withTimeout(supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } }) as any);
      if (res?.error) throw res.error;
      if (!res?.data?.url) throw codedError("OAUTH_NOT_READY");
      await Linking.openURL(res.data.url);
    } catch (e) {
      setError(userErrorMessage(e, t, "auth.login.unknown.error", "auth.oauth"));
    } finally {
      setBusy(null);
    }
  };

  const continueAsGuest = async () => {
    if (lostIntent) {
      setError(t("signin.guestLostBlocked"));
      return;
    }
    setBusy("guest");
    setError(null);
    try {
      const res: any = await withTimeout((supabase.auth as any).signInAnonymously());
      if (res?.error) throw res.error;
      const uid = res?.data?.session?.user?.id;
      if (uid) await ensureProfileRow(uid).catch(() => {});
      await refresh();
      // Small delay avoids a race between auth-state refresh and route replacement on some devices.
      setTimeout(goToApp, 50);
    } catch (e) {
      setError(userErrorMessage(e, t, "auth.login.unknown.error", "auth.guest"));
    } finally {
      setBusy(null);
    }
  };

  const legalLine = (
    <Text style={s.legal}>
      {t(mode === "signup" ? "signin.legalSignup" : "signin.legal")}{" "}
      <Text accessibilityRole="link" style={s.legalLink} onPress={() => void openLegal("terms", language)}>
        {t("signin.legalTerms")}
      </Text>{" "}
      {t("signin.legalAnd")}{" "}
      <Text accessibilityRole="link" style={s.legalLink} onPress={() => void openLegal("privacy", language)}>
        {t("signin.legalPrivacy")}
      </Text>
      .
    </Text>
  );

  if (mode === "checkEmail") {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.topRow, s.padded]}>
          <IconButton icon="arrow-back" label={t("common.back")} onPress={() => switchMode("signup")} />
        </View>
        <View style={s.checkBody}>
          <View style={s.checkIcon}>
            <Ionicons name="mail-outline" size={34} color={theme.tone.info.icon} />
          </View>
          <Text style={s.title} accessibilityRole="header">
            {t("signin.check.title")}
          </Text>
          <Text style={s.lead}>{t("signin.check.body", { email: email.trim() })}</Text>
          <Text style={s.muted}>{t("signin.check.spam")}</Text>
          {!!info && <InlineNotice tone="success" icon="checkmark-circle-outline" title={info} style={s.notice} />}
          {!!error && <InlineNotice tone="error" title={error} style={s.notice} />}
        </View>
        <View style={s.bottomActions}>
          <Button label={t("signin.check.openMail")} onPress={openMailApp} />
          <Button label={t("signin.check.resend")} variant="neutral" busy={busy === "resend"} onPress={() => void resendConfirmation()} />
          <Pressable accessibilityRole="button" style={s.textBtn} onPress={() => switchMode("login")}>
            <Text style={s.textBtnLabel}>{t("signin.check.backToLogin")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const signup = mode === "signup";
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.topRow}>
            <IconButton icon="arrow-back" label={t("common.back")} onPress={goBack} />
            <Text style={s.brand}>Lost or Found</Text>
          </View>

          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">
              {t(signup ? "signin.signupTitle" : "signin.loginTitle")}
            </Text>
            <Text style={s.lead}>{t(signup ? "signin.signupLead" : "signin.loginLead")}</Text>
          </View>

          {lostIntent && <InlineNotice tone="warning" icon="information-circle-outline" title={t("signin.lostNotice")} style={s.notice} />}

          <View style={s.field}>
            <Text style={s.label}>{t("auth.login.email")}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t("auth.login.name.email.com")}
              placeholderTextColor={theme.colors.textSecondary}
              accessibilityLabel={t("auth.login.email")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              style={s.input}
            />
          </View>
          <View style={s.field}>
            <View style={s.labelRow}>
              <Text style={s.label}>{t(signup ? "signin.choosePassword" : "auth.login.password")}</Text>
              {!signup && (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    setForgotEmail(email.trim());
                    setForgotState("idle");
                    setForgotError(null);
                    setForgotOpen(true);
                  }}
                >
                  <Text style={s.inlineLink}>{t("auth.login.forgot.password")}</Text>
                </Pressable>
              )}
            </View>
            <View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                accessibilityLabel={t(signup ? "signin.choosePassword" : "auth.login.password")}
                textContentType={signup ? "newPassword" : "password"}
                autoComplete={signup ? "new-password" : "current-password"}
                autoCapitalize="none"
                style={[s.input, s.passwordInput]}
                onSubmitEditing={() => void submitEmail()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(showPassword ? "signin.hidePassword" : "signin.showPassword")}
                onPress={() => setShowPassword((v) => !v)}
                style={s.eye}
              >
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            {signup && <Text style={s.muted}>{t("signin.passwordRule", { count: MIN_PASSWORD_LENGTH })}</Text>}
          </View>

          {!!error && <InlineNotice tone="error" title={error} style={s.notice} />}

          <Button label={t(signup ? "auth.login.create.account" : "auth.login.log.in")} busy={busy === "email"} onPress={() => void submitEmail()} />
          <Pressable accessibilityRole="button" style={s.switchRow} onPress={() => switchMode(signup ? "login" : "signup")}>
            <Text style={s.switchText}>
              {t(signup ? "signin.haveAccount" : "signin.newHere")} <Text style={s.switchStrong}>{t(signup ? "auth.login.log.in" : "auth.login.create.account")}</Text>
            </Text>
          </Pressable>

          <View style={s.divider}>
            <View style={s.line} />
            <Text style={s.dividerText}>{t("signin.or")}</Text>
            <View style={s.line} />
          </View>

          {SHOW_GOOGLE && (
            <Pressable
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() => void signInGoogle()}
              style={({ pressed }) => [s.social, pressed && s.pressed]}
            >
              {busy === "google" ? <ActivityIndicator /> : <Ionicons name="logo-google" size={20} color={theme.colors.text} />}
              <Text style={s.socialText}>{t("signin.google")}</Text>
            </Pressable>
          )}

          {!signup && (
            <Pressable
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() => void continueAsGuest()}
              style={({ pressed }) => [s.guest, pressed && s.pressed]}
            >
              {busy === "guest" ? <ActivityIndicator /> : <Ionicons name="compass-outline" size={28} color={theme.colors.text} />}
              <View style={s.guestText}>
                <Text style={s.guestTitle}>{t("signin.guestTitle")}</Text>
                <Text style={s.guestBody}>{t("signin.guestBody")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          )}

          {legalLine}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet visible={forgotOpen} onClose={() => setForgotOpen(false)} accessibilityLabel={t("common.close")}>
        <Text style={s.sheetTitle} accessibilityRole="header">
          {t("signin.forgot.title")}
        </Text>
        <Text style={s.lead}>{t("signin.forgot.body")}</Text>
        <TextInput
          value={forgotEmail}
          onChangeText={setForgotEmail}
          placeholder={t("auth.login.name.email.com")}
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel={t("auth.login.email")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={s.input}
        />
        {!!forgotError && <InlineNotice tone="error" title={forgotError} style={s.notice} />}
        {forgotState === "sent" ? (
          <InlineNotice tone="success" icon="checkmark-circle-outline" title={t("signin.forgot.sent")} style={s.notice} />
        ) : (
          <Button label={t("signin.forgot.send")} busy={forgotState === "sending"} onPress={() => void sendReset()} />
        )}
        <Button label={t("common.close")} variant="neutral" onPress={() => setForgotOpen(false)} />
      </BottomSheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8, paddingHorizontal: 0 },
  padded: { paddingHorizontal: 20 },
  brand: { fontSize: 14, fontWeight: "800", color: theme.colors.textSecondary },
  head: { gap: 6 },
  title: { fontSize: 30, fontWeight: "900", color: theme.colors.text },
  lead: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: theme.colors.textSecondary },
  muted: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary },
  notice: { marginTop: 0, marginBottom: 0 },
  field: { gap: 6 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  inlineLink: { fontSize: 14, fontWeight: "800", color: theme.colors.text, textDecorationLine: "underline" },
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
  passwordInput: { paddingRight: 52 },
  eye: { position: "absolute", right: 4, top: 4, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  switchRow: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
  switchText: { fontSize: 15, fontWeight: "700", color: theme.colors.textSecondary },
  switchStrong: { color: theme.colors.text, fontWeight: "900", textDecorationLine: "underline" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  social: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  socialText: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  guest: {
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  guestText: { flex: 1, gap: 2 },
  guestTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  guestBody: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  pressed: { opacity: 0.85 },
  legal: { fontSize: 12, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center", marginTop: 4 },
  legalLink: { fontWeight: "800", color: theme.colors.text, textDecorationLine: "underline" },
  sheetTitle: { fontSize: 22, fontWeight: "900", color: theme.colors.text },
  checkBody: { flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: 20 },
  checkIcon: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: theme.tone.info.bg,
    borderWidth: 1,
    borderColor: theme.tone.info.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomActions: { gap: 10, paddingHorizontal: 20, paddingBottom: 12 },
  textBtn: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
  textBtnLabel: { fontSize: 15, fontWeight: "800", color: theme.colors.text, textDecorationLine: "underline" },
});
