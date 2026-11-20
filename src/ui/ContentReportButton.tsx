// src/ui/ContentReportButton.tsx
// T1.9AY: «Rapporter innholdet» for a case shown to strangers (area alert, «I nærheten»). The case
// is hidden automatically when several people have reported it; admin is told at once.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/I18nProvider";
import { supabase } from "../lib/supabase";
import { API_BASE_URL } from "../lib/config";
import { userErrorMessage } from "../lib/userError";
import type { TranslationKey } from "../i18n/locales/en";
import { BottomSheet, Button } from "./kit";
import { InlineNotice } from "./InlineNotice";
import { theme } from "./theme";

const REASONS = ["PERSON", "HARASSMENT", "PERSONAL_INFO", "SPAM", "OTHER"] as const;
type Reason = (typeof REASONS)[number];

export function ContentReportButton({ reportId }: { reportId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("PERSON");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw Object.assign(new Error("LOGIN_REQUIRED"), { code: "LOGIN_REQUIRED" });
      const r = await fetch(`${API_BASE_URL}/safety/content/${encodeURIComponent(reportId)}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(String(j?.error || "CONTENT_REPORT_FAILED")), { code: String(j?.error || "CONTENT_REPORT_FAILED") });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(userErrorMessage(e, t, "contentReport.failed", "content.report"));
    } finally {
      setBusy(false);
    }
  };

  if (done) return <InlineNotice tone="success" icon="checkmark-circle-outline" title={t("contentReport.thanksTitle")} body={t("contentReport.thanksBody")} style={styles.notice} />;

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} hitSlop={8} style={styles.link}>
        <Text style={styles.linkText}>{t("contentReport.open")}</Text>
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} accessibilityLabel={t("common.close")}>
        <Text style={styles.title} accessibilityRole="header">{t("contentReport.title")}</Text>
        <Text style={styles.body}>{t("contentReport.intro")}</Text>
        <View style={styles.reasons}>
          {REASONS.map((r) => {
            const on = r === reason;
            return (
              <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setReason(r)} style={[styles.reason, on && styles.reasonOn]}>
                <Text style={[styles.reasonText, on && styles.reasonTextOn]}>{t(`contentReport.reason.${r}` as TranslationKey)}</Text>
              </Pressable>
            );
          })}
        </View>
        {!!error && <InlineNotice tone="error" title={t("contentReport.failed")} body={error} style={styles.notice} />}
        <Button label={t("contentReport.send")} onPress={() => void send()} busy={busy} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: "center", paddingVertical: 12 },
  linkText: { fontSize: 14, fontWeight: "700", color: theme.colors.textSecondary, textDecorationLine: "underline" },
  title: { fontSize: 18, fontWeight: "900", color: theme.colors.text, marginBottom: 6 },
  body: { fontSize: 14, color: theme.colors.textSecondary, marginBottom: 12 },
  reasons: { gap: 8, marginBottom: 14 },
  reason: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  reasonOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.chipBg },
  reasonText: { fontSize: 15, color: theme.colors.text },
  reasonTextOn: { fontWeight: "800" },
  notice: { marginVertical: 8 },
});
