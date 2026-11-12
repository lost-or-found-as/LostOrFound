// app/area-alert/[id].tsx
// Incoming area alert: a lost case near the user. The user can say they found it or saw it.
// T1.9W: kit header with an explanation, one case card with badges, translated status and
// in-screen notices instead of system alerts. The view payload has no images, so none is shown.
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { theme } from "../../src/ui/theme";
import { useI18n } from "../../src/i18n/I18nProvider";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { categoryLabel, colorLabel, itemLabel, reportSummary } from "../../src/lib/localizedReport";
import { userErrorMessage } from "../../src/lib/userError";
import { formatDistance, formatLocalizedDateTime } from "../../src/i18n/formatters";
import { Button, EmptyState, InfoButton, ScreenHeader } from "../../src/ui/kit";
import { InlineNotice } from "../../src/ui/InlineNotice";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_STARTED = new Set(["DRAFT", "PENDING_PAYMENT", "SCHEDULED"]);

type AlertState = "active" | "notStarted" | "ended";

function alertState(campaign: any, report: any, now = Date.now()): AlertState {
  const status = String(campaign?.status || "").toUpperCase();
  if (NOT_STARTED.has(status)) return "notStarted";
  const endsAt = campaign?.ends_at ? new Date(campaign.ends_at).getTime() : null;
  const reportOpen = !report?.status || String(report.status).toUpperCase() === "ACTIVE";
  if (status === "ACTIVE" && reportOpen && (endsAt == null || endsAt > now)) return "active";
  return "ended";
}

function AreaAlertDetails() {
  const router = useRouter();
  const { language, t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("LOGIN_REQUIRED");
      const response = await fetch(`${API_BASE_URL}/geo-alert-delivery/${encodeURIComponent(String(id || ""))}/view`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json().catch(() => ({}));
      // Gone or not meant for this user: show "unavailable", not a retry.
      if (response.status === 404 && json?.error === "AREA_ALERT_NOT_AVAILABLE") {
        setData(null);
        return;
      }
      if (!response.ok) throw new Error(json?.error || `HTTP_${response.status}`);
      setData(json);
    } catch (error: any) {
      setLoadError(userErrorMessage(error, t, "errors.generic", "area_alert.open"));
    } finally {
      setLoading(false);
    }
  }, [id, language]);

  useEffect(() => { void load(); }, [load]);

  const campaign = data?.campaign;
  const report = campaign?.reports;
  const state = campaign ? alertState(campaign, report) : "ended";
  const daysLeft = campaign?.ends_at
    ? Math.max(1, Math.ceil((new Date(campaign.ends_at).getTime() - Date.now()) / DAY_MS))
    : null;
  const statusLabel = state === "active"
    ? daysLeft != null ? t("areaAlert.daysLeft", { count: daysLeft }) : t("areaAlert.active")
    : state === "notStarted" ? t("areaAlert.status.notStarted") : t("areaAlert.status.ended");

  // T1.9AC: the observation map opens in the alert area (rounded point from the server).
  const goObservation = (kind: "SEEN" | "FOUND") => {
    const center = data?.mapCenter;
    const where =
      center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude)
        ? { latitude: String(center.latitude), longitude: String(center.longitude) }
        : {};
    router.push({ pathname: "/observation-create", params: { campaignId: String(id || ""), kind, ...where } });
  };

  const detailRows: { label: string; value: string }[] = report ? [
    { label: t("areaAlert.category"), value: categoryLabel(report.category, language) || "–" },
    { label: t("areaAlert.object"), value: itemLabel(report.subcategory_key, language, report.category) || "–" },
    { label: t("areaAlert.color"), value: colorLabel(report.color, language) || "–" },
    { label: t("areaAlert.brand"), value: report.brand || "–" },
    { label: t("areaAlert.area.radius"), value: campaign?.radius_m ? formatDistance(campaign.radius_m, language, t) : "–" },
    { label: t("areaAlert.active.until"), value: campaign?.ends_at ? formatLocalizedDateTime(campaign.ends_at, language) : "–" },
  ] : [];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <ScreenHeader
          title={t("areaAlert.nearbyTitle")}
          onBack={() => router.back()}
          right={<InfoButton title={t("areaAlert.area.alert")} label={t("areaAlert.info.label")} body={t("areaAlert.info.body")} />}
        />
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : loadError ? (
          <View style={styles.content}>
            <InlineNotice
              tone="warning"
              title={t("areaAlert.could.not.open.alert")}
              body={loadError}
              actionLabel={t("errors.retry")}
              onAction={() => void load()}
              style={styles.noticeFirst}
            />
          </View>
        ) : !campaign ? (
          <View style={styles.content}>
            <EmptyState icon="notifications-off-outline" title={t("areaAlert.alert.unavailable")} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.card}>
              <View style={styles.badges}>
                <Text style={[styles.badge, styles.badgeLost]}>{t("common.lost")}</Text>
                <Text style={[styles.badge, state === "active" ? styles.badgeActive : styles.badgeMuted]}>{statusLabel}</Text>
              </View>
              <Text style={styles.title}>{reportSummary(report, language, t) || t("areaAlert.lost.item")}</Text>
              {!!report?.location_label && <Text style={styles.meta}>{report.location_label}</Text>}
              <Text style={[styles.body, !report?.description && styles.bodyMuted]}>
                {report?.description || t("areaAlert.no.description.available")}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.h2}>{t("areaAlert.details")}</Text>
              {detailRows.map((row) => (
                <View key={row.label} style={styles.row}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            {state === "active" ? (
              <View style={styles.actions}>
                <Button label={t("areaAlert.i.found.this")} onPress={() => goObservation("FOUND")} />
                <Button label={t("areaAlert.i.saw.this")} variant="secondary" onPress={() => goObservation("SEEN")} />
                <Text style={styles.footnote}>
                  {t("areaAlert.your.information.is.shared.with.the.report.owner.it.does.not.close.the")}
                </Text>
              </View>
            ) : (
              <InlineNotice
                tone="info"
                icon="information-circle-outline"
                title={state === "notStarted" ? t("areaAlert.notStartedTitle") : t("areaAlert.endedTitle")}
                body={state === "notStarted" ? t("areaAlert.notStartedBody") : t("areaAlert.endedBody")}
                style={styles.noticeFirst}
              />
            )}
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  noticeFirst: { marginTop: 0 },
  card: {
    padding: 16,
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  badgeLost: { backgroundColor: "#FFE4E6", color: "#9F1239" },
  badgeActive: { backgroundColor: "#DCFCE7", color: "#166534" },
  badgeMuted: { backgroundColor: "#F1F5F9", color: theme.colors.textSecondary },
  title: { fontSize: 22, fontWeight: "900", color: theme.colors.text },
  meta: { fontSize: 14, fontWeight: "700", color: theme.colors.textSecondary },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: theme.colors.text },
  bodyMuted: { color: theme.colors.textSecondary },
  h2: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  rowLabel: { fontSize: 14, fontWeight: "700", color: theme.colors.textSecondary },
  rowValue: { flexShrink: 1, fontSize: 14, fontWeight: "800", color: theme.colors.text, textAlign: "right" },
  actions: { gap: 10 },
  footnote: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center" },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(AreaAlertDetails);
