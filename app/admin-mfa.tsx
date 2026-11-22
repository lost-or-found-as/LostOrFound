// app/admin-mfa.tsx
// T1.9BN: two-step sign-in (2FA) for admins. Set up once with an authenticator app (Passwords on
// iPhone, Google Authenticator, 1Password …), then a 6-digit code opens the admin screens.
// The server checks the level (aal2) on every admin request once ADMIN_REQUIRE_MFA=true.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { requireAccount } from "../src/ui/AccountRequired";
import { useI18n } from "../src/i18n/I18nProvider";
import { Button, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { supabase } from "../src/lib/supabase";

type Phase = "loading" | "verified" | "enroll" | "setup" | "code";
type Setup = { factorId: string; secret: string; uri: string };

const ADMIN_TARGETS = new Set(["/safety-reports", "/feedback-admin"]);

function Screen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = typeof params.next === "string" && ADMIN_TARGETS.has(params.next) ? params.next : null;
  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goOn = useCallback(() => {
    if (next) router.replace(next as any);
    else router.back();
  }, [next, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level.error) throw level.error;
      if (level.data?.currentLevel === "aal2") {
        setPhase("verified");
        if (next) goOn();
        return;
      }
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const verified = (factors.data?.totp || []).find((f: any) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setPhase("code");
      } else {
        setPhase("enroll");
      }
    } catch {
      setError(t("adminMfa.loadError"));
      setPhase("enroll");
    }
  }, [goOn, next, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      // Unfinished set-ups from earlier attempts are removed first.
      const factors = await supabase.auth.mfa.listFactors();
      const all: any[] = (factors.data as any)?.all || [];
      for (const f of all) if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const res = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "lof-admin-" + String(Date.now()) });
      if (res.error || !res.data) throw res.error || new Error("MFA_ENROLL_FAILED");
      setSetup({ factorId: res.data.id, secret: res.data.totp.secret, uri: res.data.totp.uri });
      setFactorId(res.data.id);
      setPhase("setup");
    } catch {
      setError(t("adminMfa.enrollError"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!factorId || code.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (res.error) throw res.error;
      setCode("");
      setPhase("verified");
      goOn();
    } catch {
      setError(t("adminMfa.codeError"));
    } finally {
      setBusy(false);
    }
  };

  const codeField = (
    <>
      <Text style={s.label}>{t("adminMfa.codeLabel")}</Text>
      <TextInput
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        style={s.code}
        accessibilityLabel={t("adminMfa.codeLabel")}
        placeholder="000000"
        placeholderTextColor={theme.colors.textSecondary}
      />
      <Button label={t("adminMfa.verify")} onPress={() => void verify()} busy={busy} disabled={code.length !== 6} />
    </>
  );

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={t("adminMfa.title")} onBack={() => router.back()} raised />
      {phase === "loading" ? (
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {!!error && <InlineNotice tone="error" title={error} />}
          {phase === "verified" && (
            <>
              <InlineNotice tone="success" icon="shield-checkmark-outline" title={t("adminMfa.verifiedTitle")} body={t("adminMfa.verifiedBody")} />
              <Button label={t("adminMfa.done")} variant="neutral" onPress={goOn} />
            </>
          )}
          {phase === "enroll" && (
            <>
              <Text style={s.body}>{t("adminMfa.intro")}</Text>
              <Button label={t("adminMfa.start")} onPress={() => void startSetup()} busy={busy} />
            </>
          )}
          {phase === "setup" && setup && (
            <>
              <Text style={s.step}>{t("adminMfa.step1")}</Text>
              <Button label={t("adminMfa.openApp")} variant="secondary" onPress={() => void Linking.openURL(setup.uri).catch(() => setError(t("adminMfa.openAppError")))} />
              <Text style={s.body}>{t("adminMfa.manualKey")}</Text>
              <Text selectable style={s.secret}>
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </Text>
              <Text style={s.step}>{t("adminMfa.step2")}</Text>
              {codeField}
            </>
          )}
          {phase === "code" && (
            <>
              <Text style={s.body}>{t("adminMfa.codeIntro")}</Text>
              {codeField}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

export default requireAccount(Screen);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.text },
  step: { fontSize: 16, lineHeight: 22, fontWeight: "900", color: theme.colors.text, marginTop: 4 },
  label: { fontSize: 14, fontWeight: "800", color: theme.colors.textSecondary },
  secret: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1,
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 12,
    fontVariant: ["tabular-nums"],
  },
  code: {
    minHeight: 56,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 8,
    textAlign: "center",
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
  },
});
