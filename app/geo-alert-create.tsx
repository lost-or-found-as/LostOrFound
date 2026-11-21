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
  Polygon,
  Polyline,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import type { SearchArea } from "../src/contexts/ReportDraftContext";
import {
  alertPlacesPayload,
  alertPlacesVersion,
  getAlertPlaces,
  MAX_ALERT_PLACES,
  setAlertPlaces,
  startPlaces,
} from "../src/lib/alertPlacesStore";
import { InfoButton, ScreenHeader } from "../src/ui/kit";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";

import { translate } from "../src/i18n/translate";
import type { TranslationKey } from "../src/i18n/locales/en";
import {
  previewGeoAlert,
  rangeText,
  type GeoAlertPreviewResult,
} from "../src/lib/geoAlertPreview";
import {
  completeReportOrder,
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
import { knownErrorKey } from "../src/lib/userError";
import { WithdrawalConsent } from "../src/ui/WithdrawalConsent";
import { Ionicons } from "@expo/vector-icons";
import { formatArea, formatDistance, formatMoney } from "../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../src/lib/market";
import type { Lang } from "../src/i18n/languages";

function tr(language: Lang, key: TranslationKey): string {
  return translate(language, key);
}

const PLACE_COLORS = ["#2563EB", "#16A34A", "#7C3AED"];
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
  // T1.9BG: up to three places (place, route, area), first from the case's own search areas.
  const [places, setPlaces] = useState<SearchArea[]>([]);
  const [placesReady, setPlacesReady] = useState(false);
  const seenVersion = useRef(alertPlacesVersion());
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  // T1.9R: consent that the alert starts at once (right of withdrawal lapses).
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<GeoAlertPreviewResult | null>(null);
  const [activatedUntil, setActivatedUntil] = useState<string | null>(null);
  const [status, setStatus] = useState<GeoAlertStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [notice, setNotice] = useState<AreaAlertNotice | null>(null);
  const validLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
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
  // Days left of a running «Synlig i nærheten» (not one that comes from an area alert).
  const visibilityDaysLeft = useMemo(() => {
    const v = status?.visibility;
    if (!v?.activeUntil || v.viaAreaAlert) return 0;
    const ms = Date.parse(v.activeUntil) - Date.now();
    return ms > 0 ? Math.max(1, Math.ceil(ms / 86400000)) : 0;
  }, [status]);

  // The case's search areas are the starting places.
  useEffect(() => {
    if (!reportId) return;
    let live = true;
    (async () => {
      let searchAreas: unknown = null;
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (token) {
          const r = await fetch(`${API_BASE_URL}/reports/${encodeURIComponent(reportId)}`, { headers: { Authorization: `Bearer ${token}` } });
          const j = await r.json().catch(() => ({}));
          if (r.ok) searchAreas = j?.report?.search_areas;
        }
      } catch {
        // Falls back to one place at the case location.
      }
      if (!live) return;
      setPlaces(startPlaces(searchAreas, latitude, longitude));
      setPlacesReady(true);
    })();
    return () => {
      live = false;
    };
  }, [reportId, latitude, longitude]);

  // Back from the map picker with new places.
  useFocusEffect(
    useCallback(() => {
      const v = alertPlacesVersion();
      if (v !== seenVersion.current) {
        seenVersion.current = v;
        const next = getAlertPlaces();
        if (next && next.length) setPlaces(next);
      }
    }, []),
  );

  const fitPlaces = useCallback(() => {
    const coords = places.flatMap((p) => p.points);
    if (!coords.length) return;
    const pad = Math.max(...places.map((p) => (p.kind === "POLYGON" ? 0 : Number(p.radiusMeters || 500))));
    requestAnimationFrame(() => {
      if (coords.length === 1) {
        const delta = Math.max(0.015, Math.min(1.2, (pad * 2.6) / 111000));
        mapRef.current?.animateToRegion({ ...coords[0], latitudeDelta: delta, longitudeDelta: delta }, 200);
      } else {
        const edge = 40 + Math.min(120, pad / 40);
        mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: edge, right: edge, bottom: edge, left: edge }, animated: true });
      }
    });
  }, [places]);

  useEffect(() => {
    setResult(null);
    setActivatedUntil(null);
    setNotice(null);
    requestIdRef.current = null;
    fitPlaces();
  }, [places, fitPlaces]);

  const editPlaces = () => {
    setAlertPlaces(places);
    seenVersion.current = alertPlacesVersion();
    router.push({ pathname: "/(report)/map", params: { purpose: "alert" } });
  };

  const removePlace = (id: string) => {
    if (places.length <= 1) return;
    setPlaces((current) => current.filter((p) => p.id !== id));
  };

  const calculate = async () => {
    if (!reportId || !validLocation || !places.length) return;
    try {
      setBusy(true);
      setNotice(null);
      const next = await previewGeoAlert({
        reportId,
        places: alertPlacesPayload(places),
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
          places: alertPlacesPayload(places),
          areaSqKm: result.preview.areaSqKm,
          populationDensityBand: result.preview.populationDensityBand,
          durationHours: DURATION_HOURS,
          reminderCount: REMINDER_COUNT,
        },
      });
      orderCreated = true;
      const activated = await completeReportOrder(created.order);
      setActivatedUntil(
        String(activated.entitlement?.current_period_end || ""),
      );
    } catch (e: any) {
      // T1.9AE: the user closed the store sheet; nothing was bought.
      if (String(e?.code || "") === "PURCHASE_CANCELLED") return;
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
        <ScreenHeader
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
    <ScreenHeader
      title={tr(language, "areaAlertCreate.notify.people.nearby")}
      subtitle={String(params.title || "")}
      onBack={() => router.back()}
      raised
      // T1.9BA: the same header as the rest of the app, with an explanation.
      right={<InfoButton title={tr(language, "areaAlertCreate.info.title")} body={tr(language, "areaAlertCreate.info.body")} />}
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

  // T1.9U: after a successful activation the form is replaced by a confirmation, so the radius
  // chips and "Beregn rekkevidde og pris" cannot be used again for the same activation.
  if (activatedUntil) {
    const until = areaAlertDateParts(activatedUntil, language);
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.safe}>
          {header}
          <ScrollView contentContainerStyle={styles.blockedContent}>
            <View style={styles.blockedCard}>
              <View style={[styles.blockedIcon, styles.blockedIconLive]}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#166534" />
              </View>
              <Text style={styles.blockedTitle}>{t("areaAlertCreate.sentTitle")}</Text>
              <Text style={styles.blockedBody}>
                {until.date ? t("areaAlertCreate.sentBody", { date: until.date, time: until.time }) : t("areaAlertCreate.relevantUsersWillBeNotified")}
              </Text>
            </View>
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.back()}>
              <Text style={styles.primaryText}>{t("areaAlertCreate.backToCase")}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </>
    );
  }

  if (view.kind === "live" || view.kind === "completed") {
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
        <ScreenHeader
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
              onMapReady={fitPlaces}
              scrollEnabled
              zoomEnabled
            >
              {places.map((p, index) => {
                const color = PLACE_COLORS[index] ?? PLACE_COLORS[0];
                if (p.kind === "CIRCLE")
                  return (
                    <React.Fragment key={p.id}>
                      <Marker coordinate={p.points[0]} pinColor={color} />
                      <Circle center={p.points[0]} radius={Number(p.radiusMeters || 500)} strokeColor={color} strokeWidth={3} fillColor={`${color}29`} />
                    </React.Fragment>
                  );
                if (p.kind === "ROUTE")
                  return <Polyline key={p.id} coordinates={p.points} strokeColor={color} strokeWidth={8} />;
                return <Polygon key={p.id} coordinates={p.points} strokeColor={color} strokeWidth={3} fillColor={`${color}29`} />;
              })}
            </MapView>
          </View>

          {/* T1.9BG: the places the alert covers, as on the map at registration. */}
          <View style={styles.card}>
            <Text style={styles.h2}>
              {t("areaAlertCreate.places.title", { count: places.length, max: MAX_ALERT_PLACES })}
            </Text>
            {!placesReady ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              places.map((p, index) => (
                <View key={p.id} style={styles.placeRow}>
                  <View style={[styles.placeNumber, { backgroundColor: PLACE_COLORS[index] ?? PLACE_COLORS[0] }]}>
                    <Text style={styles.placeNumberText}>{index + 1}</Text>
                  </View>
                  <View style={styles.placeText}>
                    <Text style={styles.placeTitle}>
                      {p.kind === "CIRCLE" ? t("report.map.place") : p.kind === "ROUTE" ? t("report.map.route") : t("report.map.area")}
                    </Text>
                    <Text style={styles.help}>
                      {p.kind === "CIRCLE"
                        ? t("areaAlertCreate.places.radius", { distance: formatDistance(Number(p.radiusMeters || 500), language, t) })
                        : p.kind === "ROUTE"
                          ? t("areaAlertCreate.places.routeWidth", { distance: formatDistance(Number(p.radiusMeters || 500), language, t) })
                          : t("areaAlertCreate.places.drawn")}
                    </Text>
                  </View>
                  {places.length > 1 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("areaAlertCreate.places.remove")}
                      onPress={() => removePlace(p.id)}
                      hitSlop={8}
                      style={styles.placeRemove}
                    >
                      <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                    </Pressable>
                  )}
                </View>
              ))
            )}
            <Pressable accessibilityRole="button" onPress={editPlaces} style={styles.placeEdit} disabled={!placesReady}>
              <Ionicons name={places.length < MAX_ALERT_PLACES ? "add-circle-outline" : "create-outline"} size={20} color={theme.colors.primary} />
              <Text style={styles.placeEditText}>
                {places.length < MAX_ALERT_PLACES ? t("areaAlertCreate.places.addOrChange") : t("areaAlertCreate.places.change")}
              </Text>
            </Pressable>
            <Text style={styles.help}>{t("areaAlertCreate.places.help")}</Text>
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
            {/* T1.9BI: a running «Synlig i nærheten» is paused, not lost. */}
            {visibilityDaysLeft > 0 && (
              <InlineNotice
                tone="info"
                icon="pause-circle-outline"
                title={t("areaAlertCreate.visibilityPauseTitle")}
                body={t("areaAlertCreate.visibilityPauseBody", { count: visibilityDaysLeft })}
              />
            )}
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
              <Text style={styles.resultMeta}>{formatArea(result.preview.areaSqKm * 1_000_000, language, t)}</Text>
              {/* T1.9T: how many get the push (a band, not an exact number) and the price. */}
              <Text style={styles.recipients}>
                {result.quote.recipients.kind === "NONE"
                  ? t("areaAlertCreate.recipients.none")
                  : result.quote.recipients.kind === "FEW"
                    ? t("areaAlertCreate.recipients.few")
                    : rangeText(result.quote.recipients, t, "areaAlertCreate.recipients.range", "areaAlertCreate.recipients.over")}
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>{t("areaAlertCreate.priceLabel")}</Text>
                <Text style={styles.price}>
                  {result.quote.pilotFree
                    ? t("areaAlertCreate.pilotFree")
                    : formatMoney(result.quote.amountOre / 100, STORED_MONEY_CURRENCY, language)}
                </Text>
              </View>
              {result.quote.pilotFree && (
                <Text style={styles.listPrice}>
                  {t("areaAlertCreate.listPrice", { price: formatMoney(result.quote.listPriceOre / 100, STORED_MONEY_CURRENCY, language) })}
                </Text>
              )}
              <Text style={styles.rules}>{t("areaAlertCreate.rules")}</Text>
              {/* T1.9W: the test-payment note only when something would be charged. */}
              {!result.quote.pilotFree && (
                <Text style={styles.warning}>
                  {tr(
                    language,
                    "areaAlertCreate.test.mode.no.real.payment.is.made.activation.cre",
                  )}
                </Text>
              )}
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
              {!noticeView && <WithdrawalConsent checked={consent} onChange={setConsent} />}
              {!noticeView ? (
                <Pressable
                  disabled={activating || !consent || result.quote.recipients.kind === "NONE"}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: activating || !consent || result.quote.recipients.kind === "NONE" }}
                  style={[styles.activate, (activating || !consent || result.quote.recipients.kind === "NONE") && styles.disabled]}
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
  // T1.9BG: the places together are larger than an alert can cover.
  if (String(notice.info.code || "").toUpperCase().includes("ALERT_AREA_TOO_LARGE"))
    return { tone: "info" as const, icon: "resize-outline" as const, title: t("areaAlertCreate.tooLargeTitle"), body: t("areaAlertCreate.tooLargeBody") };
  switch (notice.info.kind) {
    case "network":
      return { tone: "warning" as const, icon: "wifi-outline" as const, title: t("errors.networkTitle"), body: t("errors.networkBody") + nothing };
    case "service":
      return { tone: "warning" as const, icon: "cloud-offline-outline" as const, title: t("errors.serviceTitle"), body: t("errors.serviceBody") + nothing };
    case "auth":
      return { tone: "info" as const, icon: "lock-closed-outline" as const, title: t("errors.authTitle"), body: t("errors.authBody") };
    case "notAvailable":
      return { tone: "info" as const, icon: "information-circle-outline" as const, title: t("areaAlertCreate.errorNotAvailableTitle"), body: t("areaAlertCreate.errorNotAvailableBody") };
    case "purchase":
      return { tone: "info" as const, icon: "card-outline" as const, title: t("purchase.errorTitle"), body: t(knownErrorKey(notice.info.code) ?? "purchase.failedBody") };
    case "locationRequired":
      return { tone: "info" as const, icon: "location-outline" as const, title: t("areaAlertCreate.errorLocationTitle"), body: t("areaAlertCreate.locationRequired") };
    default:
      return { tone: "error" as const, icon: "alert-circle-outline" as const, title: t("areaAlertCreate.errorUnknownTitle"), body: t("areaAlertCreate.errorUnknownBody") + nothing };
  }
}


const styles = StyleSheet.create({
  recipients: { fontSize: 15, fontWeight: "800", color: theme.colors.text, marginTop: 6 },
  listPrice: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  rules: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary, marginTop: 6 },
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, paddingBottom: 40 },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  placeNumber: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  placeNumberText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  placeText: { flex: 1 },
  placeTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  placeRemove: { minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  placeEdit: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, marginTop: 4 },
  placeEditText: { fontSize: 15, fontWeight: "800", color: theme.colors.primary },
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
