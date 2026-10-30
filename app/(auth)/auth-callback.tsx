// app/(auth)/auth-callback.tsx
// Supabase may return tokens in the URL hash (#access_token=...).
// Set the session with access_token and refresh_token.
// PKCE callbacks using ?code=... are handled with exchangeCodeForSession().

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";

import { supabase } from "../../src/lib/supabase";
import { useI18n } from "../../src/i18n/I18nProvider";
import { userErrorMessage } from "../../src/lib/userError";

function safeUrl(u: string) {
  return u
    .replace(/(access_token=)[^&]+/g, "$1***")
    .replace(/(refresh_token=)[^&]+/g, "$1***")
    .replace(/(provider_token=)[^&]+/g, "$1***")
    .replace(/(code=)[^&]+/g, "$1***");
}

function getHashParams(url: string) {
  const hash = url.split("#")[1] || "";
  const p = new URLSearchParams(hash);
  const obj: Record<string, string> = {};
  for (const [k, v] of p.entries()) obj[k] = v;
  return obj;
}

function getQueryParam(url: string, key: string) {
  const idx = url.indexOf("?");
  if (idx === -1) return null;
  const qs = url.slice(idx + 1);
  const p = new URLSearchParams(qs);
  return p.get(key);
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const url = Linking.useLinkingURL();

  const [status, setStatus] = useState<"idle" | "working" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const prettyUrl = useMemo(() => (url ? safeUrl(url) : ""), [url]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!url) return;

      try {
        setStatus("working");
        setMessage(t("auth.callback.completingMessage"));

        // 1) Hash-token flow
        const hash = getHashParams(url);
        const access_token = hash.access_token;
        const refresh_token = hash.refresh_token;

        if (access_token && refresh_token) {
          const setSession = (supabase.auth as any).setSession;
          if (typeof setSession !== "function") {
            throw new Error("supabase.auth.setSession() is unavailable. Update @supabase/supabase-js to v2.");
          }
          const { error } = await setSession.call(supabase.auth, { access_token, refresh_token });
          if (error) throw error;
        } else {
          // 2) PKCE code flow
          const code = getQueryParam(url, "code");
          const exchange = (supabase.auth as any).exchangeCodeForSession;
          if (code && typeof exchange === "function") {
            const { error } = await exchange.call(supabase.auth, url);
            if (error) throw error;
          } else {
            throw new Error(
              "No access_token/refresh_token was found in the callback URL. Check the Supabase redirect URLs."
            );
          }
        }

        if (cancelled) return;
        setStatus("ok");
        setMessage(t("auth.callback.successMessage"));

        setTimeout(() => {
          router.replace("/(tabs)");
        }, 250);
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setMessage(userErrorMessage(e, t, "auth.callback.unknownError", "auth.callback"));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [url, router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("auth.callback.title")}</Text>
          <Text style={styles.sub}>
            {status === "working" || status === "idle" ? t("auth.callback.wait") : status === "ok" ? t("auth.callback.done") : t("auth.callback.failed")}
          </Text>

          <View style={{ height: 14 }} />

          {status === "working" || status === "idle" ? (
            <ActivityIndicator />
          ) : status === "ok" ? (
            <Text style={styles.ok}>{message}</Text>
          ) : (
            <>
              <Text style={styles.errTitle}>{t("auth.callback.error")}</Text>
              <Text style={styles.err}>{message}</Text>
              {!!prettyUrl && <Text style={styles.debug}>URL: {prettyUrl}</Text>}
              <Pressable
                onPress={() => router.replace("/(auth)/login")}
                style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.btnTxt}>{t("auth.callback.back")}</Text>
              </Pressable>
            </>
          )}

          {(status === "working" || status === "idle") && !!prettyUrl && (
            <Text style={styles.debug}>URL: {prettyUrl}</Text>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F7FB", paddingHorizontal: 18, justifyContent: "center" },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 16 },
  title: { fontSize: 20, fontWeight: "900", color: "#111827" },
  sub: { marginTop: 6, color: "#6B7280", fontWeight: "700" },
  ok: { color: "#065F46", fontWeight: "800" },
  errTitle: { color: "#991B1B", fontWeight: "900", marginTop: 6 },
  err: { color: "#991B1B", marginTop: 6 },
  debug: { color: "#6B7280", marginTop: 12, fontSize: 12 },
  btn: { marginTop: 14, backgroundColor: "#635BFF", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnTxt: { color: "#fff", fontWeight: "900" },
});
