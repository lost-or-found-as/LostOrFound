// app/alert-areas.tsx
// Alert areas: the user's saved areas (max MAX_SAVED_AREAS) and "Varsle meg der jeg er".
// T1.9W: the old list screen and the old editor route (app/alert-area-editor.tsx) are merged into
// this one screen. The list shows a map card, "Mine områder" with a ⋯ menu per area, and the
// position alert card. The editor opens as a full panel inside this screen (not a Modal), so taps
// on its map keep working for placing the centre / polygon points. No system dialogs: errors and
// confirmations show as InlineNotice / ConfirmSheet.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Circle, Marker, Polygon, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import { formatDistance, formatTimeAgo } from "../src/i18n/formatters";
import { BottomSheet, Button, ConfirmSheet, EmptyState, IconButton, InfoButton, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import {
  type Area,
  type AreaMode,
  type CurrentSettings,
  type Point,
  CATEGORIES,
  CATEGORY_LABEL_KEYS,
  CURRENT_LOCATION_COLOR,
  CURRENT_LOCATION_RADII,
  DEFAULT_CENTER,
  DEFAULT_CURRENT_SETTINGS,
  DEFAULT_SAVED_RADIUS,
  EXPIRIES,
  MAX_SAVED_AREAS,
  RADII,
  areaBounds,
  areaCenter,
  areaColor,
  currentSettingsFrom,
  isCurrentLocationArea,
  sameSettings,
  validPoint,
} from "../src/lib/alertAreas";

type Notice = { tone: "warning" | "info" | "error" | "success"; title: string; body?: string } | null;
type EditorTarget = { id: string | null } | null;

const LOGIN_CODES = new Set(["LOGIN_REQUIRED", "HTTP_401", "UNAUTHORIZED", "INVALID_TOKEN", "MISSING_BEARER_TOKEN"]);

function AlertAreasScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const overviewMapRef = useRef<MapView>(null);
  const editorMapRef = useRef<MapView>(null);

  // Data
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Saved-area menu and delete confirmation
  const [menuArea, setMenuArea] = useState<Area | null>(null);
  const [deleteArea, setDeleteArea] = useState<Area | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // "Varsle meg der jeg er"
  const [busy, setBusy] = useState(false);
  const [currentNotice, setCurrentNotice] = useState<Notice>(null);
  const [radius, setRadius] = useState(DEFAULT_CURRENT_SETTINGS.radius);
  const [expiryHours, setExpiryHours] = useState(DEFAULT_CURRENT_SETTINGS.expiryHours);
  const [allCategories, setAllCategories] = useState(DEFAULT_CURRENT_SETTINGS.allCategories);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CURRENT_SETTINGS.categories);

  // Editor (new or existing saved area)
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [editorNotice, setEditorNotice] = useState<Notice>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<AreaMode>("CIRCLE");
  const [center, setCenter] = useState<Point>(DEFAULT_CENTER);
  const [areaRadius, setAreaRadius] = useState(DEFAULT_SAVED_RADIUS);
  const [points, setPoints] = useState<Point[]>([]);
  const [areaAllCategories, setAreaAllCategories] = useState(true);
  const [areaCategories, setAreaCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  // The position alert is managed by its own switch: it never shows in "Mine områder" and does
  // not count towards the limit.
  const current = areas.find(isCurrentLocationArea) || null;
  const saved = useMemo(() => areas.filter((x) => !isCurrentLocationArea(x)), [areas]);
  const savedSettings = useMemo(() => currentSettingsFrom(current), [current]);
  const editSettings: CurrentSettings = { radius, expiryHours, allCategories, categories };
  const settingsChanged = !sameSettings(editSettings, savedSettings);
  const editingArea = editor?.id ? saved.find((x) => x.id === editor.id) || null : null;

  const headers = useCallback(async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("LOGIN_REQUIRED");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, []);

  // Error code → user text. Unknown codes get the action's own fallback.
  const friendly = useCallback(
    (error: any, fallback: string) => {
      const code = String(error?.message || error || "");
      if (LOGIN_CODES.has(code)) return t("alertAreas.loginRequired");
      if (code.includes("INVALID_BOUNDARY")) return t("alertAreas.invalidArea");
      if (code === "WATCH_AREA_LIMIT_REACHED") return t("alertAreas.maximumReachedBody");
      if (code === "NAME_REQUIRED") return t("alertAreas.nameRequired");
      return fallback;
    },
    [t],
  );

  const fitOverview = useCallback((list: Area[]) => {
    const coords = list.filter((a) => a.active).flatMap(areaBounds);
    if (!coords.length) return;
    setTimeout(
      () =>
        overviewMapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 28, right: 28, bottom: 28, left: 28 },
          animated: true,
        }),
      120,
    );
  }, []);

  const applyCurrentSettings = (value: CurrentSettings) => {
    setRadius(value.radius);
    setExpiryHours(value.expiryHours);
    setAllCategories(value.allCategories);
    setCategories(value.categories);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/alert-areas`, {
        headers: await headers(),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const list: Area[] = j.areas || [];
      setAreas(list);
      setLoadError(null);
      const currentArea = list.find(isCurrentLocationArea) || null;
      if (currentArea) applyCurrentSettings(currentSettingsFrom(currentArea));
      fitOverview(list);
    } catch (e: any) {
      console.warn("[alert-areas] load failed", String(e?.message || ""));
      setLoadError(friendly(e, t("alertAreas.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [headers, fitOverview, friendly, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------- "Varsle meg der jeg er" ----------

  const updateCurrent = useCallback(
    async (silent = false) => {
      // A silent refresh (app opened) re-sends what is saved, never unsaved edits.
      const settings = silent ? savedSettings : { radius, expiryHours, allCategories, categories };
      try {
        setBusy(true);
        if (!silent) setCurrentNotice(null);
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (!silent)
            setCurrentNotice({
              tone: "warning",
              title: t("alertAreas.locationPermissionTitle"),
              body: t("alertAreas.locationPermissionBody"),
            });
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
            radiusM: settings.radius,
            expiryHours: settings.expiryHours,
            allCategories: settings.allCategories,
            categoryKeys: settings.categories,
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
        if (!silent) setCurrentNotice({ tone: "success", title: t("alertAreas.currentSaved") });
      } catch (e: any) {
        const code = String(e?.message || "");
        console.warn("[alert-areas] current location update failed", code);
        if (!silent) {
          const message =
            code === "CURRENT_LOCATION_STORAGE_FAILED"
              ? t("alertAreas.locationStorageFailed")
              : LOGIN_CODES.has(code)
                ? t("alertAreas.loginRequired")
                : code.startsWith("HTTP_") || code === "CURRENT_LOCATION_UPDATE_FAILED"
                  ? t("alertAreas.locationServiceFailed")
                  : t("alertAreas.locationReadFailed");
          setCurrentNotice({ tone: "error", title: t("alertAreas.locationUpdateFailed"), body: message });
        }
      } finally {
        setBusy(false);
      }
    },
    [radius, expiryHours, allCategories, categories, savedSettings, headers, load, t],
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
      setCurrentNotice(null);
      const r = await fetch(`${API_BASE_URL}/alert-areas/current-location`, {
        method: "DELETE",
        headers: await headers(),
      });
      if (!r.ok) throw new Error("DISABLE_FAILED");
      await load();
    } catch (e: any) {
      console.warn("[alert-areas] current location disable failed", String(e?.message || ""));
      setCurrentNotice({ tone: "error", title: t("alertAreas.locationDisableFailed") });
    } finally {
      setBusy(false);
    }
  };

  const toggleCurrentCategory = (key: string) => {
    setAllCategories(false);
    setCategories((v) => (v.includes(key) ? v.filter((x) => x !== key) : [...v, key]));
  };

  const expiryLabel = (h: number) =>
    h === 24
      ? t("alertAreas.expiryOneDay")
      : h === 72
        ? t("alertAreas.expiryThreeDays")
        : h === 168
          ? t("alertAreas.expiryOneWeek")
          : t("alertAreas.expiryUntilOff");

  // ---------- Saved areas: pause / delete ----------

  const patchStatus = async (area: Area, patch: any) => {
    try {
      setRowBusyId(area.id);
      setNotice(null);
      const response = await fetch(`${API_BASE_URL}/alert-areas/${area.id}`, {
        method: "PATCH",
        headers: await headers(),
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("WATCH_AREA_UPDATE_FAILED");
      await load();
    } catch (e: any) {
      console.warn("[alert-areas] status update failed", String(e?.message || ""));
      setNotice({ tone: "error", title: t("alertAreas.pauseFailed"), body: friendly(e, t("alertAreas.tryAgain")) });
    } finally {
      setRowBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleteArea) return;
    try {
      setDeleteBusy(true);
      setDeleteError(null);
      const response = await fetch(`${API_BASE_URL}/alert-areas/${deleteArea.id}`, {
        method: "DELETE",
        headers: await headers(),
      });
      if (!response.ok) throw new Error("WATCH_AREA_DELETE_FAILED");
      setDeleteArea(null);
      setNotice({ tone: "success", title: t("alertAreas.deleted") });
      await load();
    } catch (e: any) {
      console.warn("[alert-areas] delete failed", String(e?.message || ""));
      setDeleteError(friendly(e, t("alertAreas.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ---------- Editor ----------

  const fitEditor = useCallback((coords: Point[]) => {
    if (!coords.length) return;
    setTimeout(
      () =>
        editorMapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 90, right: 36, bottom: 36, left: 36 },
          animated: true,
        }),
      120,
    );
  }, []);

  const openNew = () => {
    setNotice(null);
    if (saved.length >= MAX_SAVED_AREAS) {
      setNotice({ tone: "info", title: t("alertAreas.maximumReached"), body: t("alertAreas.maximumReachedBody") });
      return;
    }
    setName("");
    setMode("CIRCLE");
    setCenter(DEFAULT_CENTER);
    setAreaRadius(DEFAULT_SAVED_RADIUS);
    setPoints([]);
    setAreaAllCategories(true);
    setAreaCategories([]);
    setQuery("");
    setResults([]);
    setEditorNotice(null);
    setEditor({ id: null });
  };

  const openEdit = (item: Area) => {
    const polygon = (item.boundary_points || []).filter(validPoint);
    setNotice(null);
    setName(item.name);
    setMode(item.area_type === "POLYGON" ? "POLYGON" : "CIRCLE");
    setCenter(areaCenter(item) || polygon[0] || DEFAULT_CENTER);
    setAreaRadius(item.radius_m || DEFAULT_SAVED_RADIUS);
    setPoints(polygon);
    setAreaAllCategories(item.all_categories);
    setAreaCategories(item.category_keys || []);
    setQuery("");
    setResults([]);
    setEditorNotice(null);
    setEditor({ id: item.id });
  };

  const closeEditor = useCallback(() => {
    setEditor(null);
    setEditorNotice(null);
    setResults([]);
    fitOverview(areas);
  }, [areas, fitOverview]);

  // Android back closes the editor first instead of leaving the screen.
  useEffect(() => {
    if (!editor) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeEditor();
      return true;
    });
    return () => sub.remove();
  }, [editor, closeEditor]);

  const onEditorMapReady = () => {
    if (editingArea) fitEditor(areaBounds(editingArea));
  };

  const locate = async () => {
    try {
      setLocating(true);
      setEditorNotice(null);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setEditorNotice({
          tone: "warning",
          title: t("alertAreas.locationPermissionTitle"),
          body: t("alertAreas.locationPermissionBody"),
        });
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCenter(next);
      setPoints([]);
      editorMapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 250);
    } catch (e: any) {
      console.warn("[alert-areas] locate failed", String(e?.message || ""));
      setEditorNotice({ tone: "error", title: t("alertAreas.locationReadFailed") });
    } finally {
      setLocating(false);
    }
  };

  const search = async () => {
    const value = query.trim();
    if (value.length < 3) return;
    try {
      setSearching(true);
      setEditorNotice(null);
      const response = await fetch(
        `${API_BASE_URL}/geo/search?q=${encodeURIComponent(value)}&language=${encodeURIComponent(language)}`,
        { headers: await headers() },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResults(data.results || []);
    } catch (error: any) {
      setEditorNotice({ tone: "error", title: friendly(error, t("alertAreas.searchFailed")) });
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
    editorMapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 250);
  };

  const mapPress = (point: Point) => {
    setResults([]);
    if (mode === "CIRCLE") setCenter(point);
    else setPoints((list) => [...list, point]);
  };

  const toggleAreaCategory = (key: string) => {
    setAreaAllCategories(false);
    setAreaCategories((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]));
  };

  const save = async () => {
    const editingId = editor?.id || null;
    setEditorNotice(null);
    if (!editingId && saved.length >= MAX_SAVED_AREAS)
      return setEditorNotice({ tone: "warning", title: t("alertAreas.maximumReached"), body: t("alertAreas.maximumReachedBody") });
    if (!name.trim()) return setEditorNotice({ tone: "warning", title: t("alertAreas.nameRequired") });
    if (mode === "POLYGON" && points.length < 3)
      return setEditorNotice({ tone: "warning", title: t("alertAreas.morePointsTitle"), body: t("alertAreas.morePointsBody") });
    try {
      setEditorBusy(true);
      const body: any = {
        name: name.trim(),
        areaType: mode,
        allCategories: areaAllCategories,
        categoryKeys: areaCategories,
        pushEnabled: true,
      };
      if (mode === "CIRCLE")
        Object.assign(body, {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusM: areaRadius,
        });
      else body.boundaryPoints = points;
      const response = await fetch(`${API_BASE_URL}/alert-areas${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: await headers(),
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEditor(null);
      setResults([]);
      setNotice({ tone: "success", title: t("alertAreas.saved") });
      await load();
    } catch (error: any) {
      console.warn("[alert-areas] save failed", String(error?.message || ""));
      setEditorNotice({ tone: "error", title: t("alertAreas.saveFailed"), body: friendly(error, t("alertAreas.tryAgain")) });
    } finally {
      setEditorBusy(false);
    }
  };

  // ---------- Rendering helpers ----------

  const renderArea = (a: Area) => {
    const isCurrent = isCurrentLocationArea(a);
    const stroke = isCurrent ? CURRENT_LOCATION_COLOR : areaColor(saved.indexOf(a));
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
    const p = areaCenter(a);
    if (!p) return null;
    return (
      <React.Fragment key={a.id}>
        <Circle
          center={p}
          radius={a.radius_m || DEFAULT_SAVED_RADIUS}
          strokeColor={stroke}
          fillColor={isCurrent ? "rgba(22,163,74,.16)" : `${stroke}20`}
          strokeWidth={3}
        />
        <Marker coordinate={p} pinColor={stroke} />
      </React.Fragment>
    );
  };

  const areaMeta = (a: Area) =>
    [
      a.area_type === "POLYGON" ? t("alertAreas.area") : formatDistance(a.radius_m || DEFAULT_SAVED_RADIUS, language, t),
      a.all_categories ? t("alertAreas.rowAllCategories") : t("alertAreas.categoryCount", { count: a.category_keys?.length || 0 }),
      a.active ? t("alertAreas.rowActive") : t("alertAreas.rowPaused"),
    ].join(" · ");

  const currentStatus = current?.active
    ? t("alertAreas.currentStatusOn", {
        radius: formatDistance(current.radius_m || savedSettings.radius, language, t),
        time: current.location_updated_at ? formatTimeAgo(current.location_updated_at, t, "long") : t("alertAreas.neverUpdated"),
      })
    : t("alertAreas.currentLocationOff");

  const chip = (key: string | number, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[s.chip, on && s.chipOn]}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );

  const categoryChips = (all: boolean, selected: string[], onAll: () => void, onToggle: (key: string) => void) => (
    <View style={s.chips}>
      {chip("ALL", t("alertAreas.allCategories"), all, onAll)}
      {CATEGORIES.map((k) => chip(k, t(CATEGORY_LABEL_KEYS[k]), !all && selected.includes(k), () => onToggle(k)))}
    </View>
  );

  const info = (
    <InfoButton title={t("alertAreas.info.title")} label={t("alertAreas.info.title")}>
      <View style={s.infoBlock}>
        <Text style={s.infoHeading}>{t("alertAreas.info.savedTitle")}</Text>
        <Text style={s.infoBody}>{t("alertAreas.info.savedBody", { max: MAX_SAVED_AREAS })}</Text>
      </View>
      <View style={s.infoBlock}>
        <Text style={s.infoHeading}>{t("alertAreas.notifyWhereIAm")}</Text>
        <Text style={s.infoBody}>{t("alertAreas.info.currentBody")}</Text>
      </View>
      <View style={s.infoBlock}>
        <Text style={s.infoHeading}>{t("alertAreas.automaticExpiry")}</Text>
        <Text style={s.infoBody}>{t("alertAreas.info.expiryBody")}</Text>
      </View>
    </InfoButton>
  );

  // ---------- Editor view ----------

  if (editor) {
    const isEdit = !!editor.id;
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScreenHeader
            title={isEdit ? t("alertAreas.editTitle") : t("alertAreas.newArea")}
            onBack={closeEditor}
            raised
          />
          <View style={s.editorMapWrap}>
            <MapView
              ref={editorMapRef}
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              style={StyleSheet.absoluteFill}
              initialRegion={{ ...center, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
              onMapReady={onEditorMapReady}
              onPress={(event) => mapPress(event.nativeEvent.coordinate)}
            >
              {mode === "CIRCLE" ? (
                <>
                  <Marker coordinate={center} draggable onDragEnd={(event) => setCenter(event.nativeEvent.coordinate)} />
                  <Circle center={center} radius={areaRadius} strokeColor="#2563EB" fillColor="rgba(37,99,235,.15)" />
                </>
              ) : (
                <>
                  {points.map((point, index) => (
                    <Marker key={`${point.latitude}-${point.longitude}-${index}`} coordinate={point} pinColor="#F59E0B" />
                  ))}
                  {points.length >= 3 && (
                    <Polygon coordinates={points} strokeColor="#2563EB" fillColor="rgba(37,99,235,.18)" strokeWidth={3} />
                  )}
                </>
              )}
            </MapView>
            <View style={s.searchBox}>
              <View style={s.searchRow}>
                <TextInput
                  style={s.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={() => void search()}
                  returnKeyType="search"
                  placeholder={t("alertAreas.searchPlaceholder")}
                  placeholderTextColor={theme.colors.muted}
                  accessibilityLabel={t("alertAreas.searchPlaceholder")}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("alertAreas.search")}
                  style={s.searchButton}
                  onPress={() => void search()}
                >
                  {searching ? <ActivityIndicator color="#fff" /> : <Ionicons name="search" size={20} color="#fff" />}
                </Pressable>
              </View>
              {results.length > 0 && (
                <View style={s.results}>
                  {results.map((item) => (
                    <Pressable
                      key={item.id || item.label}
                      accessibilityRole="button"
                      style={s.result}
                      onPress={() => chooseResult(item)}
                    >
                      <Text style={s.resultText} numberOfLines={2}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
          <View style={s.editorPanel}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.editorContent}
            >
              <View style={s.segment}>
                {(["CIRCLE", "POLYGON"] as AreaMode[]).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mode === value }}
                    onPress={() => {
                      setMode(value);
                      setPoints([]);
                    }}
                    style={[s.segmentItem, mode === value && s.segmentItemOn]}
                  >
                    <Text style={[s.segmentText, mode === value && s.segmentTextOn]}>
                      {value === "CIRCLE" ? t("alertAreas.place") : t("alertAreas.area")}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.help}>{mode === "CIRCLE" ? t("alertAreas.tapPlace") : t("alertAreas.tapPolygon")}</Text>
              <Text style={s.label}>{t("alertAreas.nameLabel")}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("alertAreas.namePlaceholder")}
                placeholderTextColor={theme.colors.muted}
                accessibilityLabel={t("alertAreas.nameLabel")}
                maxLength={80}
                style={s.input}
              />
              {mode === "CIRCLE" ? (
                <>
                  <Text style={s.label}>{t("alertAreas.radius")}</Text>
                  <View style={s.chips}>
                    {RADII.map((value) => chip(value, formatDistance(value, language, t), areaRadius === value, () => setAreaRadius(value)))}
                  </View>
                </>
              ) : (
                <View style={s.pointRow}>
                  <Text style={s.pointCount}>{t("alertAreas.pointCount", { count: points.length })}</Text>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={10}
                    disabled={!points.length}
                    onPress={() => setPoints((list) => list.slice(0, -1))}
                  >
                    <Text style={[s.link, !points.length && s.linkOff]}>{t("alertAreas.undo")}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" hitSlop={10} disabled={!points.length} onPress={() => setPoints([])}>
                    <Text style={[s.linkDanger, !points.length && s.linkOff]}>{t("alertAreas.clear")}</Text>
                  </Pressable>
                </View>
              )}
              <Text style={s.label}>{t("alertAreas.categories")}</Text>
              {categoryChips(
                areaAllCategories,
                areaCategories,
                () => {
                  setAreaAllCategories(true);
                  setAreaCategories([]);
                },
                toggleAreaCategory,
              )}
              {!!editorNotice && <InlineNotice tone={editorNotice.tone} title={editorNotice.title} body={editorNotice.body} />}
              <View style={s.actions}>
                <Button
                  label={t("alertAreas.myLocation")}
                  variant="neutral"
                  busy={locating}
                  onPress={() => void locate()}
                  style={s.flex}
                />
                <Button
                  label={isEdit ? t("alertAreas.saveChanges") : t("alertAreas.saveArea")}
                  busy={editorBusy}
                  onPress={() => void save()}
                  style={s.flex}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </>
    );
  }

  // ---------- List view ----------

  const atLimit = saved.length >= MAX_SAVED_AREAS;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.safe}>
        <ScreenHeader
          title={t("alertAreas.title")}
          subtitle={t("alertAreas.subtitle")}
          onBack={() => router.back()}
          right={info}
        />
        <ScrollView contentContainerStyle={s.content}>
          {!!notice && <InlineNotice tone={notice.tone} title={notice.title} body={notice.body} style={s.noticeTop} />}

          <View style={s.mapCard}>
            <MapView
              ref={overviewMapRef}
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              style={StyleSheet.absoluteFill}
              initialRegion={{ ...DEFAULT_CENTER, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
              onMapReady={() => fitOverview(areas)}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              accessibilityLabel={t("alertAreas.allAreasVisible")}
            >
              {areas.filter((x) => x.active).map(renderArea)}
            </MapView>
            <View style={s.mapButton}>
              <IconButton icon="map-outline" label={t("alertAreas.showAllAreas")} onPress={() => fitOverview(areas)} color={theme.colors.text} />
            </View>
          </View>

          {loading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={s.muted}>{t("common.loading")}</Text>
            </View>
          ) : loadError ? (
            <InlineNotice
              tone="warning"
              title={t("alertAreas.loadFailed")}
              body={loadError === t("alertAreas.loadFailed") ? undefined : loadError}
              actionLabel={t("errors.retry")}
              onAction={() => {
                setLoading(true);
                void load();
              }}
              style={s.noticeTop}
            />
          ) : (
            <>
              {saved.length === 0 ? (
                <EmptyState
                  icon="map-outline"
                  title={t("alertAreas.emptyTitle")}
                  body={t("alertAreas.emptyBody")}
                  action={<Button label={t("alertAreas.newAreaAction")} onPress={openNew} style={s.emptyAction} />}
                />
              ) : (
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <Text style={s.h2}>
                      {t("alertAreas.myAreasCount", { count: saved.length, max: MAX_SAVED_AREAS })}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("alertAreas.newArea")}
                      accessibilityHint={atLimit ? t("alertAreas.maximumReachedBody") : undefined}
                      onPress={openNew}
                      style={({ pressed }) => [s.newButton, atLimit && s.newButtonOff, pressed && s.pressed]}
                    >
                      <Text style={s.newButtonText}>{t("alertAreas.newShort")}</Text>
                    </Pressable>
                  </View>
                  {saved.map((a, i) => (
                    <View key={a.id} style={s.row}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${a.name}, ${areaMeta(a)}`}
                        onPress={() => {
                          const coords = areaBounds(a);
                          if (coords.length)
                            overviewMapRef.current?.fitToCoordinates(coords, {
                              edgePadding: { top: 28, right: 28, bottom: 28, left: 28 },
                              animated: true,
                            });
                        }}
                        style={s.rowMain}
                      >
                        <View style={[s.dot, { backgroundColor: areaColor(i) }, !a.active && s.dotPaused]} />
                        <View style={s.rowText}>
                          <Text style={s.rowTitle} numberOfLines={1}>
                            {a.name}
                          </Text>
                          <Text style={s.rowMeta} numberOfLines={1}>
                            {areaMeta(a)}
                          </Text>
                        </View>
                      </Pressable>
                      {rowBusyId === a.id ? (
                        <View style={s.rowBusy}>
                          <ActivityIndicator color={theme.colors.primary} />
                        </View>
                      ) : (
                        <IconButton
                          icon="ellipsis-horizontal"
                          label={t("alertAreas.areaOptions", { name: a.name })}
                          onPress={() => setMenuArea(a)}
                          color={theme.colors.text}
                        />
                      )}
                    </View>
                  ))}
                </View>
              )}

              <View style={s.card}>
                <View style={s.cardHeader}>
                  <View style={s.rowText}>
                    <Text style={s.h2}>{t("alertAreas.notifyWhereIAm")}</Text>
                    <Text style={s.help}>{t("alertAreas.notifyWhereIAmBody")}</Text>
                  </View>
                  <Switch
                    accessibilityLabel={t("alertAreas.notifyWhereIAm")}
                    value={!!current?.active}
                    disabled={busy}
                    onValueChange={(enabled) => (enabled ? void updateCurrent(false) : void disableCurrent())}
                  />
                </View>
                <View style={[s.statusBox, current?.active ? s.statusBoxActive : busy ? s.statusBoxBusy : s.statusBoxOff]}>
                  {busy ? (
                    <ActivityIndicator size="small" color="#2563EB" />
                  ) : (
                    <Ionicons name="locate" size={16} color={current?.active ? "#166534" : theme.colors.textSecondary} />
                  )}
                  <Text style={[s.statusText, current?.active && s.statusTextOn]}>{currentStatus}</Text>
                </View>
                {!!currentNotice && (
                  <InlineNotice tone={currentNotice.tone} title={currentNotice.title} body={currentNotice.body} style={s.noticeTop} />
                )}
                {current?.active && (
                  <>
                    <Text style={s.label}>{t("alertAreas.radius")}</Text>
                    <View style={s.chips}>
                      {CURRENT_LOCATION_RADII.map((v) => chip(v, formatDistance(v, language, t), radius === v, () => setRadius(v)))}
                    </View>
                    <Text style={s.label}>{t("alertAreas.categories")}</Text>
                    {categoryChips(
                      allCategories,
                      categories,
                      () => {
                        setAllCategories(true);
                        setCategories([]);
                      },
                      toggleCurrentCategory,
                    )}
                    <Text style={s.label}>{t("alertAreas.automaticExpiry")}</Text>
                    <View style={s.chips}>
                      {EXPIRIES.map((v) => chip(v, expiryLabel(v), expiryHours === v, () => setExpiryHours(v)))}
                    </View>
                    {settingsChanged && <Text style={s.unsaved}>{t("alertAreas.unsavedChanges")}</Text>}
                    <View style={s.actions}>
                      <Button
                        label={t("alertAreas.updatePositionNow")}
                        variant="neutral"
                        disabled={busy || settingsChanged}
                        onPress={() => void updateCurrent(false)}
                        style={s.flex}
                      />
                      <Button
                        label={t("alertAreas.saveChanges")}
                        busy={busy && settingsChanged}
                        disabled={busy || !settingsChanged}
                        onPress={() => void updateCurrent(false)}
                        style={s.flex}
                      />
                    </View>
                  </>
                )}
                <Text style={s.privacy}>{t("alertAreas.locationPrivacy")}</Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>

      <BottomSheet visible={!!menuArea} onClose={() => setMenuArea(null)} accessibilityLabel={t("common.close")}>
        <Text style={s.sheetTitle} numberOfLines={2}>
          {menuArea?.name ?? ""}
        </Text>
        <View>
          {[
            {
              key: "edit",
              icon: "create-outline" as const,
              label: t("alertAreas.edit"),
              onPress: () => {
                const a = menuArea;
                setMenuArea(null);
                if (a) openEdit(a);
              },
            },
            {
              key: "pause",
              icon: menuArea?.active ? ("pause-outline" as const) : ("play-outline" as const),
              label: menuArea?.active ? t("alertAreas.pause") : t("alertAreas.activate"),
              onPress: () => {
                const a = menuArea;
                setMenuArea(null);
                if (a) void patchStatus(a, { active: !a.active });
              },
            },
            {
              key: "delete",
              icon: "trash-outline" as const,
              label: t("alertAreas.delete"),
              danger: true,
              onPress: () => {
                const a = menuArea;
                setMenuArea(null);
                setDeleteError(null);
                setDeleteArea(a);
              },
            },
          ].map((item) => (
            <React.Fragment key={item.key}>
              {item.danger && <View style={s.divider} />}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}
                onPress={item.onPress}
              >
                <Ionicons name={item.icon} size={22} color={item.danger ? theme.colors.dangerStrong : theme.colors.text} />
                <Text style={[s.menuLabel, item.danger && s.menuDanger]}>{item.label}</Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      </BottomSheet>

      <ConfirmSheet
        visible={!!deleteArea}
        title={t("alertAreas.deleteConfirmTitle", { name: deleteArea?.name ?? "" })}
        body={t("alertAreas.deleteConfirmBody")}
        confirmLabel={t("alertAreas.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={deleteBusy}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (deleteBusy) return;
          setDeleteArea(null);
          setDeleteError(null);
        }}
      >
        {!!deleteError && <InlineNotice tone="error" title={deleteError} style={s.noticeFlat} />}
      </ConfirmSheet>
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 12 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  noticeTop: { marginTop: 0 },
  noticeFlat: { marginTop: 0 },
  muted: { fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary },

  // Map card (overview of all active areas)
  mapCard: {
    height: 190,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#DDE7D3",
  },
  mapButton: { position: "absolute", top: 10, right: 10 },

  loadingBox: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },

  // Cards
  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  h2: { fontSize: 16, fontWeight: "900", color: theme.colors.text, flexShrink: 1 },
  help: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  newButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  newButtonOff: { opacity: 0.5 },
  newButtonText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  emptyAction: { alignSelf: "stretch", marginTop: 6 },

  // Saved-area rows
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowMain: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  rowMeta: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  rowBusy: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 999 },
  dotPaused: { opacity: 0.35 },

  // Position alert status line
  statusBox: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBoxActive: {},
  statusBoxBusy: { opacity: 0.8 },
  statusBoxOff: {},
  statusText: { flex: 1, fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  statusTextOn: { color: "#166534" },
  unsaved: { fontSize: 13, fontWeight: "700", color: theme.tone.warning.fg },
  privacy: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: theme.colors.textSecondary },

  // Chips and form controls
  label: { marginTop: 4, fontSize: 13, fontWeight: "800", color: theme.colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.colors.chipBg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: "800", color: "#334155" },
  chipTextOn: { color: "#FFFFFF" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },

  // Info sheet
  infoBlock: { gap: 4 },
  infoHeading: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  infoBody: { fontSize: 15, lineHeight: 22, fontWeight: "500", color: "#334155" },

  // Menu sheet
  sheetTitle: { fontSize: 19, fontWeight: "900", color: theme.colors.text },
  menuItem: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 12, paddingHorizontal: 4 },
  menuItemPressed: { backgroundColor: theme.colors.divider },
  menuLabel: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.colors.text },
  menuDanger: { color: theme.colors.dangerStrong },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },

  // Editor
  editorMapWrap: { flex: 1, minHeight: 220 },
  searchBox: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.inputBg,
  },
  searchButton: {
    width: 48,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  results: { marginTop: 6 },
  result: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
  resultText: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
  editorPanel: {
    maxHeight: "50%",
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -18,
  },
  editorContent: { padding: 16, paddingBottom: 28, gap: 10 },
  segment: { flexDirection: "row", gap: 8, padding: 4, borderRadius: 14, backgroundColor: theme.colors.chipBg },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  segmentItemOn: { backgroundColor: theme.colors.primary },
  segmentText: { fontSize: 15, fontWeight: "800", color: theme.colors.textSecondary },
  segmentTextOn: { color: "#FFFFFF" },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.inputBg,
  },
  pointRow: { flexDirection: "row", alignItems: "center", gap: 20, minHeight: 44 },
  pointCount: { flex: 1, fontSize: 14, fontWeight: "800", color: theme.colors.textSecondary },
  link: { fontSize: 15, fontWeight: "800", color: theme.colors.primary },
  linkDanger: { fontSize: 15, fontWeight: "800", color: theme.colors.dangerStrong },
  linkOff: { opacity: 0.4 },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(AlertAreasScreen);
