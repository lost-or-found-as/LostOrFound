import { requireAccount } from "../src/ui/AccountRequired";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import MapView, {
  Circle,
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import * as Location from "expo-location";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import { formatDateTimeCustom, formatDistance } from "../src/i18n/formatters";

const isLoginRequired = (e: any) => e?.code === "LOGIN_REQUIRED" || String(e?.message ?? "") === "LOGIN_REQUIRED";

type Point = { latitude: number; longitude: number };
type Area = {
  id: string;
  name: string;
  area_type?: "CIRCLE" | "POLYGON";
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
  boundary_points?: Point[];
  category_keys: string[];
  all_categories: boolean;
  push_enabled: boolean;
  active: boolean;
  source_type?: "SAVED" | "CURRENT_LOCATION";
  expires_at?: string | null;
  location_updated_at?: string | null;
};
const RADII = [1000, 3000, 5000, 10000];
const EXPIRIES = [24, 72, 168, 0];
const CATEGORIES = [
  "PETS",
  "JEWELRY",
  "ELECTRONICS",
  "KEYS",
  "BAGS",
  "CLOTHING",
  "SPORTS",
  "TRANSPORT",
];
const LABELS: any = {
  PETS: "alertAreas.category.pets",
  JEWELRY: "alertAreas.category.jewelry",
  ELECTRONICS: "alertAreas.category.electronics",
  KEYS: "alertAreas.category.keys",
  BAGS: "alertAreas.category.bags",
  CLOTHING: "alertAreas.category.clothing",
  SPORTS: "alertAreas.category.sports",
  TRANSPORT: "alertAreas.category.transport",
};
const valid = (p: any) =>
  Number.isFinite(Number(p?.latitude)) && Number.isFinite(Number(p?.longitude));
const circleBounds = (p: Point, r: number) => {
  const a = r / 111320,
    b = r / (111320 * Math.max(0.15, Math.cos((p.latitude * Math.PI) / 180)));
  return [
    { latitude: p.latitude + a, longitude: p.longitude },
    { latitude: p.latitude - a, longitude: p.longitude },
    { latitude: p.latitude, longitude: p.longitude + b },
    { latitude: p.latitude, longitude: p.longitude - b },
  ];
};
function AlertAreasScreen() {
  const router = useRouter(),
    insets = useSafeAreaInsets(),
    { language, t } = useI18n(),
    mapRef = useRef<MapView>(null);
  const [areas, setAreas] = useState<Area[]>([]),
    [busy, setBusy] = useState(false),
    [panelHeight, setPanelHeight] = useState(360),
    [panelCollapsed, setPanelCollapsed] = useState(false),
    [radius, setRadius] = useState(3000),
    [expiryHours, setExpiryHours] = useState(168),
    [allCategories, setAllCategories] = useState(true),
    [categories, setCategories] = useState<string[]>([]);
  const current =
    areas.find((x) => x.source_type === "CURRENT_LOCATION") || null;
  const saved = areas.filter((x) => x.source_type !== "CURRENT_LOCATION");
  const headers = useCallback(async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("LOGIN_REQUIRED");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, []);
  const fitAll = useCallback(
    (list: Area[]) => {
      const points: Point[] = [];
      for (const a of list) {
        if (!a.active) continue;
        if (a.area_type === "POLYGON")
          points.push(...(a.boundary_points || []).filter(valid));
        else if (valid({ latitude: a.latitude, longitude: a.longitude }))
          points.push(
            ...circleBounds(
              { latitude: Number(a.latitude), longitude: Number(a.longitude) },
              a.radius_m || 1000,
            ),
          );
      }
      if (points.length)
        setTimeout(
          () =>
            mapRef.current?.fitToCoordinates(points, {
              edgePadding: {
                top: insets.top + 125,
                right: 45,
                bottom: 430,
                left: 45,
              },
              animated: true,
            }),
          120,
        );
    },
    [insets.top],
  );
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/alert-areas`, {
        headers: await headers(),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const list = j.areas || [];
      setAreas(list);
      const currentArea = list.find(
        (item: Area) => item.source_type === "CURRENT_LOCATION",
      );
      if (currentArea) {
        setRadius(Number(currentArea.radius_m || 3000));
        setAllCategories(currentArea.all_categories !== false);
        setCategories(currentArea.category_keys || []);
        const remainingHours = currentArea.expires_at
          ? Math.max(
              1,
              Math.round(
                (new Date(currentArea.expires_at).getTime() - Date.now()) /
                  3600000,
              ),
            )
          : 0;
        setExpiryHours(
          remainingHours === 0
            ? 0
            : remainingHours <= 24
              ? 24
              : remainingHours <= 72
                ? 72
                : 168,
        );
      }
      fitAll(list);
    } catch (e: any) {
      Alert.alert(
        t("alertAreas.error"),
        isLoginRequired(e)
          ? t("alertAreas.loginRequired")
          : t("alertAreas.loadFailed"),
      );
    }
  }, [headers, fitAll, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const updateCurrent = useCallback(
    async (silent = false) => {
      try {
        setBusy(true);
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (!silent)
            Alert.alert(
              t("alertAreas.locationPermissionTitle"),
              t("alertAreas.locationPermissionBody"),
            );
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const r = await fetch(`${API_BASE_URL}/alert-areas/current-location`, {
          method: "PUT",
          headers: await headers(),
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            radiusM: radius,
            expiryHours,
            allCategories,
            categoryKeys: categories,
            pushEnabled: true,
          }),
        });
        const responseText = await r.text();
        let responseData: any = {};
        try {
          responseData = responseText ? JSON.parse(responseText) : {};
        } catch {
          responseData = {};
        }
        if (!r.ok) throw new Error(responseData.error || `HTTP_${r.status}`);
        await load();
      } catch (e: any) {
        const code = String(e?.message || "");
        console.warn("[alert-areas] current location update failed", code);
        if (!silent) {
          const message =
            code === "CURRENT_LOCATION_STORAGE_FAILED"
              ? t("alertAreas.locationStorageFailed")
              : code === "LOGIN_REQUIRED" || code === "HTTP_401"
                ? t("alertAreas.loginRequired")
                : code.startsWith("HTTP_") ||
                    code === "CURRENT_LOCATION_UPDATE_FAILED"
                  ? t("alertAreas.locationServiceFailed")
                  : t("alertAreas.locationReadFailed");
          Alert.alert(t("alertAreas.error"), message);
        }
      } finally {
        setBusy(false);
      }
    },
    [radius, expiryHours, allCategories, categories, headers, load, t],
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active" && current?.active) void updateCurrent(true);
    });
    return () => listener.remove();
  }, [current?.active, updateCurrent]);
  const disableCurrent = async () => {
    try {
      setBusy(true);
      const r = await fetch(`${API_BASE_URL}/alert-areas/current-location`, {
        method: "DELETE",
        headers: await headers(),
      });
      if (!r.ok) throw new Error("DISABLE_FAILED");
      await load();
    } catch {
      Alert.alert(t("alertAreas.error"), t("alertAreas.locationDisableFailed"));
    } finally {
      setBusy(false);
    }
  };
  const onPanelLayout = (event: LayoutChangeEvent) => {
    if (!panelCollapsed)
      setPanelHeight(Math.ceil(event.nativeEvent.layout.height));
  };
  const toggleCategory = (key: string) => {
    setAllCategories(false);
    setCategories((v) =>
      v.includes(key) ? v.filter((x) => x !== key) : [...v, key],
    );
  };
  const formatUpdated = (iso?: string | null) =>
    iso
      ? formatDateTimeCustom(iso, language, { dateStyle: "short", timeStyle: "short" })
      : t("alertAreas.neverUpdated");
  const expiryLabel = (h: number) =>
    h === 24
      ? t("alertAreas.expiryOneDay")
      : h === 72
        ? t("alertAreas.expiryThreeDays")
        : h === 168
          ? t("alertAreas.expiryOneWeek")
          : t("alertAreas.expiryUntilOff");
  const renderArea = (a: Area, index: number) => {
    const isCurrent = a.source_type === "CURRENT_LOCATION",
      stroke = isCurrent
        ? "#16A34A"
        : ["#2563EB", "#7C3AED", "#EA580C"][index % 3];
    if (a.area_type === "POLYGON" && (a.boundary_points || []).length >= 3)
      return (
        <Polygon
          key={a.id}
          coordinates={a.boundary_points!}
          strokeColor={stroke}
          fillColor={isCurrent ? "rgba(22,163,74,.16)" : `${stroke}24`}
          strokeWidth={3}
        />
      );
    if (!valid({ latitude: a.latitude, longitude: a.longitude })) return null;
    const p = { latitude: Number(a.latitude), longitude: Number(a.longitude) };
    return (
      <React.Fragment key={a.id}>
        <Circle
          center={p}
          radius={a.radius_m || 1000}
          strokeColor={stroke}
          fillColor={isCurrent ? "rgba(22,163,74,.16)" : `${stroke}20`}
          strokeWidth={3}
        />
        <Marker coordinate={p} pinColor={stroke} />
      </React.Fragment>
    );
  };
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.safe}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          style={s.map}
          initialRegion={{
            latitude: 59.9139,
            longitude: 10.7522,
            latitudeDelta: 0.1,
            longitudeDelta: 0.1,
          }}
        >
          {areas.filter((x) => x.active).map(renderArea)}
        </MapView>
        <View style={[s.header, { paddingTop: insets.top + 4 }]}>
          <Pressable onPress={() => router.back()} style={s.round}>
            <Ionicons name="chevron-back" size={25} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>{t("alertAreas.title")}</Text>
            <Text style={s.headerSub}>{t("alertAreas.allAreasVisible")}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("alertAreas.showAllAreas")}
            onPress={() => fitAll(areas)}
            style={s.round}
          >
            <Ionicons name="map-outline" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <View
          onLayout={onPanelLayout}
          style={[
            s.panel,
            panelCollapsed && s.panelCollapsed,
            { bottom: Math.max(10, insets.bottom + 5) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              panelCollapsed
                ? t("alertAreas.expandPanel")
                : t("alertAreas.collapsePanel")
            }
            onPress={() => setPanelCollapsed((value) => !value)}
            style={s.panelHandleRow}
          >
            <View style={s.panelHandle} />
            <Ionicons
              name={panelCollapsed ? "chevron-up" : "chevron-down"}
              size={20}
              color={theme.colors.muted}
            />
          </Pressable>
          <ScrollView
            scrollEnabled={!panelCollapsed}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            <View style={s.sectionTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.h2}>{t("alertAreas.notifyWhereIAm")}</Text>
                <Text style={s.help}>{t("alertAreas.notifyWhereIAmBody")}</Text>
                {panelCollapsed && (
                  <Text style={s.collapsedMeta}>
                    {t("alertAreas.savedAreas")}: {saved.length}
                  </Text>
                )}
              </View>
              <Switch
                accessibilityLabel={
                  current?.active
                    ? t("alertAreas.disableCurrentLocation")
                    : t("alertAreas.enableCurrentLocation")
                }
                value={!!current?.active}
                disabled={busy}
                onValueChange={(enabled) =>
                  enabled ? void updateCurrent(false) : void disableCurrent()
                }
              />
            </View>
            {!panelCollapsed && (
              <>
                <View
                  style={[
                    s.statusBox,
                    current?.active
                      ? s.statusBoxActive
                      : busy
                        ? s.statusBoxBusy
                        : s.statusBoxOff,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#2563EB" />
                  ) : (
                    <Ionicons
                      name="locate"
                      size={20}
                      color={current?.active ? "#15803D" : "#64748B"}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.statusTitle}>
                      {current?.active
                        ? t("alertAreas.currentLocationActive")
                        : t("alertAreas.currentLocationOff")}
                    </Text>
                    <Text style={s.statusMeta}>
                      {t("alertAreas.lastUpdated")}:{" "}
                      {formatUpdated(current?.location_updated_at)}
                    </Text>
                  </View>
                </View>
                <Text style={s.label}>{t("alertAreas.radius")}</Text>
                <View style={s.chips}>
                  {RADII.map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => setRadius(v)}
                      style={[s.chip, radius === v && s.chipOn]}
                    >
                      <Text style={[s.chipText, radius === v && s.chipTextOn]}>
                        {formatDistance(v, language, t)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.label}>{t("alertAreas.categories")}</Text>
                <Pressable
                  onPress={() => {
                    setAllCategories(true);
                    setCategories([]);
                  }}
                  style={[s.chip, s.allChip, allCategories && s.chipOn]}
                >
                  <Text style={[s.chipText, allCategories && s.chipTextOn]}>
                    {t("alertAreas.allCategories")}
                  </Text>
                </Pressable>
                <View style={s.chips}>
                  {CATEGORIES.map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => toggleCategory(k)}
                      style={[s.chip, categories.includes(k) && s.chipOn]}
                    >
                      <Text
                        style={[
                          s.chipText,
                          categories.includes(k) && s.chipTextOn,
                        ]}
                      >
                        {t(LABELS[k])}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.label}>{t("alertAreas.automaticExpiry")}</Text>
                <View style={s.chips}>
                  {EXPIRIES.map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => setExpiryHours(v)}
                      style={[s.chip, expiryHours === v && s.chipOn]}
                    >
                      <Text
                        style={[s.chipText, expiryHours === v && s.chipTextOn]}
                      >
                        {expiryLabel(v)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  disabled={busy}
                  onPress={() => void updateCurrent(false)}
                  style={[s.primary, busy && { opacity: 0.5 }]}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.primaryText}>
                      {current?.active
                        ? t("alertAreas.updatePositionNow")
                        : t("alertAreas.enableCurrentLocation")}
                    </Text>
                  )}
                </Pressable>
                <View style={s.divider} />
                <View style={s.savedHeader}>
                  <View>
                    <Text style={s.h2}>{t("alertAreas.savedAreas")}</Text>
                    <Text style={s.help}>{saved.length} / 3</Text>
                  </View>
                  <Pressable
                    onPress={() => router.push("/alert-area-editor" as any)}
                    style={s.secondary}
                  >
                    <Text style={s.secondaryText}>
                      {t("alertAreas.manageSavedAreas")}
                    </Text>
                  </Pressable>
                </View>
                {saved.map((a, i) => (
                  <View key={a.id} style={s.savedRow}>
                    <View
                      style={[
                        s.dot,
                        {
                          backgroundColor: ["#2563EB", "#7C3AED", "#EA580C"][
                            i % 3
                          ],
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.savedTitle}>{a.name}</Text>
                      <Text style={s.statusMeta}>
                        {a.active
                          ? t("alertAreas.activeArea")
                          : t("alertAreas.pausedArea")}{" "}
                        ·{" "}
                        {a.all_categories
                          ? t("alertAreas.allCategories")
                          : t("alertAreas.categoryCount", {
                              count: a.category_keys?.length || 0,
                            })}
                      </Text>
                    </View>
                  </View>
                ))}
                <Text style={s.privacy}>{t("alertAreas.locationPrivacy")}</Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  map: { flex: 1 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    minHeight: 64,
    paddingHorizontal: 10,
    paddingBottom: 8,
    backgroundColor: "rgba(255,255,255,.97)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  headerSub: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.muted,
    marginTop: 2,
  },
  panelHandleRow: {
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  panelHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
  },
  collapsedMeta: {
    marginTop: 4,
    color: theme.colors.muted,
    fontWeight: "800",
    fontSize: 11,
  },
  panelCollapsed: { maxHeight: 122 },
  panel: {
    position: "absolute",
    left: 10,
    right: 10,
    zIndex: 30,
    maxHeight: "58%",
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,.98)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  h2: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  help: {
    marginTop: 3,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
  },
  statusBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusBoxActive: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  statusBoxOff: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
  },
  statusBoxBusy: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  statusTitle: { fontWeight: "900", color: "#166534" },
  statusMeta: {
    marginTop: 2,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 11,
  },
  label: {
    marginTop: 14,
    marginBottom: 6,
    fontWeight: "900",
    fontSize: 12,
    color: theme.colors.text,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  allChip: { alignSelf: "flex-start", marginBottom: 6 },
  chipOn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: { fontSize: 11, fontWeight: "800", color: "#475569" },
  chipTextOn: { color: "#fff" },
  primary: {
    marginTop: 15,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "900", textAlign: "center" },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 16,
  },
  savedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  secondary: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryText: { fontWeight: "900", color: theme.colors.primary },
  savedRow: {
    marginTop: 9,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: { width: 11, height: 11, borderRadius: 6 },
  savedTitle: { fontWeight: "900", color: theme.colors.text },
  privacy: {
    marginTop: 15,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 11,
    lineHeight: 16,
  },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(AlertAreasScreen);
