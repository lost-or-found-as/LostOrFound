// src/ui/LiveActivityCard.tsx
// T1.9BT: «På låseskjermen» on the owner's open lost case. Shows nothing unless this phone can run
// Live Activities and the server switch is on.
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { InlineNotice } from "./InlineNotice";
import { theme } from "./theme";
import { haptic } from "../lib/haptics";
import { findCaseActivity, liveActivitiesAvailable, startCaseActivity, stopCaseActivity } from "../lib/liveActivity";

type Props = { reportId: string; followable: boolean };

export function LiveActivityCard({ reportId, followable }: Props) {
  const { t, language } = useI18n();
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const ok = followable && (await liveActivitiesAvailable());
      if (!live) return;
      setAvailable(ok);
      if (ok) setOn(!!(await findCaseActivity(reportId)));
    })().catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [reportId, followable]);

  if (!available) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await stopCaseActivity(reportId);
        setOn(false);
      } else {
        await startCaseActivity(reportId, language);
        setOn(true);
        haptic.success();
      }
    } catch (e: any) {
      haptic.warning();
      setError(t(String(e?.code || "") === "LIVE_START_FAILED" ? "liveActivity.error.start" : "liveActivity.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Ionicons name="phone-portrait-outline" size={20} color={theme.colors.text} />
        <Text style={s.h2}>{t("liveActivity.title")}</Text>
      </View>
      <Text style={s.body}>{t(on ? "liveActivity.bodyOn" : "liveActivity.body")}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        style={[s.button, on ? s.buttonOff : s.buttonOn, busy && s.busy]}
        onPress={() => void toggle()}
      >
        <Ionicons name={on ? "close-circle-outline" : "lock-closed-outline"} size={18} color={on ? theme.colors.text : "#FFFFFF"} />
        <Text style={[s.buttonText, !on && s.buttonTextOn]}>{t(on ? "liveActivity.stop" : "liveActivity.start")}</Text>
      </Pressable>
      {!!error && <InlineNotice tone="warning" title={error} />}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  h2: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  button: { minHeight: 46, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  buttonOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  buttonOff: { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
  busy: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  buttonTextOn: { color: "#FFFFFF" },
});
