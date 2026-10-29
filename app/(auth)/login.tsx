// app/(auth)/login.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { theme } from "../../src/ui/theme";
import { useAuth } from "../../src/contexts/AuthContext";
import { supabase } from "../../src/lib/supabase";
import { ensureProfileRow } from "../../src/lib/profile";
import { useI18n } from "../../src/i18n/I18nProvider";
import { rememberGuestForClaim } from "../../src/lib/guestClaim";

type OAuthStartResult = {
  data?: { url?: string | null } | null;
  error?: { message?: string } | null;
};

type GuestResult = {
  data?: any;
  error?: { message?: string } | null;
};

const STRIPE_BG = "#F6F7FB";
const STRIPE_CARD = "#FFFFFF";
const STRIPE_BORDER = "#E5E7EB";
const STRIPE_TEXT = "#111827";
const STRIPE_MUTED = "#6B7280";
const STRIPE_ACCENT = "#635BFF";
const STRIPE_ACCENT_SOFT = "#EEF2FF";
const WARNING_BG = "#FFF7ED";
const WARNING_BORDER = "#FDBA74";
const WARNING_TEXT = "#9A3412";

function withTimeout<T>(p: Promise<T>, ms = 15000, label = "Operasjon") {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${Math.round(ms / 1000)}s)`)), ms)
    ),
  ]);
}

function isLostIntent(intent?: string, upgrade?: string, returnTo?: string) {
  return intent === "lost" || upgrade === "1" || String(returnTo ?? "").includes("create-report");
}

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string; intent?: string; upgrade?: string; mode?: string }>();
  const { signInWithPassword, signUpWithPassword, refresh } = useAuth();
  const { language, t } = useI18n();

  const [mode, setMode] = useState<"login" | "signup">(params?.mode === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<"apple" | "google" | "guest" | null>(null);
  const [showGuestInfo, setShowGuestInfo] = useState(false);

  const returnTo = useMemo(() => {
    const rt = params?.returnTo;
    return typeof rt === "string" && rt.trim() ? rt : "";
  }, [params?.returnTo]);

  const lostIntent = useMemo(
    () => isLostIntent(params?.intent, params?.upgrade, returnTo),
    [params?.intent, params?.upgrade, returnTo]
  );

  const goToApp = useCallback(() => {
    if (returnTo) {
      router.replace(returnTo as any);
      return;
    }
    router.replace("/" as any);
  }, [router, returnTo]);

  const redirectTo = useMemo(() => Linking.createURL("auth-callback"), []);
  const anyBusy = submitting || !!busy;

  const onSubmitEmail = useCallback(async () => {
    try {
      if (!email.trim() || !password) {
        Alert.alert(t("auth.login.missing.information"), t("auth.login.enter.email.and.password"));
        return;
      }

      setSubmitting(true);

      if (mode === "signup") {
        const result = await withTimeout(
          signUpWithPassword(email.trim(), password),
          20000,
          t("auth.login.create.account")
        );

        if (result.needsEmailConfirmation) {
          Alert.alert(
            t("auth.login.check.your.email"),
            t("auth.login.the.account.has.been.created.but.the.email.must.be.conf")
          );
          setMode("login");
          return;
        }

        Alert.alert(t("auth.login.account.created"), t("auth.login.you.are.now.logged.in"));
        goToApp();
        return;
      }

      await withTimeout(signInWithPassword(email.trim(), password), 20000, t("auth.login.login"));
      goToApp();
    } catch (e: any) {
      Alert.alert(mode === "signup" ? t("auth.login.sign.up.failed") : t("auth.login.login.failed"), e?.message ?? t("auth.login.unknown.error"));
    } finally {
      setSubmitting(false);
    }
  }, [email, password, mode, signInWithPassword, signUpWithPassword, goToApp, t]);

  const signInOAuth = useCallback(
    async (provider: "apple" | "google") => {
      try {
        setBusy(provider);
        await rememberGuestForClaim();
        const res = (await withTimeout<OAuthStartResult>(
          supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo },
          }) as any,
          20000,
          t("auth.login.oauth")
        )) as OAuthStartResult;

        const url = res?.data?.url ?? null;
        const errMsg = res?.error?.message;
        if (errMsg) throw new Error(errMsg);
        if (!url) {
          Alert.alert(
            t("auth.login.login.is.not.ready"),
            t("auth.login.supabase.did.not.return.a.url.check.that.provider.and.r")
          );
          return;
        }
        await Linking.openURL(url);
      } catch (e: any) {
        Alert.alert(t("auth.login.login.failed"), e?.message ?? t("auth.login.unknown.error"));
      } finally {
        setBusy(null);
      }
    },
    [redirectTo, t]
  );

  const signInAsGuest = useCallback(async () => {
    if (lostIntent) {
      Alert.alert(
        t("auth.login.account.required"),
        t("auth.login.guests.can.report.found.items.but.you.must.create.an.ac")
      );
      return;
    }

    try {
      setBusy("guest");
      const fn = (supabase.auth as any).signInAnonymously;
      if (typeof fn !== "function") {
        Alert.alert(
          t("auth.login.guest.is.not.configured"),
          t("auth.login.the.supabase.client.does.not.have.signinanonymously.upd")
        );
        return;
      }

      const res = (await withTimeout<GuestResult>(fn.call(supabase.auth), 15000, t("auth.login.guest"))) as GuestResult;
      const errMsg = res?.error?.message;
      if (errMsg) throw new Error(errMsg);

      const uid = res?.data?.session?.user?.id;
      if (uid) {
        try {
          await ensureProfileRow(uid);
        } catch (profileErr) {
          console.warn("[login] ensureProfileRow guest warning", profileErr);
        }
      }

      await refresh();

      // Small delay avoids a race between auth-state refresh and route replacement on some devices.
      setTimeout(() => {
        goToApp();
      }, 50);
    } catch (e: any) {
      Alert.alert(t("auth.login.guest.login.failed"), e?.message ?? t("auth.login.unknown.error"));
     } finally {
      setBusy(null);
    }
  }, [goToApp, lostIntent, refresh, t]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
            hitSlop={10}
          >
            <Text style={styles.backTxt}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>

        <View style={styles.header}>
          <Text style={styles.hTitle}>{mode === "signup" ? t("auth.login.create.account") : t("auth.login.log.in.to.your.account")}</Text>
          <Text style={styles.hSub}>
            {lostIntent
              ? t("auth.login.you.need.an.account.to.report.something.you.lost.guests")
              : mode === "signup"
              ? t("auth.login.create.an.account.with.email.and.password")
              : t("auth.login.email.and.password.first.other.options.below")}
          </Text>
        </View>

        {lostIntent && (
          <View style={styles.warningBox}>
            <Text style={styles.warningTitle}> {t("auth.login.account.required.for.lost.report")}</Text>
            <Text style={styles.warningText}> {t("auth.login.continue.as.guest.is.only.for.reporting.found.items")}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}> {t("auth.login.email")}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t("auth.login.name.email.com")}
            placeholderTextColor={STRIPE_MUTED}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
            editable={!anyBusy}
          />

          <View style={styles.labelRow}>
            <Text style={styles.label}> {t("auth.login.password")}</Text>
            {mode === "login" && (
              <Pressable
                onPress={() => Alert.alert(t("auth.login.coming"), t("auth.login.we.will.add.password.reset.when.the.flow.is.decided"))}
                disabled={anyBusy}
              >
                <Text style={styles.link}> {t("auth.login.forgot.password")}</Text>
              </Pressable>
            )}
          </View>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={STRIPE_MUTED}
            secureTextEntry
            style={styles.input}
            editable={!anyBusy}
          />

          <Pressable
            onPress={() => setRemember((v) => !v)}
            style={({ pressed }) => [styles.rememberRow, pressed && { opacity: 0.8 }]}
            disabled={anyBusy}
          >
            <View style={[styles.checkbox, remember && styles.checkboxOn]}>
              {remember && <Text style={styles.checkboxTick}>✓</Text>}
            </View>
            <Text style={styles.rememberTxt}> {t("auth.login.remember.me.on.this.device")}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.signInBtn, (pressed || anyBusy) && { opacity: 0.85 }]}
            disabled={anyBusy}
            onPress={onSubmitEmail}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signInTxt}>{mode === "signup" ? t("auth.login.create.account") : t("auth.login.log.in")}</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.switchModeBtn, pressed && { opacity: 0.85 }]}
            disabled={anyBusy}
            onPress={() => setMode((m) => (m === "login" ? "signup" : "login"))}
          >
            <Text style={styles.switchModeTxt}>
              {mode === "login" ? t("auth.login.new.user.create.account") : t("auth.login.already.have.an.account.log.in")}
            </Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerTxt}> {t("auth.login.or.log.in.with")}</Text>
            <View style={styles.divider} />
          </View>

          <Pressable
            style={({ pressed }) => [styles.socialBtn, pressed && { backgroundColor: STRIPE_ACCENT_SOFT }]}
            disabled={anyBusy}
            onPress={() => signInOAuth("google")}
          >
            <Image source={require("../../assets/images/google_g.png")} style={styles.googleIcon} />
            {busy === "google" ? <ActivityIndicator /> : <Text style={styles.socialTxt}>Google</Text>}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.socialBtn, pressed && { backgroundColor: STRIPE_ACCENT_SOFT }]}
            disabled={true}
            onPress={() => {}}
          >
            <Text style={styles.socialIcon}></Text>
            <Text style={styles.socialTxt}> {t("auth.login.apple.coming")}</Text>
          </Pressable>

          <View style={{ height: 10 }} />

          <Pressable
            style={({ pressed }) => [styles.guestBtn, lostIntent && styles.guestBtnDisabled, pressed && { opacity: 0.85 }]}
            disabled={anyBusy}
            onPress={signInAsGuest}
          >
            {busy === "guest" ? <ActivityIndicator /> : <Text style={styles.guestTxt}> {t("auth.login.continue.as.guest.found.only")}</Text>}
          </Pressable>

          <Pressable
            onPress={() => setShowGuestInfo((v) => !v)}
            style={({ pressed }) => [styles.guestInfoToggle, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.guestInfoToggleTxt}>{showGuestInfo ? t("auth.login.hide") : t("auth.login.what.does.guest.mean")}</Text>
          </Pressable>

          {showGuestInfo && (
            <View style={styles.guestInfoBox}>
              <Text style={styles.guestInfoTitle}> {t("auth.login.guest.limitations")}</Text>
              <Text style={styles.guestInfoLine}> {t("auth.login.can.publish.found.reports")}</Text>
              <Text style={styles.guestInfoLine}> {t("auth.login.cannot.create.lost.reports")}</Text>
              <Text style={styles.guestInfoLine}> {t("auth.login.cannot.use.chat.until.an.account.is.created")}</Text>
            </View>
          )}
        </View>

        <Text style={styles.foot}> {t("auth.login.by.logging.in.continuing.you.accept.the.terms.and.priva")}</Text>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: STRIPE_BG,
    paddingHorizontal: 18,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: STRIPE_CARD,
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backTxt: {
    fontSize: 18,
    color: STRIPE_TEXT,
    fontWeight: "900",
    marginTop: Platform.OS === "ios" ? -1 : 0,
  },
  header: { marginTop: 10, marginBottom: 14 },
  hTitle: { fontSize: 22, fontWeight: "900", color: STRIPE_TEXT },
  hSub: { marginTop: 6, color: STRIPE_MUTED, fontSize: 13, lineHeight: 18 },
  warningBox: {
    borderWidth: 1,
    borderColor: WARNING_BORDER,
    backgroundColor: WARNING_BG,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  warningTitle: { color: WARNING_TEXT, fontWeight: "900", marginBottom: 4 },
  warningText: { color: WARNING_TEXT, fontWeight: "700", lineHeight: 18 },
  card: {
    backgroundColor: STRIPE_CARD,
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    borderRadius: theme.radius.lg,
    padding: 16,
  },
  label: { color: STRIPE_TEXT, fontWeight: "800", marginBottom: 6 },
  labelRow: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { color: STRIPE_ACCENT, fontWeight: "800" },
  input: {
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#fff",
    fontSize: 16,
    color: STRIPE_TEXT,
  },
  rememberRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 10 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxOn: { borderColor: STRIPE_ACCENT, backgroundColor: STRIPE_ACCENT },
  checkboxTick: { color: "#fff", fontWeight: "900", fontSize: 12, marginTop: -1 },
  rememberTxt: { color: STRIPE_TEXT, fontWeight: "700" },
  signInBtn: {
    marginTop: 14,
    backgroundColor: STRIPE_ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  signInTxt: { color: "#fff", fontWeight: "900", fontSize: 16 },
  switchModeBtn: { marginTop: 12, alignItems: "center" },
  switchModeTxt: { color: STRIPE_ACCENT, fontWeight: "900" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, marginBottom: 12 },
  divider: { flex: 1, height: 1, backgroundColor: STRIPE_BORDER },
  dividerTxt: { color: STRIPE_MUTED, fontWeight: "800" },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: "#fff",
    marginBottom: 10,
  },
  socialIcon: { width: 22, textAlign: "center", color: STRIPE_TEXT, fontWeight: "900", fontSize: 16 },
  googleIcon: { width: 18, height: 18, resizeMode: "contain" },
  socialTxt: { color: STRIPE_TEXT, fontWeight: "900", fontSize: 15 },
  guestBtn: {
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  guestBtnDisabled: { backgroundColor: "#F3F4F6" },
  guestTxt: { color: STRIPE_TEXT, fontWeight: "900" },
  guestInfoToggle: { alignItems: "center", marginTop: 10 },
  guestInfoToggleTxt: { color: STRIPE_ACCENT, fontWeight: "900" },
  guestInfoBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: STRIPE_BORDER,
    borderRadius: 12,
    backgroundColor: STRIPE_BG,
    padding: 12,
  },
  guestInfoTitle: { color: STRIPE_TEXT, fontWeight: "900", marginBottom: 6 },
  guestInfoLine: { color: STRIPE_MUTED, lineHeight: 18 },
  foot: { marginTop: 14, color: STRIPE_MUTED, fontSize: 12, lineHeight: 16, paddingHorizontal: 2 },
});
