import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import MapView, { Marker, Circle } from "react-native-maps";
import ImageViewing from "react-native-image-viewing";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { useI18n } from "../../src/i18n/I18nProvider";
import { PremiumHeader } from "../../src/ui/PremiumHeader";
import { theme } from "../../src/ui/theme";
import { CATEGORIES, SUBCATEGORIES } from "../../src/lib/categories";
import { en, type TranslationKey } from "../../src/i18n/locales/en";
import { fetchGeoAlertStatus } from "../../src/lib/reportCommerce";
import {
  classifyAreaAlertError,
  deriveAreaAlertView,
  type AreaAlertErrorInfo,
  type GeoAlertStatus,
} from "../../src/lib/areaAlertStatus";
import { AreaAlertServiceCard } from "../../src/ui/AreaAlertServiceCard";
import { InlineNotice } from "../../src/ui/InlineNotice";
type D = {
  report: any;
  images: any[];
  entitlements: any[];
  geo_alert_campaigns: any[];
  confirmed_matches: any[];
  last_messages: any[];
  observations: any[];
};
const dt = (v: string | undefined, l: "no" | "en") =>
  v
    ? new Date(v).toLocaleString(l === "en" ? "en-GB" : "nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
type Translate = (key: TranslationKey, params?: Record<string, string | number | null | undefined>) => string;
// Labels for stored technical values (status, category, color) come from the locale files.
function human(v: any, l: "no" | "en", t: Translate) {
  const k = String(v || "")
    .toUpperCase()
    .replace(/-/g, "_");
  const key = `caseLabel.${k}`;
  if (k && key in en) return t(key as TranslationKey);
  if (l === "no") {
    const category = CATEGORIES.find((x) => x.value === k);
    if (category) return category.label;
    for (const options of Object.values(SUBCATEGORIES)) {
      const item = options.find((x) => x.value === k);
      if (item) return item.label;
    }
  }
  return String(v || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (x) => x.toUpperCase());
}
function Screen() {
  const router = useRouter(),
    { id } = useLocalSearchParams<{ id: string }>(),
    { language, t } = useI18n();
  const [data, setData] = useState<D | null>(null),
    [loading, setLoading] = useState(true),
    [viewer, setViewer] = useState(false),
    [index, setIndex] = useState(0),
    [loadError, setLoadError] = useState<AreaAlertErrorInfo | null>(null),
    [geoStatus, setGeoStatus] = useState<GeoAlertStatus | null>(null);
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const token = (await supabase.auth.getSession()).data.session
        ?.access_token;
      if (!token) throw new Error("AUTH_REQUIRED");
      const r = await fetch(
          `${API_BASE_URL}/reports/${encodeURIComponent(String(id))}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        j = await r.json();
      if (!r.ok)
        throw Object.assign(new Error(j?.error || `HTTP_${r.status}`), {
          status: r.status,
        });
      setData(j);
    } catch (e: any) {
      // T1.8E.5I: shown in the screen with a retry, never as a native dialog.
      setLoadError(classifyAreaAlertError(e));
    } finally {
      setLoading(false);
    }
  }, [id, language]);
  useEffect(() => {
    void load();
  }, [load]);
  // T1.8E.5I: area-alert status, refreshed whenever the screen gets focus again
  // (for example after returning from the order screen).
  const loadGeoStatus = useCallback(async () => {
    try {
      setGeoStatus(await fetchGeoAlertStatus(String(id)));
    } catch {
      setGeoStatus(null);
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void loadGeoStatus();
    }, [loadGeoStatus]),
  );
  const geoView = useMemo(() => deriveAreaAlertView(geoStatus), [geoStatus]);
  const imgs = useMemo(
    () =>
      (data?.images || [])
        .filter((x) => x.signed_url)
        .map((x) => ({ uri: String(x.signed_url) })),
    [data],
  );
  if (loading)
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: false,
            title: t("caseDetail.case.details"),
            headerBackTitle: "",
          }}
        />
        <View style={s.safe}>
          <PremiumHeader
            title={t("caseDetail.case.details")}
            onBack={() => router.back()}
          />
          <View style={s.loadingContent}>
            <View style={[s.loadingBlock, s.loadingHero]} />
            <View style={s.loadingCard}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={s.loadingText}>
                {t("caseDetail.loadingReport")}
              </Text>
            </View>
            <View style={s.loadingBlock} />
            <View style={s.loadingBlock} />
          </View>
        </View>
      </>
    );
  if (!data)
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: false,
            title: t("caseDetail.case.details"),
            headerBackTitle: "",
          }}
        />
        <View style={s.safe}>
          <PremiumHeader
            title={t("caseDetail.case.details")}
            onBack={() => router.back()}
          />
          <View style={s.errorWrap}>
            {loadError && loadError.kind !== "notAvailable" && loadError.kind !== "unknown" ? (
              <InlineNotice
                tone={loadError.kind === "auth" ? "info" : "warning"}
                icon={
                  loadError.kind === "network"
                    ? "wifi-outline"
                    : loadError.kind === "auth"
                      ? "lock-closed-outline"
                      : "cloud-offline-outline"
                }
                title={
                  loadError.kind === "network"
                    ? t("errors.networkTitle")
                    : loadError.kind === "auth"
                      ? t("errors.authTitle")
                      : t("errors.serviceTitle")
                }
                body={
                  loadError.kind === "network"
                    ? t("errors.networkBody")
                    : loadError.kind === "auth"
                      ? t("errors.authBody")
                      : t("errors.serviceBody")
                }
                actionLabel={loadError.retryable ? t("errors.retry") : undefined}
                onAction={() => void load()}
              />
            ) : (
              <InlineNotice
                tone="info"
                icon="document-text-outline"
                title={t("caseDetail.case.unavailable")}
                body={t("caseDetail.could.not.load.case")}
                actionLabel={t("errors.retry")}
                onAction={() => void load()}
              />
            )}
          </View>
        </View>
      </>
    );
  const openAreaAlert = () =>
    router.push({
      pathname: "/geo-alert-create",
      params: {
        reportId: data.report.id,
        title: data.report.title || human(data.report.subcategory_key, language, t),
        lat: String(data.report.lat),
        lng: String(data.report.lng),
      },
    });
  // Paid add-ons other than the area alert (which has its own card above).
  const otherServices = data.entitlements.filter(
    (e) =>
      !String(e?.product_code || "").startsWith("GEO_ALERT_TIER_") &&
      String(e?.status || "").toUpperCase() === "ACTIVE" &&
      (!e?.current_period_end || new Date(e.current_period_end).getTime() > Date.now()),
  );
  const r = data.report,
    kind =
      String(r.type).toUpperCase() === "FOUND"
        ? t("caseDetail.found")
        : t("caseDetail.lost"),
    status =
      String(r.status).toUpperCase() === "ACTIVE"
        ? t("caseDetail.active")
        : human(r.status, language, t),
    title = human(r.subcategory_key, language, t) || t("caseDetail.item"),
    radius = Number(
      r.radius_m ||
        r.search_radius_m ||
        r.area_radius_m ||
        r.location_radius_m ||
        0,
    ),
    secondary = String(r.description || "").match(
      /(?:Secondary color|Tilleggsfarge):\s*([^\n]+)/i,
    )?.[1];
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          title: t("caseDetail.case.details"),
          headerBackTitle: "",
        }}
      />
      <View style={s.safe}>
        <PremiumHeader
          title={t("caseDetail.case.details")}
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.hero}>
            {imgs[0] ? (
              <Pressable
                onPress={() => {
                  setIndex(0);
                  setViewer(true);
                }}
              >
                <Image source={imgs[0]} style={s.heroImage} />
              </Pressable>
            ) : null}
            <View style={s.badges}>
              <Text style={s.kind}>{kind}</Text>
              <Text style={s.status}>{status}</Text>
            </View>
            <Text style={s.title}>{title}</Text>
            <Text style={s.meta}>
              {[r.location_label, dt(r.occurred_at, language)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {Number(r.reward_ore) > 0 && (
              <Text style={s.reward}>
                {t("caseDetail.reward")}: {Number(r.reward_ore) / 100} NOK
              </Text>
            )}
          </View>
          <Card title={t("caseDetail.details.and.photos")}>
            <Row
              label={t("caseDetail.category")}
              value={human(r.category, language, t)}
            />
            <Row label={t("caseDetail.object")} value={title} />
            <Row
              label={t("caseDetail.color")}
              value={human(r.color, language, t)}
            />
            {secondary && (
              <Row
                label={t("caseDetail.secondaryColor")}
                value={human(secondary, language, t)}
              />
            )}
            <Row label={t("caseDetail.brand")} value={r.brand} />
            <Row
              label={t("caseDetail.description")}
              value={String(r.description || "")
                .replace(/(?:Secondary color|Tilleggsfarge):\s*[^\n]+/i, "")
                .trim()}
              multiline
            />
          </Card>
          <Card title={t("caseDetail.area")}>
            {r.lat != null && r.lng != null && (
              <MapView
                style={s.map}
                initialRegion={{
                  latitude: Number(r.lat),
                  longitude: Number(r.lng),
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}
                scrollEnabled={false}
              >
                <Marker
                  coordinate={{
                    latitude: Number(r.lat),
                    longitude: Number(r.lng),
                  }}
                />
                {radius > 0 && (
                  <Circle
                    center={{
                      latitude: Number(r.lat),
                      longitude: Number(r.lng),
                    }}
                    radius={radius}
                    strokeColor="#2563EB"
                    fillColor="rgba(37,99,235,.10)"
                  />
                )}
              </MapView>
            )}
            <Row label={t("caseDetail.place")} value={r.location_label} />
            <Row
              label={t("caseDetail.radius")}
              value={radius ? `${radius} m` : null}
            />
          </Card>
          {String(r.type).toUpperCase() === "LOST" &&
            r.lat != null &&
            geoView.kind !== "none" && (
              <AreaAlertServiceCard view={geoView} onSendNew={openAreaAlert} />
            )}
          {String(r.type).toUpperCase() === "LOST" &&
            r.lat != null &&
            geoView.kind === "none" && (
            <View style={s.cta}>
              <Text style={s.h2}>{t("caseDetail.notify.people.nearby")}</Text>
              <Text style={s.muted}>
                {t(
                  "caseDetail.preview.coverage.qualified.recipients.and.the.current.test.price.befor",
                )}
              </Text>
              <Pressable style={s.primary} onPress={openAreaAlert}>
                <Text style={s.primaryText}>
                  {t("caseDetail.preview.area.alert")}
                </Text>
              </Pressable>
            </View>
          )}
          <Card title={t("caseDetail.additional.services")}>
            <Empty
              text={
                otherServices.length
                  ? t("caseDetail.activeServicesCount", {
                      count: otherServices.length,
                    })
                  : t("caseDetail.no.paid.additions")
              }
            />
          </Card>
          <Card title={t("caseDetail.observations.and.possible.finds")}>
            <Empty
              text={
                data.observations.length
                  ? t("caseDetail.observationsCount", {
                      count: data.observations.length,
                    })
                  : t("caseDetail.no.observations.yet")
              }
            />
          </Card>
          <Card title={t("caseDetail.confirmed.matches.and.chat")}>
            <Empty
              text={
                data.confirmed_matches.length
                  ? t("caseDetail.matchesCount", {
                      count: data.confirmed_matches.length,
                    })
                  : t("caseDetail.no.confirmed.matches")
              }
            />
          </Card>
          <Pressable
            style={s.edit}
            onPress={() =>
              router.push({
                pathname: "/(report)/create-report",
                params: { editReportId: r.id },
              })
            }
          >
            <Text style={s.primaryText}>{t("caseDetail.edit.report")}</Text>
          </Pressable>
        </ScrollView>
        <ImageViewing
          images={imgs}
          imageIndex={index}
          visible={viewer && imgs.length > 0}
          onRequestClose={() => setViewer(false)}
        />
      </View>
    </>
  );
}
function Card({ title, children }: { title: string; children: any }) {
  return (
    <View style={s.card}>
      <Text style={s.h2}>{title}</Text>
      {children}
    </View>
  );
}
function Row({
  label,
  value,
  multiline,
}: {
  label: string;
  value: any;
  multiline?: boolean;
}) {
  if (value == null || String(value).trim() === "") return null;
  return (
    <View style={[s.row, multiline && s.rowColumn]}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, multiline && s.valueLeft]}>{String(value)}</Text>
    </View>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorWrap: { padding: 16 },
  loadingContent: { padding: 16 },
  loadingCard: {
    height: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  loadingText: {
    marginTop: 10,
    color: theme.colors.muted,
    fontWeight: "700",
  },
  loadingBlock: {
    height: 120,
    borderRadius: 18,
    backgroundColor: "#E9EEF5",
    marginBottom: 12,
  },
  loadingHero: { height: 210 },
  content: { padding: 14, paddingBottom: 40 },
  hero: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: 12,
    ...theme.shadow.card,
  },
  heroImage: {
    width: "100%",
    height: 220,
    borderRadius: 15,
    backgroundColor: "#E2E8F0",
  },
  badges: { marginTop: 14, flexDirection: "row", gap: 8 },
  kind: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#FFF1F2",
    color: "#BE123C",
    fontWeight: "900",
  },
  status: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#ECFDF5",
    color: "#15803D",
    fontWeight: "900",
  },
  title: {
    marginTop: 13,
    fontSize: 26,
    fontWeight: "900",
    color: theme.colors.text,
  },
  meta: {
    marginTop: 6,
    color: theme.colors.muted,
    fontWeight: "700",
    lineHeight: 20,
  },
  reward: {
    marginTop: 12,
    alignSelf: "flex-start",
    padding: 8,
    borderRadius: 10,
    backgroundColor: "#FFFBEB",
    color: "#92400E",
    fontWeight: "900",
  },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: 12,
  },
  h2: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  row: {
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    gap: 16,
  },
  rowColumn: { flexDirection: "column", gap: 6 },
  label: { flex: 1, color: theme.colors.muted, fontWeight: "700" },
  value: {
    flex: 1.6,
    color: theme.colors.text,
    fontWeight: "800",
    textAlign: "right",
  },
  valueLeft: { textAlign: "left" },
  map: { height: 190, borderRadius: 14, marginTop: 13, overflow: "hidden" },
  cta: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#93C5FD",
    backgroundColor: "#EFF6FF",
    marginBottom: 12,
  },
  muted: {
    marginTop: 7,
    color: theme.colors.muted,
    fontWeight: "600",
    lineHeight: 19,
  },
  primary: {
    marginTop: 13,
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "900" },
  empty: {
    marginTop: 12,
    padding: 13,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
  },
  emptyText: { color: theme.colors.muted, fontWeight: "700", lineHeight: 19 },
  edit: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(Screen);
