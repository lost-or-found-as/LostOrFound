import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { theme } from "./theme";
import {
  areaAlertDateParts,
  areaAlertRadiusLabel,
  type AreaAlertView,
} from "../lib/areaAlertStatus";

// T1.8E.5I: named service card for the area alert on the case details screen.
// States: live (green), available (expired, one left), completed (both used).
export function AreaAlertServiceCard({ view, onSendNew }: { view: AreaAlertView; onSendNew: () => void }) {
  const { language, t } = useI18n();
  if (view.kind === "none") return null;

  const latest = view.latest;
  const dateTime = (iso: string | null | undefined) => {
    const p = areaAlertDateParts(iso, language);
    return p.date ? t("areaAlertService.dateAtTime", { date: p.date, time: p.time }) : "";
  };
  const radius = areaAlertRadiusLabel(latest?.radiusM, language);
  const live = view.kind === "live";
  const completed = view.kind === "completed";

  const pill = live
    ? { label: t("areaAlertService.statusActive"), bg: "#ECFDF5", border: "#BBF7D0", color: "#166534" }
    : completed
      ? { label: t("areaAlertService.statusCompleted"), bg: "#F1F5F9", border: "#E2E8F0", color: "#475569" }
      : { label: t("areaAlertService.statusExpired"), bg: "#F1F5F9", border: "#E2E8F0", color: "#475569" };

  return (
    <View style={styles.card} accessibilityLabel={t("areaAlertService.title")}>
      <View style={styles.headRow}>
        <View style={[styles.iconBox, live ? styles.iconLive : styles.iconMuted]}>
          <Ionicons
            name={completed ? "checkmark-done-outline" : "radio-outline"}
            size={22}
            color={live ? "#166534" : "#475569"}
          />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>{t("areaAlertService.title")}</Text>
          <Text style={styles.sub}>
            {completed
              ? t("areaAlertService.sentCount", { used: view.activationCount, max: view.maxActivations })
              : radius
                ? t("areaAlertService.radius", { radius })
                : ""}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
          <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
        </View>
      </View>

      {!completed && (
        <View style={styles.grid}>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>{t("areaAlertService.sentOut")}</Text>
            <Text style={styles.cellValue}>{dateTime(latest?.startsAt)}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>
              {live ? t("areaAlertService.activeUntil") : t("areaAlertService.expiredLabel")}
            </Text>
            <Text style={styles.cellValue}>{dateTime(latest?.endsAt)}</Text>
          </View>
        </View>
      )}

      {live && (
        <View style={styles.progressWrap}>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: view.totalDays, now: view.dayNumber }}
          >
            <View style={[styles.fill, { width: `${Math.max(4, Math.round(view.progress * 100))}%` }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.muted}>
              {t("areaAlertService.dayOf", { day: view.dayNumber, total: view.totalDays })}
            </Text>
            <Text style={styles.daysLeft}>
              {view.daysLeft === 1
                ? t("areaAlertService.oneDayLeft")
                : t("areaAlertService.daysLeft", { count: view.daysLeft })}
            </Text>
          </View>
        </View>
      )}

      {live && (
        <View style={styles.footer}>
          <Text style={styles.muted}>
            {t("areaAlertService.usedOf", { used: view.activationCount, max: view.maxActivations })}
          </Text>
        </View>
      )}

      {view.kind === "available" && (
        <>
          <View style={styles.info}>
            <Ionicons name="information-circle-outline" size={18} color="#1D4ED8" style={styles.infoIcon} />
            <Text style={styles.infoText}>{t("areaAlertService.availableInfo")}</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.primary} onPress={onSendNew}>
            <Text style={styles.primaryText}>{t("areaAlertService.sendNew")}</Text>
          </Pressable>
          <Text style={[styles.muted, styles.center]}>
            {t("areaAlertService.remaining", { remaining: view.remaining, max: view.maxActivations })}
          </Text>
        </>
      )}

      {completed && (
        <>
          <View style={styles.list}>
            {view.activations.map((a, i) => {
              const r = areaAlertRadiusLabel(a.radiusM, language);
              const from = areaAlertDateParts(a.startsAt, language).date;
              const to = areaAlertDateParts(a.endsAt, language).date;
              return (
                <View key={`${a.startsAt}-${i}`} style={styles.listItem}>
                  <Text style={styles.listTitle}>
                    {r
                      ? t("areaAlertService.historyItem", { number: i + 1, radius: r })
                      : t("areaAlertService.historyItemNoRadius", { number: i + 1 })}
                  </Text>
                  <Text style={styles.muted}>{from && to ? `${from} – ${to}` : from}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.completedText}>{t("areaAlertService.completedText")}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: 12,
    gap: 14,
    ...theme.shadow.card,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconLive: { backgroundColor: "#ECFDF5" },
  iconMuted: { backgroundColor: "#F1F5F9" },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  sub: { fontSize: 13, fontWeight: "600", color: theme.colors.muted },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: "800" },
  grid: { flexDirection: "row", gap: 10 },
  cell: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  cellLabel: { fontSize: 12, fontWeight: "600", color: theme.colors.muted },
  cellValue: { fontSize: 15, fontWeight: "700", color: theme.colors.text },
  progressWrap: { gap: 6 },
  track: { height: 8, borderRadius: 999, backgroundColor: "#E2E8F0", overflow: "hidden" },
  fill: { height: 8, borderRadius: 999, backgroundColor: "#15803D" },
  progressRow: { flexDirection: "row", justifyContent: "space-between" },
  muted: { fontSize: 13, fontWeight: "600", color: theme.colors.muted },
  daysLeft: { fontSize: 13, fontWeight: "800", color: "#166534" },
  footer: { borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 },
  info: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 12,
    padding: 12,
  },
  infoIcon: { marginTop: 1 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#1E3A8A" },
  primary: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  center: { textAlign: "center" },
  list: { gap: 8 },
  listItem: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  listTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text, flexShrink: 1 },
  completedText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#475569" },
});
