// app/area-visibility-create.tsx
// T1.9AM: «Synlig i nærheten». The case is listed for 7 days in «I nærheten» for people whose alert
// area covers the place, without push. The owner picks a radius; the server counts the people who
// follow that area (shown as a band) and prices by that number. Same purchase path as area alerts.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { InlineNotice } from "../src/ui/InlineNotice";
import { WithdrawalConsent } from "../src/ui/WithdrawalConsent";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDistance, formatMoney } from "../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../src/lib/market";
import { previewGeoAlert, type GeoAlertPreviewResult } from "../src/lib/geoAlertPreview";
import { completeReportOrder, createReportOrder, fetchGeoAlertStatus, storePlatform } from "../src/lib/reportCommerce";
import { areaAlertDateParts, classifyAreaAlertError } from "../src/lib/areaAlertStatus";
import { knownErrorKey } from "../src/lib/userError";
import { visibilityNoticeKey, VISIBILITY_RADII } from "../src/lib/areaVisibility";

const DURATION_HOURS = 168;

function createClientRequestId(reportId: string) {
  return `area-visibility-${reportId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function AreaVisibilityCreateScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const params = useLocalSearchParams<{ reportId?: string; title?: string; lat?: string; lng?: string }>();
  const reportId = String(params.reportId || "").trim();
  const latitude = Number(params.lat);
  const longitude = Number(params.lng);
  const validLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const center = useMemo(() => ({ latitude, longitude }), [latitude, longitude]);
  const mapRef = useRef<MapView>(null);
  const requestIdRef = useRef<string | null>(null);

  const [radiusM, setRadiusM] = useState(1000);
  const [quote, setQuote] = useState<GeoAlertPreviewResult["quote"] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [consent, setConsent] = useState(false);
  const [noticeCode, setNoticeCode] = useState<string | null>(null);
  const [visibleUntil, setVisibleUntil] = useState<string | null>(null);
  const [doneUntil, setDoneUntil] = useState<string | null>(null);
  const [statusReady, setStatusReady] = useState(false);

  useEffect(() => {
    if (!reportId) return;
    fetchGeoAlertStatus(reportId)
      .then((status) => setVisibleUntil(status?.visibility?.activeUntil || null))
      .catch(() => {})
      .finally(() => setStatusReady(true));
  }, [reportId]);

  const loadQuote = useCallback(async () => {
    if (!reportId || !validLocation) return;
    setQuoting(true);
    setNoticeCode(null);
    try {
      const result = await previewGeoAlert({ reportId, radiusM, durationHours: DURATION_HOURS, reminderCount: 0, kind: "VISIBILITY" });
      setQuote(result.quote);
      requestIdRef.current = createClientRequestId(reportId);
    } catch (e) {
      setQuote(null);
      setNoticeCode(String((e as any)?.code || (e as any)?.message || "UNKNOWN"));
    } finally {
      setQuoting(false);
    }
  }, [reportId, radiusM, validLocation]);

  // A new radius gives a new count and price at once (no separate «Beregn» step).
  useEffect(() => {
    setQuote(null);
    const delta = Math.max(0.015, Math.min(1.2, radiusM / 18000));
    if (validLocation) mapRef.current?.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta }, 200);
    const timer = setTimeout(() => void loadQuote(), 250);
    return () => clearTimeout(timer);
  }, [radiusM, loadQuote, validLocation, center]);

  const buy = async () => {
    if (!quote || buying) return;
    setBuying(true);
    setNoticeCode(null);
    try {
      const clientRequestId = requestIdRef.current || createClientRequestId(reportId);
      requestIdRef.current = clientRequestId;
      const created = await createReportOrder({
        reportId,
        productCode: "AREA_VISIBILITY",
        clientRequestId,
        platform: storePlatform(),
        provider: "TEST",
        geoAlert: { radiusM },
      });
      const activated = await completeReportOrder(created.order);
      setDoneUntil(String(activated.entitlement?.current_period_end || ""));
    } catch (e: any) {
      if (String(e?.code || "") === "PURCHASE_CANCELLED") return;
      setNoticeCode(String(e?.code || e?.message || "UNKNOWN"));
    } finally {
      setBuying(false);
    }
  };

  const header = <PremiumHeader title={t("areaVisibility.title")} subtitle={String(params.title || "")} onBack={() => router.back()} />;
  const backToCase = (
    <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.back()}>
      <Text style={s.primaryText}>{t("areaAlertCreate.backToCase")}</Text>
    </Pressable>
  );

  const statusCard = (until: string, titleKey: "areaVisibility.doneTitle" | "areaVisibility.alreadyTitle") => {
    const parts = areaAlertDateParts(until, language);
    return (
      <View style={s.statusCard}>
        <View style={s.statusIcon}>
          <Ionicons name="eye-outline" size={28} color="#166534" />
        </View>
        <Text style={s.statusTitle}>{t(titleKey)}</Text>
        <Text style={s.statusBody}>{parts.date ? t("areaVisibility.until", { date: parts.date, time: parts.time }) : ""}</Text>
      </View>
    );
  };

  if (!validLocation || !statusReady || doneUntil || visibleUntil) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.safe}>
          {header}
          {!validLocation ? (
            <View style={s.center}>
              <Text style={s.muted}>{t("areaAlertCreate.the.report.has.no.usable.coordinates")}</Text>
            </View>
          ) : !statusReady ? (
            <View style={s.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={s.content}>
              {statusCard(String(doneUntil || visibleUntil), doneUntil ? "areaVisibility.doneTitle" : "areaVisibility.alreadyTitle")}
              {backToCase}
            </ScrollView>
          )}
        </View>
      </>
    );
  }

  const noFollowers = quote?.recipients.kind === "NONE" || noticeCode === "AREA_VISIBILITY_NO_FOLLOWERS";
  const errorInfo = noticeCode && noticeCode !== "AREA_VISIBILITY_NO_FOLLOWERS" ? classifyAreaAlertError(noticeCode) : null;
  const noticeKey = noticeCode ? visibilityNoticeKey(noticeCode) : null;
  const price = quote ? (quote.pilotFree ? t("areaAlertCreate.pilotFree") : formatMoney(quote.amountOre / 100, STORED_MONEY_CURRENCY, language)) : "";
  const canBuy = !!quote && !noFollowers && consent && !buying && !quoting;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.safe}>
        {header}
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.mapFrame}>
            <MapView
              ref={mapRef}
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              style={s.map}
              initialRegion={{ ...center, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
            >
              <Marker coordinate={center} />
              <Circle center={center} radius={radiusM} strokeColor="#2563EB" strokeWidth={3} fillColor="rgba(37,99,235,.16)" />
            </MapView>
          </View>
          <View style={s.chips}>
            {VISIBILITY_RADII.map((r) => {
              const on = r === radiusM;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => setRadiusM(r)}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{formatDistance(r, language, t)}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t("areaVisibility.followers")}</Text>
              {quoting ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <Text style={s.rowValue}>
                  {!quote
                    ? "–"
                    : quote.recipients.kind === "NONE"
                      ? "0"
                      : quote.recipients.kind === "FEW"
                        ? t("areaVisibility.followersFew")
                        : t("areaVisibility.followersAbout", { count: quote.recipients.value })}
                </Text>
              )}
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t("areaVisibility.priceFor7Days")}</Text>
              <Text style={s.rowValue}>{quoting || !quote ? "–" : price}</Text>
            </View>
            {!!quote?.pilotFree && (
              <Text style={s.help}>
                {t("areaAlertCreate.listPrice", { price: formatMoney(quote.listPriceOre / 100, STORED_MONEY_CURRENCY, language) })}
              </Text>
            )}
            <View style={s.divider} />
            <Text style={s.help}>{t("areaVisibility.howPriced")}</Text>
          </View>

          {noFollowers && <InlineNotice tone="info" icon="people-outline" title={t("areaVisibility.noFollowersTitle")} body={t("areaVisibility.noFollowersBody")} />}
          {!!errorInfo && (
            <InlineNotice
              tone="warning"
              icon="alert-circle-outline"
              title={t(noticeKey ?? (errorInfo.kind === "purchase" ? "purchase.errorTitle" : "areaAlertCreate.errorUnknownTitle"))}
              body={errorInfo.kind === "purchase" ? t(knownErrorKey(errorInfo.code) ?? "purchase.failedBody") : t("areaVisibility.errorBody")}
              actionLabel={errorInfo.retryable ? t("errors.retry") : undefined}
              onAction={() => void loadQuote()}
            />
          )}

          <Text style={s.eyebrow}>{t("areaVisibility.previewTitle")}</Text>
          <View style={s.preview}>
            <View style={s.previewIcon}>
              <Ionicons name="search-outline" size={22} color={theme.colors.textSecondary} />
            </View>
            <View style={s.previewText}>
              <Text style={s.previewTitle} numberOfLines={1}>
                {t("areaVisibility.previewLost", { title: String(params.title || "") })}
              </Text>
              <Text style={s.help}>{t("areaVisibility.previewBody")}</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="link"
            style={s.link}
            onPress={() => router.replace({ pathname: "/geo-alert-create", params: { reportId, title: params.title, lat: params.lat, lng: params.lng } })}
          >
            <Text style={s.linkText}>{t("areaVisibility.chooseAlert")}</Text>
          </Pressable>

          {!!quote && !quote.pilotFree && <Text style={s.help}>{t("areaAlertCreate.test.mode.no.real.payment.is.made.activation.cre")}</Text>}
          <WithdrawalConsent checked={consent} onChange={setConsent} />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canBuy }}
            disabled={!canBuy}
            style={[s.primary, !canBuy && s.disabled]}
            onPress={() => void buy()}
          >
            {buying ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{t("areaVisibility.buy", { price })}</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  muted: { color: theme.colors.textSecondary, fontWeight: "700", textAlign: "center" },
  mapFrame: { height: 190, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border },
  map: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, justifyContent: "center" },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  chipTextOn: { color: "#fff" },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 28 },
  rowLabel: { fontSize: 15, fontWeight: "700", color: theme.colors.textSecondary },
  rowValue: { fontSize: 19, fontWeight: "900", color: theme.colors.text },
  divider: { height: 1, backgroundColor: theme.colors.divider },
  help: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: theme.colors.textSecondary, marginTop: 4 },
  preview: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 12 },
  previewIcon: { width: 48, height: 48, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  previewText: { flex: 1, gap: 2 },
  previewTitle: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontSize: 14, fontWeight: "800", color: "#1D4ED8" },
  primary: { minHeight: 52, borderRadius: 14, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.5 },
  statusCard: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 20, alignItems: "center", gap: 8 },
  statusIcon: { width: 56, height: 56, borderRadius: 999, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 20, fontWeight: "900", color: theme.colors.text, textAlign: "center" },
  statusBody: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center" },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(AreaVisibilityCreateScreen);
