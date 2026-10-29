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
  FlatList,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, {
  Circle,
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import * as Location from "expo-location";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";

type Point = { latitude: number; longitude: number };
type AreaMode = "CIRCLE" | "POLYGON";
type Area = {
  id: string;
  name: string;
  area_type?: AreaMode;
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
  boundary_points?: Point[];
  category_keys: string[];
  all_categories: boolean;
  push_enabled: boolean;
  active: boolean;
};
const DEFAULT_CENTER: Point = { latitude: 59.9139, longitude: 10.7522 };
const RADII = [250, 500, 1000, 3000, 5000, 10000];
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
const CATEGORY_LABEL_KEYS = {
  PETS: "alertAreas.category.pets",
  JEWELRY: "alertAreas.category.jewelry",
  ELECTRONICS: "alertAreas.category.electronics",
  KEYS: "alertAreas.category.keys",
  BAGS: "alertAreas.category.bags",
  CLOTHING: "alertAreas.category.clothing",
  SPORTS: "alertAreas.category.sports",
  TRANSPORT: "alertAreas.category.transport",
} as const;
const validPoint = (value: any): value is Point =>
  Number.isFinite(Number(value?.latitude)) &&
  Number.isFinite(Number(value?.longitude));
const circleBounds = (center: Point, radiusMeters: number): Point[] => {
  const latitudeOffset = radiusMeters / 111_320;
  const longitudeScale = Math.max(
    0.15,
    Math.cos((center.latitude * Math.PI) / 180),
  );
  const longitudeOffset = radiusMeters / (111_320 * longitudeScale);

  return [
    { latitude: center.latitude + latitudeOffset, longitude: center.longitude },
    { latitude: center.latitude - latitudeOffset, longitude: center.longitude },
    {
      latitude: center.latitude,
      longitude: center.longitude + longitudeOffset,
    },
    {
      latitude: center.latitude,
      longitude: center.longitude - longitudeOffset,
    },
  ];
};

function AlertAreaEditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language, t } = useI18n();
  const mapRef = useRef<MapView>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(150);
  const [name, setName] = useState("");
  const [center, setCenter] = useState<Point>(DEFAULT_CENTER);
  const [radius, setRadius] = useState(1000);
  const [mode, setMode] = useState<AreaMode>("CIRCLE");
  const [points, setPoints] = useState<Point[]>([]);
  const [allCategories, setAllCategories] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const selected = areas.find((item) => item.id === selectedId) || null;
  const region = useMemo<Region>(
    () => ({ ...DEFAULT_CENTER, latitudeDelta: 0.08, longitudeDelta: 0.08 }),
    [],
  );
  const headers = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("LOGIN_REQUIRED");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, []);
  const friendly = (error: any, fallback: string) => {
    const code = String(error?.message || error || "");
    if (code === "LOGIN_REQUIRED") return t("alertAreas.loginRequired");
    if (code.includes("INVALID_BOUNDARY")) return t("alertAreas.invalidArea");
    return fallback;
  };
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/alert-areas`, {
        headers: await headers(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAreas(data.areas || []);
    } catch (error: any) {
      Alert.alert(
        t("alertAreas.error"),
        friendly(error, t("alertAreas.loadFailed")),
      );
    }
  }, [headers, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const onPanelLayout = (event: LayoutChangeEvent) =>
    setPanelHeight(Math.round(event.nativeEvent.layout.height));
  const fitArea = useCallback(
    (item: Area, bottomPadding = panelHeight + 24) => {
      const edgePadding = {
        top: insets.top + 135,
        right: 38,
        bottom: bottomPadding,
        left: 38,
      };
      const polygon = (item.boundary_points || []).filter(validPoint);

      if (item.area_type === "POLYGON" && polygon.length >= 3) {
        mapRef.current?.fitToCoordinates(polygon, {
          edgePadding,
          animated: true,
        });
        return;
      }

      const circleCenter = validPoint({
        latitude: item.latitude,
        longitude: item.longitude,
      })
        ? {
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
          }
        : DEFAULT_CENTER;

      mapRef.current?.fitToCoordinates(
        circleBounds(circleCenter, item.radius_m || 1000),
        { edgePadding, animated: true },
      );
    },
    [insets.top, panelHeight],
  );
  const selectArea = (item: Area) => {
    setSelectedId(item.id);
    setEditorOpen(false);
    setTimeout(() => fitArea(item, 170), 50);
  };
  const applyAreaToEditor = (item: Area) => {
    const polygon = (item.boundary_points || []).filter(validPoint);
    setSelectedId(item.id);
    setName(item.name);
    setMode(item.area_type === "POLYGON" ? "POLYGON" : "CIRCLE");
    setCenter(
      validPoint({ latitude: item.latitude, longitude: item.longitude })
        ? { latitude: Number(item.latitude), longitude: Number(item.longitude) }
        : polygon[0] || DEFAULT_CENTER,
    );
    setRadius(item.radius_m || 1000);
    setPoints(polygon);
    setAllCategories(item.all_categories);
    setCategories(item.category_keys || []);
    setEditorOpen(true);
    setTimeout(() => fitArea(item, 330), 80);
  };
  const newArea = () => {
    setSelectedId(null);
    setName("");
    setMode("CIRCLE");
    setCenter(DEFAULT_CENTER);
    setRadius(1000);
    setPoints([]);
    setAllCategories(true);
    setCategories([]);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    if (selected) setTimeout(() => fitArea(selected, 170), 50);
  };
  const locate = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return;
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const next = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    setCenter(next);
    setPoints([]);
    mapRef.current?.animateToRegion(
      { ...next, latitudeDelta: 0.03, longitudeDelta: 0.03 },
      250,
    );
  };
  const search = async () => {
    const value = query.trim();
    if (value.length < 3) return;
    try {
      setSearching(true);
      const response = await fetch(
        `${API_BASE_URL}/geo/search?q=${encodeURIComponent(value)}&language=${encodeURIComponent(language)}`,
        { headers: await headers() },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResults(data.results || []);
    } catch (error: any) {
      Alert.alert(
        t("alertAreas.error"),
        friendly(error, t("alertAreas.searchFailed")),
      );
    } finally {
      setSearching(false);
    }
  };
  const chooseResult = (item: any) => {
    const next = {
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
    };
    if (!validPoint(next)) return;
    setCenter(next);
    setPoints([]);
    setQuery(String(item.label || ""));
    setResults([]);
    mapRef.current?.animateToRegion(
      { ...next, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      250,
    );
  };
  const mapPress = (point: Point) => {
    if (!editorOpen) return;
    if (mode === "CIRCLE") setCenter(point);
    else setPoints((current) => [...current, point]);
  };
  const toggleCategory = (key: string) => {
    setAllCategories(false);
    setCategories((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };
  const save = async () => {
    if (!selectedId && areas.length >= 3)
      return Alert.alert(
        t("alertAreas.maximumReached"),
        t("alertAreas.maximumReachedBody"),
      );
    if (!name.trim()) return Alert.alert(t("alertAreas.nameRequired"));
    if (mode === "POLYGON" && points.length < 3)
      return Alert.alert(
        t("alertAreas.morePointsTitle"),
        t("alertAreas.morePointsBody"),
      );
    try {
      setBusy(true);
      const body: any = {
        name: name.trim(),
        areaType: mode,
        allCategories,
        categoryKeys: categories,
        pushEnabled: true,
      };
      if (mode === "CIRCLE")
        Object.assign(body, {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusM: radius,
        });
      else body.boundaryPoints = points;
      const response = await fetch(
        `${API_BASE_URL}/alert-areas${selectedId ? `/${selectedId}` : ""}`,
        {
          method: selectedId ? "PATCH" : "POST",
          headers: await headers(),
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await load();
      setEditorOpen(false);
      setSelectedId(data.area?.id || selectedId);
      setTimeout(() => {
        const refreshed = data.area as Area | undefined;
        if (refreshed) fitArea(refreshed, 170);
      }, 80);
    } catch (error: any) {
      Alert.alert(
        t("alertAreas.error"),
        friendly(error, t("alertAreas.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  };
  const patchStatus = async (id: string, patch: any) => {
    const response = await fetch(`${API_BASE_URL}/alert-areas/${id}`, {
      method: "PATCH",
      headers: await headers(),
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("WATCH_AREA_UPDATE_FAILED");
    await load();
  };
  const remove = async (id: string) => {
    const response = await fetch(`${API_BASE_URL}/alert-areas/${id}`, {
      method: "DELETE",
      headers: await headers(),
    });
    if (!response.ok) throw new Error("WATCH_AREA_DELETE_FAILED");
    if (selectedId === id) setSelectedId(null);
    await load();
  };
  const areaMeta = (item: Area) =>
    item.area_type === "POLYGON"
      ? t("alertAreas.polygonType", {
          count: item.boundary_points?.length || 0,
        })
      : t("alertAreas.circleType", {
          radius:
            (item.radius_m || 0) >= 1000
              ? `${(item.radius_m || 0) / 1000} km`
              : `${item.radius_m || 0} m`,
        });
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          initialRegion={region}
          onPress={(event) => mapPress(event.nativeEvent.coordinate)}
        >
          {editorOpen ? (
            mode === "CIRCLE" ? (
              <>
                <Marker
                  coordinate={center}
                  draggable
                  onDragEnd={(event) => setCenter(event.nativeEvent.coordinate)}
                />
                <Circle
                  center={center}
                  radius={radius}
                  strokeColor="#2563EB"
                  fillColor="rgba(37,99,235,.15)"
                />
              </>
            ) : (
              <>
                {points.map((point, index) => (
                  <Marker
                    key={`${point.latitude}-${point.longitude}-${index}`}
                    coordinate={point}
                    pinColor="#F59E0B"
                  />
                ))}
                {points.length >= 3 && (
                  <Polygon
                    coordinates={points}
                    strokeColor="#2563EB"
                    fillColor="rgba(37,99,235,.18)"
                    strokeWidth={3}
                  />
                )}
              </>
            )
          ) : selected ? (
            selected.area_type === "POLYGON" &&
            selected.boundary_points &&
            selected.boundary_points.length >= 3 ? (
              <Polygon
                coordinates={selected.boundary_points}
                strokeColor="#2563EB"
                fillColor="rgba(37,99,235,.18)"
                strokeWidth={3}
              />
            ) : validPoint({
                latitude: selected.latitude,
                longitude: selected.longitude,
              }) ? (
              <>
                <Marker
                  coordinate={{
                    latitude: Number(selected.latitude),
                    longitude: Number(selected.longitude),
                  }}
                />
                <Circle
                  center={{
                    latitude: Number(selected.latitude),
                    longitude: Number(selected.longitude),
                  }}
                  radius={selected.radius_m || 1000}
                  strokeColor="#2563EB"
                  fillColor="rgba(37,99,235,.15)"
                />
              </>
            ) : null
          ) : null}
        </MapView>
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{t("alertAreas.title")}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={[styles.searchBox, { top: insets.top + 58 }]}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => void search()}
              returnKeyType="search"
              placeholder={t("alertAreas.searchPlaceholder")}
            />
            <Pressable
              style={styles.searchButton}
              onPress={() => void search()}
            >
              {searching ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.searchButtonText}>
                  {t("alertAreas.search")}
                </Text>
              )}
            </Pressable>
          </View>
          {results.length > 0 && (
            <View style={styles.results}>
              {results.map((item) => (
                <Pressable
                  key={item.id || item.label}
                  style={styles.result}
                  onPress={() => chooseResult(item)}
                >
                  <Text numberOfLines={2}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        {editorOpen ? (
          <View
            onLayout={onPanelLayout}
            style={[
              styles.editorPanel,
              { bottom: Math.max(10, insets.bottom + 6) },
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.editorHeader}>
                <Text style={styles.editorTitle}>
                  {selectedId
                    ? t("alertAreas.editing")
                    : t("alertAreas.newArea")}
                </Text>
                <Pressable onPress={closeEditor}>
                  <Text style={styles.link}>{t("alertAreas.hideEditor")}</Text>
                </Pressable>
              </View>
              <View style={styles.modeRow}>
                {(["CIRCLE", "POLYGON"] as AreaMode[]).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setMode(value);
                      setPoints([]);
                    }}
                    style={[styles.mode, mode === value && styles.modeOn]}
                  >
                    <Text
                      style={[
                        styles.modeText,
                        mode === value && styles.modeTextOn,
                      ]}
                    >
                      {value === "CIRCLE"
                        ? t("alertAreas.place")
                        : t("alertAreas.area")}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.help}>
                {mode === "CIRCLE"
                  ? t("alertAreas.tapPlace")
                  : t("alertAreas.tapPolygon")}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("alertAreas.namePlaceholder")}
                style={styles.input}
              />
              {mode === "CIRCLE" ? (
                <View style={styles.row}>
                  {RADII.map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => setRadius(value)}
                      style={[styles.chip, radius === value && styles.chipOn]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          radius === value && styles.chipTextOn,
                        ]}
                      >
                        {value >= 1000 ? `${value / 1000} km` : `${value} m`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={styles.geometryActions}>
                  <Text style={styles.count}>
                    {t("alertAreas.pointCount", { count: points.length })}
                  </Text>
                  <Pressable
                    onPress={() => setPoints((current) => current.slice(0, -1))}
                  >
                    <Text style={styles.link}>{t("alertAreas.undo")}</Text>
                  </Pressable>
                  <Pressable onPress={() => setPoints([])}>
                    <Text style={styles.delete}>{t("alertAreas.clear")}</Text>
                  </Pressable>
                </View>
              )}
              <Pressable
                onPress={() => {
                  setAllCategories(true);
                  setCategories([]);
                }}
                style={[styles.all, allCategories && styles.chipOn]}
              >
                <Text
                  style={[styles.chipText, allCategories && styles.chipTextOn]}
                >
                  {t("alertAreas.allCategories")}
                </Text>
              </Pressable>
              <View style={styles.row}>
                {CATEGORIES.map((key) => (
                  <Pressable
                    key={key}
                    onPress={() => toggleCategory(key)}
                    style={[
                      styles.chip,
                      categories.includes(key) && styles.chipOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        categories.includes(key) && styles.chipTextOn,
                      ]}
                    >
                      {t(
                        CATEGORY_LABEL_KEYS[
                          key as keyof typeof CATEGORY_LABEL_KEYS
                        ],
                      )}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondary}
                  onPress={() => void locate()}
                >
                  <Text style={styles.secondaryText}>
                    {t("alertAreas.myLocation")}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  style={[styles.primary, busy && styles.disabled]}
                  onPress={() => void save()}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryText}>
                      {selectedId
                        ? t("alertAreas.saveChanges")
                        : t("alertAreas.saveArea")}
                    </Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        ) : (
          <View
            onLayout={onPanelLayout}
            style={[
              styles.compactPanel,
              { bottom: Math.max(10, insets.bottom + 6) },
            ]}
          >
            <View style={styles.compactHeader}>
              <View>
                <Text style={styles.compactTitle}>
                  {t("alertAreas.myAreas")}
                </Text>
                <Text style={styles.compactMeta}>{areas.length} / 3</Text>
              </View>
              <Pressable onPress={newArea} style={styles.newButton}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.newButtonText}>
                  {t("alertAreas.newArea")}
                </Text>
              </Pressable>
            </View>
            {selected && (
              <View style={styles.selectedRow}>
                <View style={styles.selectedText}>
                  <Text style={styles.cardTitle}>{selected.name}</Text>
                  <Text style={styles.cardMeta}>{areaMeta(selected)}</Text>
                </View>
                <Pressable onPress={() => applyAreaToEditor(selected)}>
                  <Text style={styles.link}>{t("alertAreas.edit")}</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void patchStatus(selected.id, { active: !selected.active })
                  }
                >
                  <Text style={styles.link}>
                    {selected.active
                      ? t("alertAreas.pause")
                      : t("alertAreas.activate")}
                  </Text>
                </Pressable>
                <Pressable onPress={() => void remove(selected.id)}>
                  <Text style={styles.delete}>{t("alertAreas.delete")}</Text>
                </Pressable>
              </View>
            )}
            <FlatList
              data={areas}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => selectArea(item)}
                  style={[
                    styles.areaChip,
                    selectedId === item.id && styles.areaChipSelected,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.areaChipText,
                      selectedId === item.id && styles.areaChipTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        )}
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  map: { flex: 1 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    minHeight: 56,
    backgroundColor: "rgba(255,255,255,.98)",
    paddingHorizontal: 10,
    paddingBottom: 7,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "900",
    color: theme.colors.text,
  },
  headerSpacer: { width: 42 },
  searchBox: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 50,
    backgroundColor: "rgba(255,255,255,.98)",
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
  },
  searchButton: {
    minWidth: 62,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  searchButtonText: { color: "#fff", fontWeight: "900" },
  results: { marginTop: 6 },
  result: {
    padding: 9,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  compactPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 40,
    backgroundColor: "rgba(255,255,255,.98)",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  compactTitle: { fontWeight: "900", fontSize: 16, color: theme.colors.text },
  compactMeta: { fontSize: 11, fontWeight: "800", color: theme.colors.muted },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.primary,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  newButtonText: { color: "#fff", fontWeight: "900" },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  selectedText: { flex: 1 },
  areaChip: {
    maxWidth: 130,
    marginTop: 9,
    marginRight: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  areaChipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  areaChipText: { fontWeight: "800", color: theme.colors.text },
  areaChipTextSelected: { color: "#fff" },
  editorPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 40,
    maxHeight: "46%",
    backgroundColor: "rgba(255,255,255,.98)",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  editorTitle: { fontWeight: "900", fontSize: 15, color: theme.colors.text },
  modeRow: { flexDirection: "row", gap: 8 },
  mode: {
    flex: 1,
    minHeight: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  modeOn: { backgroundColor: theme.colors.primary },
  modeText: { fontWeight: "900", color: theme.colors.muted },
  modeTextOn: { color: "#fff" },
  help: {
    marginTop: 7,
    color: theme.colors.muted,
    fontWeight: "700",
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 11,
    color: theme.colors.text,
    marginTop: 8,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  chipOn: { backgroundColor: theme.colors.primary },
  chipText: { fontSize: 11, fontWeight: "800", color: "#475569" },
  chipTextOn: { color: "#fff" },
  all: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  geometryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 9,
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  secondary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontWeight: "900", color: theme.colors.text },
  primary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontWeight: "900", color: "#fff" },
  disabled: { opacity: 0.45 },
  count: { marginTop: 8, color: theme.colors.muted, fontWeight: "900" },
  cardTitle: { fontWeight: "900", color: theme.colors.text },
  cardMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.muted,
  },
  link: { color: theme.colors.primary, fontWeight: "900" },
  delete: { color: theme.colors.danger, fontWeight: "900" },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(AlertAreaEditorScreen);
