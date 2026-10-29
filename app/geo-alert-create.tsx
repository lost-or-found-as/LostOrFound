import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, {
  Circle,
  Marker,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";

import { en } from "../src/i18n/locales/en";
import { no } from "../src/i18n/locales/no";
import type { TranslationKey } from "../src/i18n/locales/en";
import {
  previewGeoAlert,
  type GeoAlertPreviewResult,
} from "../src/lib/geoAlertPreview";
import {
  activateTestReportOrder,
  createReportOrder,
  fetchGeoAlertStatus,
} from "../src/lib/reportCommerce";
import {
  areaAlertDateParts,
  classifyAreaAlertError,
  deriveAreaAlertView,
  type AreaAlertErrorInfo,
  type GeoAlertStatus,
} from "../src/lib/areaAlertStatus";
import { InlineNotice } from "../src/ui/InlineNotice";
import { Ionicons } from "@expo/vector-icons";

function tr(language: "no" | "en", key: TranslationKey): string {
  return language === "en" ? en[key] : no[key];
}

const RADII = [250, 500, 1000, 1500, 3000, 5000, 10000];
const DURATION_HOURS = 168;
const REMINDER_COUNT = 0;
// T1.8E.5I: errors are shown in the screen (InlineNotice), never as native dialogs.
type AreaAlertNotice = {
  info: AreaAlertErrorInfo;
  nothingOrdered: boolean;
  retry: "calculate" | "activate";
};

function createClientRequestId(reportId: string) {
  return `geo-alert-${reportId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function GeoAlertCreateScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const requestIdRef = useRef<string | null>(null);
  const { language, t } = useI18n();
  const params = useLocalSearchParams<{
    reportId?: string;
    title?: string;
    lat?: string;
    lng?: string;
  }>();
  const reportId = String(params.reportId || "").trim();
  const latitude = Number(params.lat);
  const longitude = Number(params.lng);
  const [radiusM, setRadiusM] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<GeoAlertPreviewResult | null>(null);
  const [activatedUntil, setActivatedUntil] = useState<string | null>(null);
  const [status, setStatus] = useState<GeoAlertStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [notice, setNotice] = useState<AreaAlertNotice | null>(null);
  const validLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const center = useMemo(
    () => ({ latitude, longitude }),
    [latitude, longitude],
  );
  const region = useMemo<Region>(
    () => ({ latitude, longitude, latitudeDelta: 0.09, longitudeDelta: 0.09 }),
    [latitude, longitude],
  );

  const loadStatus = useCallback(async () => {
    if (!reportId) {
      setStatusLoading(false);
      return;
    }
    try {
      setStatus(await fetchGeoAlertStatus(reportId));
    } catch {
      // The server still enforces the rules; without status the form stays available.
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const view = useMemo(() => deriveAreaAlertView(status), [status]);

  useEffect(() => {
    setResult(null);
    setActivatedUntil(null);
    setNotice(null);
    requestIdRef.current = null;
    if (validLocation) {
      const delta = Math.max(0.015, Math.min(1.2, radiusM / 18000));
      mapRef.current?.animateToRegion(
        { ...center, latitudeDelta: delta, longitudeDelta: delta },
        200,
      );
    }
  }, [radiusM, validLocation, center]);

  const calculate = async () => {
    if (!reportId || !validLocation) return;
    try {
      setBusy(true);
      setNotice(null);
      const next = await previewGeoAlert({
        reportId,
        radiusM,
        durationHours: DURATION_HOURS,
        reminderCount: REMINDER_COUNT,
        populationDensityBand: "LOW",
      });
      setResult(next);
      requestIdRef.current = createClientRequestId(reportId);
    } catch (e: any) {
      setNotice({ info: classifyAreaAlertError(e), nothingOrdered: true, retry: "calculate" });
    } finally {
      setBusy(false);
    }
  };

  const createAndActivate = async () => {
    if (!result || !reportId || activating) return;
    let orderCreated = false;
    try {
      setActivating(true);
      setNotice(null);
      const clientRequestId =
        requestIdRef.current || createClientRequestId(reportId);
      requestIdRef.current = clientRequestId;
      const created = await createReportOrder({
        reportId,
        productCode: "GEO_ALERT",
        clientRequestId,
        platform:
          Platform.OS === "ios"
            ? "IOS"
            : Platform.OS === "android"
              ? "ANDROID"
              : "WEB",
        provider: "TEST",
        geoAlert: {
          radiusM: result.preview.radiusM,
          areaSqKm: result.preview.areaSqKm,
          populationDensityBand: result.preview.populationDensityBand,
          estimatedEligibleUsers: result.preview.eligibleUsers,
          estimatedEligibleInstallations: result.preview.eligibleInstallations,
          durationHours: DURATION_HOURS,
          reminderCount: REMINDER_COUNT,
        },
      });
      orderCreated = true;
      const activated = await activateTestReportOrder(created.order.id);
      setActivatedUntil(
        String(activated.entitlement?.current_period_end || ""),
      );
    } catch (e: any) {
      const info = classifyAreaAlertError(e);
      if (info.kind === "alreadyActive" || info.kind === "limitReached") {
        // Not an error for the user: show the current status instead of the form.
        setStatusLoading(true);
        await loadStatus();
        return;
      }
      setNotice({ info, nothingOrdered: !orderCreated, retry: "activate" });
    } finally {
      setActivating(false);
    }
  };

  if (!validLocation) {
    return (
      <View style={styles.safe}>
        <PremiumHeader
          title={tr(language, "areaAlertCreate.area.alert")}
          onBack={() => router.back()}
        />
        <View style={styles.center}>
          <Text style={styles.muted}>
            {tr(
              language,
              "areaAlertCreate.the.report.has.no.usable.coordinates",
            )}
          </Text>
        </View>
      </View>
    );
  }

  const header = (
    <PremiumHeader
      title={tr(language, "areaAlertCreate.notify.people.nearby")}
      subtitle={String(params.title || "")}
      onBack={() => router.back()}
    />
  );

  if (statusLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.safe}>
          {header}
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[styles.muted, styles.statusLoadingText]}>
              {t("areaAlertCreate.checkingStatus")}
            </Text>
          </View>
        </View>
      </>
    );
  }

  if (!activatedUntil && (view.kind === "live" || view.kind === "completed")) {
    const live = view.kind === "live";
    const until = areaAlertDateParts(status?.activeUntil || view.latest?.endsAt, language);
    const lastOne = view.activationCount >= view.maxActivations;
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.safe}>
          {header}
          <ScrollView contentContainerStyle={styles.blockedContent}>
            <View style={styles.blockedCard}>
              <View style={[styles.blockedIcon, live ? styles.blockedIconLive : styles.blockedIconDone]}>
                <Ionicons
                  name={live ? "radio-outline" : "checkmark-done-outline"}
                  size={28}
                  color={live ? "#166534" : "#475569"}
                />
              </View>
              <Text style={styles.blockedTitle}>
                {live ? t("areaAlertCreate.alreadyActiveTitle") : t("areaAlertCreate.limitTitle")}
              </Text>
              <Text style={styles.blockedBody}>
                {live
                  ? lastOne
                    ? t("areaAlertCreate.alreadyActiveLastBody")
                    : t("areaAlertCreate.alreadyActiveBody")
                  : t("areaAlertCreate.limitBody")}
              </Text>
              {live && (
                <View style={styles.blockedGrid}>
                  <View style={styles.blockedCell}>
                    <Text style={styles.blockedCellLabel}>{t("areaAlertService.activeUntil")}</Text>
                    <Text style={styles.blockedCellValue}>
                      {until.date ? t("areaAlertService.dateAtTime", { date: until.date, time: until.time }) : ""}
                    </Text>
                  </View>
                  <View style={styles.blockedCell}>
                    <Text style={styles.blockedCellLabel}>{t("areaAlertCreate.remainingLabel")}</Text>
                    <Text style={styles.blockedCellValue}>
                      {view.daysLeft === 1
                        ? t("areaAlertCreate.oneDayValue")
                        : t("areaAlertCreate.daysValue", { count: view.daysLeft })}
                    </Text>
                  </View>
                </View>
              )}
            </View>
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.back()}>
              <Text style={styles.primaryText}>{t("areaAlertCreate.backToCase")}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </>
    );
  }

  const noticeView = notice ? noticeContent(notice, t) : null;
  const retryNotice = () => {
    if (!notice) return;
    if (notice.retry === "calculate") void calculate();
    else void createAndActivate();
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={tr(language, "areaAlertCreate.notify.people.nearby")}
          subtitle={String(params.title || "")}
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.mapFrame}>
            <MapView
              ref={mapRef}
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              style={styles.map}
              initialRegion={region}
              scrollEnabled
              zoomEnabled
            >
              <Marker coordinate={center} />
              <Circle
                center={center}
                radius={radiusM}
                strokeColor="#2563EB"
                strokeWidth={3}
                fillColor="rgba(37,99,235,.16)"
              />
            </MapView>
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>
              {tr(language, "areaAlertCreate.coverage")}
            </Text>
            <View style={styles.chips}>
              {RADII.map((v) => (
                <Chip
                  key={v}
                  active={radiusM === v}
                  label={v >= 1000 ? `${v / 1000} km` : `${v} m`}
                  onPress={() => setRadiusM(v)}
                />
              ))}
            </View>
            <Text style={styles.help}>
              {tr(
                language,
                "areaAlertCreate.the.blue.circle.is.centered.on.the.report.locati",
              )}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>
              {tr(language, "areaAlertCreate.campaign")}
            </Text>
            <Text style={styles.ruleTitle}>
              {tr(
                language,
                "areaAlertCreate.one.notification.active.for.7.days",
              )}
            </Text>
            <Text style={styles.help}>
              {tr(
                language,
                "areaAlertCreate.the.notification.is.sent.once.recipients.can.fin",
              )}
            </Text>
          </View>

          <Pressable
            disabled={busy || activating || (!!notice && !result)}
            style={[styles.primary, (busy || activating || (!!notice && !result)) && styles.disabled]}
            onPress={calculate}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>
                {tr(language, "areaAlertCreate.calculate.reach.and.price")}
              </Text>
            )}
          </Pressable>

          {noticeView && !result && (
            <InlineNotice
              tone={noticeView.tone}
              icon={noticeView.icon}
              title={noticeView.title}
              body={noticeView.body}
              actionLabel={notice?.info.retryable ? t("errors.retry") : undefined}
              onAction={retryNotice}
              busy={busy}
            />
          )}

          {result && (
            <View style={styles.result}>
              <Text style={styles.resultEyebrow}>
                {tr(language, "areaAlertCreate.current.estimate")}
              </Text>
              <Text style={styles.resultTitle}>
                {tr(language, "areaAlertCreate.relevantUsersMayBeNotified")}
              </Text>
              <Text style={styles.resultMeta}>
                {result.preview.areaSqKm.toFixed(2)} km² ·{" "}
                {tr(language, "areaAlertCreate.recipientCountPrivate")}
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>
                  {tr(language, "areaAlertCreate.test.price")}
                </Text>
                <Text style={styles.price}>
                  {(result.quote.amountOre / 100).toLocaleString(
                    tr(language, "areaAlertCreate.en.gb"),
                  )}{" "}
                  kr
                </Text>
              </View>
              <Text style={styles.warning}>
                {tr(
                  language,
                  "areaAlertCreate.test.mode.no.real.payment.is.made.activation.cre",
                )}
              </Text>
              {noticeView && (
                <InlineNotice
                  tone={noticeView.tone}
                  icon={noticeView.icon}
                  title={noticeView.title}
                  body={noticeView.body}
                  actionLabel={notice?.info.retryable ? t("errors.retry") : undefined}
                  onAction={retryNotice}
                  busy={activating}
                />
              )}
              {!activatedUntil && !noticeView ? (
                <Pressable
                  disabled={activating}
                  style={[styles.activate, activating && styles.disabled]}
                  onPress={createAndActivate}
                >
                  {activating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.activateText}>
                      {tr(language, "areaAlertCreate.activate.test.area.alert")}
                    </Text>
                  )}
                </Pressable>
              ) : activatedUntil ? (
                <View style={styles.successBox}>
                  <Text style={styles.successTitle}>
                    {tr(language, "areaAlertCreate.area.alert.active")}
                  </Text>
                  <Text style={styles.successText}>
                    {tr(language, "areaAlertCreate.active.until")}:{" "}
                    {new Date(activatedUntil).toLocaleString(
                      tr(language, "areaAlertCreate.en.gb"),
                    )}
                  </Text>
                  <Text style={styles.successText}>
                    {tr(
                      language,
                      "areaAlertCreate.relevantUsersWillBeNotified",
                    )}
                  </Text>
                  <Pressable
                    style={styles.secondary}
                    onPress={() => router.back()}
                  >
                    <Text style={styles.secondaryText}>
                      {tr(language, "areaAlertCreate.back.to.report")}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

type Translate = (key: TranslationKey, params?: Record<string, string | number | null | undefined>) => string;

function noticeContent(notice: AreaAlertNotice, t: Translate) {
  const nothing = notice.nothingOrdered ? ` ${t("areaAlertCreate.nothingOrdered")}` : "";
  switch (notice.info.kind) {
    case "network":
      return { tone: "warning" as const, icon: "wifi-outline" as const, title: t("errors.networkTitle"), body: t("errors.networkBody") + nothing };
    case "service":
      return { tone: "warning" as const, icon: "cloud-offline-outline" as const, title: t("errors.serviceTitle"), body: t("errors.serviceBody") + nothing };
    case "auth":
      return { tone: "info" as const, icon: "lock-closed-outline" as const, title: t("errors.authTitle"), body: t("errors.authBody") };
    case "notAvailable":
      return { tone: "info" as const, icon: "information-circle-outline" as const, title: t("areaAlertCreate.errorNotAvailableTitle"), body: t("areaAlertCreate.errorNotAvailableBody") };
    case "locationRequired":
      return { tone: "info" as const, icon: "location-outline" as const, title: t("areaAlertCreate.errorLocationTitle"), body: t("areaAlertCreate.locationRequired") };
    default:
      return { tone: "error" as const, icon: "alert-circle-outline" as const, title: t("areaAlertCreate.errorUnknownTitle"), body: t("areaAlertCreate.errorUnknownBody") + nothing };
  }
}

function Chip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  muted: { color: theme.colors.muted, fontWeight: "700" },
  mapFrame: {
    height: 260,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  map: { flex: 1 },
  card: {
    marginTop: 12,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  h2: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: { fontWeight: "900", fontSize: 12, color: "#475569" },
  chipTextActive: { color: "#fff" },
  help: {
    marginTop: 10,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 18,
  },
  ruleTitle: {
    marginTop: 10,
    fontWeight: "900",
    color: theme.colors.text,
    fontSize: 15,
  },
  primary: {
    marginTop: 14,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "900" },
  disabled: { opacity: 0.55 },
  result: {
    marginTop: 14,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#93C5FD",
  },
  resultEyebrow: { fontWeight: "900", fontSize: 11, color: "#1D4ED8" },
  resultTitle: {
    marginTop: 6,
    fontWeight: "900",
    fontSize: 21,
    color: theme.colors.text,
  },
  resultMeta: { marginTop: 5, fontWeight: "700", color: theme.colors.muted },
  priceRow: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#BFDBFE",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: { fontWeight: "800", color: theme.colors.text },
  price: { fontWeight: "900", fontSize: 23, color: "#1D4ED8" },
  warning: {
    marginTop: 10,
    fontWeight: "700",
    fontSize: 12,
    color: "#92400E",
    lineHeight: 18,
  },
  activate: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  activateText: { color: "#fff", fontWeight: "900" },
  successBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  successTitle: { fontWeight: "900", fontSize: 16, color: "#166534" },
  successText: { marginTop: 5, fontWeight: "700", color: "#166534" },
  secondary: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#86EFAC",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  secondaryText: { fontWeight: "900", color: "#166534" },
  statusLoadingText: { marginTop: 12 },
  blockedContent: { padding: 14, paddingBottom: 40, gap: 16 },
  blockedCard: {
    padding: 22,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    gap: 12,
    ...theme.shadow.card,
  },
  blockedIcon: { width: 56, height: 56, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  blockedIconLive: { backgroundColor: "#ECFDF5" },
  blockedIconDone: { backgroundColor: "#F1F5F9" },
  blockedTitle: { fontSize: 20, fontWeight: "900", color: theme.colors.text, textAlign: "center" },
  blockedBody: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: "#475569", textAlign: "center" },
  blockedGrid: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 4 },
  blockedCell: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  blockedCellLabel: { fontSize: 12, fontWeight: "600", color: theme.colors.muted },
  blockedCellValue: { fontSize: 15, fontWeight: "700", color: theme.colors.text },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(GeoAlertCreateScreen);
