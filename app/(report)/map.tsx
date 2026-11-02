// app/(report)/map.tsx
// Map picker: search areas for a LOST case (place, route or area, max three) or one pin for a
// FOUND case. Used by the old and the new registration. T1.9W: floating header card, dark search
// button, bottom panel with kit buttons and in-panel notices instead of system alerts.
import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Circle, Marker, MapPressEvent, Polygon, Polyline, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useReportDraft, type SearchArea, type ReportType } from "../../src/contexts/ReportDraftContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { userErrorMessage } from "../../src/lib/userError";
import { formatDistance } from "../../src/i18n/formatters";
import { Button, IconButton, InfoButton } from "../../src/ui/kit";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { theme } from "../../src/ui/theme";

const MAX_SEARCH_AREAS = 3;
const RADIUS_OPTIONS = [100, 250, 500, 1000, 2000, 5000];
type Mode = "CIRCLE" | "ROUTE" | "POLYGON";
type Point = { latitude: number; longitude: number };
type Notice = { tone: "warning" | "info" | "error"; title: string; body?: string };
const uid = () => `area_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export default function MapPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reportType?: ReportType }>();
  const insets = useSafeAreaInsets();
  const { language, t } = useI18n();
  const { draft, setLocation, setField } = useReportDraft();
  const mapRef = useRef<MapView>(null);

  const reportType: ReportType = params.reportType === "FOUND" || params.reportType === "LOST"
    ? params.reportType
    : draft.type === "FOUND" ? "FOUND" : "LOST";
  const isFound = reportType === "FOUND";

  const [mode, setMode] = useState<Mode>("CIRCLE");
  const [radius, setRadius] = useState(draft.location?.radiusMeters ?? 500);
  const [areas, setAreas] = useState<SearchArea[]>((draft.searchAreas || []).slice(0, MAX_SEARCH_AREAS));
  const [workingPoints, setWorkingPoints] = useState<Point[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [foundPin, setFoundPin] = useState<Point>({
    latitude: draft.location?.latitude ?? 59.9139,
    longitude: draft.location?.longitude ?? 10.7522,
  });
  const [locating, setLocating] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [addressResults, setAddressResults] = useState<any[]>([]);
  // In-panel message (validation, search and location problems). Cleared on the next user action.
  const [notice, setNotice] = useState<Notice | null>(null);
  const clearNotice = () => setNotice(null);

  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null;
  const atLimit = areas.length >= MAX_SEARCH_AREAS;
  const editableRadius = selectedArea?.kind === "CIRCLE" || selectedArea?.kind === "ROUTE";
  const displayedRadius = editableRadius ? selectedArea?.radiusMeters ?? radius : radius;
  const distance = (meters: number | null | undefined) => formatDistance(meters, language, t);

  const initialRegion = useMemo<Region>(() => ({
    latitude: isFound ? foundPin.latitude : draft.location?.latitude ?? areas[0]?.points[0]?.latitude ?? 59.9139,
    longitude: isFound ? foundPin.longitude : draft.location?.longitude ?? areas[0]?.points[0]?.longitude ?? 10.7522,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  }), []);

  const limitNotice = () => setNotice({
    tone: "warning",
    title: t("report.map.maximum.three.search.areas"),
    body: t("report.map.delete.an.existing.place.route.or"),
  });

  const fitArea = (area: SearchArea) => {
    if (!area.points?.length) return;
    requestAnimationFrame(() => {
      if (area.kind === "CIRCLE") {
        const center = area.points[0];
        const delta = Math.max(0.006, Math.min(1.2, Number(area.radiusMeters || 500) / 25000));
        mapRef.current?.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta }, 250);
      } else {
        mapRef.current?.fitToCoordinates(area.points, {
          edgePadding: { top: 100, right: 70, bottom: 330, left: 70 }, animated: true,
        });
      }
    });
  };

  const selectArea = (id: string) => {
    const area = areas.find((item) => item.id === id);
    if (!area) return;
    clearNotice();
    setSelectedAreaId(id);
    setWorkingPoints([]);
    if (area.kind !== "POLYGON") setRadius(area.radiusMeters ?? 500);
    fitArea(area);
  };

  const startNewArea = () => {
    clearNotice();
    if (atLimit) return limitNotice();
    setSelectedAreaId(null);
    setWorkingPoints([]);
    setMode("CIRCLE");
  };

  const changeMode = (next: Mode) => {
    clearNotice();
    setMode(next);
    setWorkingPoints([]);
  };

  const stopAndSelect = (event: any, id: string) => {
    event?.stopPropagation?.();
    selectArea(id);
  };

  const onLostMapPress = (event: MapPressEvent) => {
    if (selectedAreaId) {
      setSelectedAreaId(null);
      return;
    }
    const point = event.nativeEvent.coordinate;
    if (mode === "CIRCLE") {
      if (atLimit) return limitNotice();
      const newArea: SearchArea = { id: uid(), kind: "CIRCLE", radiusMeters: radius, points: [point] };
      setAreas((current) => [...current, newArea]);
      setSelectedAreaId(newArea.id);
    } else {
      if (atLimit && workingPoints.length === 0) return limitNotice();
      setWorkingPoints((current) => [...current, point]);
    }
  };

  const onMapPress = (event: MapPressEvent) => {
    clearNotice();
    if (isFound) {
      setFoundPin(event.nativeEvent.coordinate);
      return;
    }
    onLostMapPress(event);
  };

  const addWorkingArea = () => {
    clearNotice();
    if (atLimit) return limitNotice();
    const minimum = mode === "ROUTE" ? 2 : 3;
    if (workingPoints.length < minimum) {
      setNotice({
        tone: "warning",
        title: t("report.map.more.points.needed"),
        body: t("report.map.add.at.least.p0.points", { p0: minimum }),
      });
      return;
    }
    const newArea: SearchArea = {
      id: uid(), kind: mode, radiusMeters: mode === "ROUTE" ? radius : undefined, points: workingPoints,
    };
    setAreas((current) => [...current, newArea]);
    setWorkingPoints([]);
    setSelectedAreaId(newArea.id);
  };

  const undo = () => {
    if (isFound) return;
    clearNotice();
    if (workingPoints.length) {
      setWorkingPoints((points) => points.slice(0, -1));
      return;
    }
    if (selectedAreaId) {
      setSelectedAreaId(null);
      return;
    }
    setAreas((current) => current.slice(0, -1));
  };

  const deleteSelected = () => {
    if (!selectedAreaId) return;
    clearNotice();
    setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
    setSelectedAreaId(null);
  };

  const changeSelectedRadius = (nextRadius: number) => {
    clearNotice();
    setRadius(nextRadius);
    if (!selectedAreaId) return;
    setAreas((current) => current.map((area) =>
      area.id === selectedAreaId && area.kind !== "POLYGON" ? { ...area, radiusMeters: nextRadius } : area
    ));
  };

  const placePoint = (point: Point) => {
    if (isFound) {
      setFoundPin(point);
    } else if (selectedArea?.kind === "CIRCLE") {
      setAreas((current) => current.map((area) => area.id === selectedArea.id ? { ...area, points: [point] } : area));
    } else if (!atLimit) {
      const newArea: SearchArea = { id: uid(), kind: "CIRCLE", radiusMeters: radius, points: [point] };
      setAreas((current) => [...current, newArea]);
      setSelectedAreaId(newArea.id);
    } else {
      limitNotice();
      return;
    }
    mapRef.current?.animateToRegion({ ...point, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 250);
  };

  const searchAddress = async () => {
    clearNotice();
    const q = addressQuery.trim();
    if (q.length < 3) {
      setNotice({ tone: "info", title: t("report.map.search.tooShort") });
      return;
    }
    try {
      setSearching(true);
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setNotice({ tone: "warning", title: t("report.map.address.search.failed"), body: t("report.map.log.in.to.search") });
        return;
      }
      const url = API_BASE_URL + "/geo/search?q=" + encodeURIComponent(q) + "&language=" + encodeURIComponent(language);
      const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "ADDRESS_SEARCH_FAILED");
      const results = json?.results || [];
      setAddressResults(results);
      if (!results.length) setNotice({ tone: "info", title: t("report.map.search.noResults") });
    } catch (e: any) {
      setNotice({
        tone: "error",
        title: t("report.map.address.search.failed"),
        body: userErrorMessage(e, t, "errors.generic", "report.map.search"),
      });
    } finally {
      setSearching(false);
    }
  };

  const chooseAddress = (item: any) => {
    clearNotice();
    const point = { latitude: Number(item.latitude), longitude: Number(item.longitude) };
    placePoint(point);
    setAddressQuery(String(item.label || ""));
    setAddressResults([]);
  };

  const centerOnUser = async () => {
    clearNotice();
    try {
      setLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setNotice({ tone: "warning", title: t("report.map.location.deniedTitle"), body: t("report.map.location.deniedBody") });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      placePoint(point);
    } catch {
      setNotice({ tone: "warning", title: t("report.map.location.failedTitle"), body: t("report.map.location.failedBody") });
    } finally {
      setLocating(false);
    }
  };

  const confirmFound = () => {
    setField("searchAreas" as any, []);
    setLocation({ latitude: foundPin.latitude, longitude: foundPin.longitude, radiusMeters: 10, confirmed: true });
    router.back();
  };

  const confirmLost = () => {
    if (workingPoints.length) {
      setNotice({
        tone: "warning",
        title: t("report.map.finish.the.area"),
        body: t("report.map.add.or.discard.the.points.currently"),
      });
      return;
    }
    if (!areas.length) {
      setNotice({ tone: "warning", title: t("report.map.no.search.area"), body: t("report.map.add.at.least.one.area") });
      return;
    }
    const primary = areas[0].points[0];
    setField("searchAreas" as any, areas);
    setLocation({ latitude: primary.latitude, longitude: primary.longitude, radiusMeters: areas[0].radiusMeters ?? radius, confirmed: true });
    router.back();
  };

  const confirm = () => {
    clearNotice();
    if (isFound) confirmFound();
    else confirmLost();
  };

  const renderArea = (area: SearchArea, index: number) => {
    const selected = area.id === selectedAreaId;
    const palette = ["#2563EB", "#16A34A", "#7C3AED"];
    const base = palette[index] ?? "#2563EB";
    const stroke = selected ? "#F59E0B" : base;
    if (area.kind === "CIRCLE") {
      return (
        <React.Fragment key={area.id}>
          <Circle center={area.points[0]} radius={area.radiusMeters || 500} strokeWidth={selected ? 4 : 2} strokeColor={stroke} fillColor={selected ? "rgba(245,158,11,0.24)" : `${base}2E`} />
          <Marker coordinate={area.points[0]} pinColor={selected ? "#F59E0B" : base} onPress={(event) => stopAndSelect(event, area.id)} />
        </React.Fragment>
      );
    }
    if (area.kind === "ROUTE") {
      return <Polyline key={area.id} coordinates={area.points} strokeWidth={selected ? 12 : 8} strokeColor={stroke} tappable onPress={(event) => stopAndSelect(event, area.id)} />;
    }
    return <Polygon key={area.id} coordinates={area.points} strokeWidth={selected ? 4 : 2} strokeColor={stroke} fillColor={selected ? "rgba(245,158,11,0.24)" : `${base}2E`} tappable onPress={(event) => stopAndSelect(event, area.id)} />;
  };

  const renderTop = () => (
    <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.headerCard}>
        <IconButton icon="arrow-back" label={t("common.back")} onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {isFound ? t("report.map.found.location") : t("report.map.search.areas")}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {isFound ? t("report.map.place.one.pin.where.the.item") : t("report.map.p0.of.p1.areas", { p0: areas.length, p1: MAX_SEARCH_AREAS })}
          </Text>
        </View>
        {!isFound && (
          <Pressable accessibilityRole="button" onPress={undo} style={styles.undo} hitSlop={4}>
            <Text style={styles.undoText}>{t("report.map.undo")}</Text>
          </Pressable>
        )}
        {isFound ? (
          <InfoButton title={t("report.map.info.foundTitle")} body={t("report.map.info.foundBody")} />
        ) : (
          <InfoButton title={t("report.map.info.title")} body={t("report.map.info.body")} />
        )}
      </View>
      <View style={styles.searchCard}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={addressQuery}
            onChangeText={(value) => { clearNotice(); setAddressQuery(value); }}
            onSubmitEditing={searchAddress}
            returnKeyType="search"
            placeholder={t("report.map.search.address.or.place")}
            placeholderTextColor={theme.colors.textSecondary}
            accessibilityLabel={t("report.map.search.address.or.place")}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: searching }}
            disabled={searching}
            style={styles.searchButton}
            onPress={searchAddress}
          >
            {searching ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.searchButtonText}>{t("report.map.search")}</Text>}
          </Pressable>
        </View>
        {addressResults.length > 0 && (
          <View style={styles.searchResults}>
            {addressResults.map((item) => (
              <Pressable accessibilityRole="button" key={item.id || item.label} onPress={() => chooseAddress(item)} style={styles.searchResult}>
                <Text style={styles.searchResultText} numberOfLines={2}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );

  const renderNotice = () => notice ? (
    <InlineNotice tone={notice.tone} title={notice.title} body={notice.body} style={styles.notice} />
  ) : null;

  const radiusHelp = () => {
    if (selectedArea?.kind === "ROUTE") {
      return t("report.map.routeWidth", { distance: distance(displayedRadius), total: distance(Number(displayedRadius) * 2) });
    }
    if (selectedArea?.kind === "CIRCLE") return t("report.map.radiusValue", { distance: distance(displayedRadius) });
    if (mode === "ROUTE") return t("report.map.newRouteWidth", { distance: distance(radius) });
    return t("report.map.newPlaceRadius", { distance: distance(radius) });
  };

  if (isFound) {
    return (
      <View style={styles.safe}>
        <MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={styles.map} initialRegion={initialRegion} onPress={onMapPress}>
          <Marker coordinate={foundPin} draggable onDragEnd={(event) => { clearNotice(); setFoundPin(event.nativeEvent.coordinate); }} />
        </MapView>
        {renderTop()}
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />
          <Text style={styles.help}>{t("report.map.tap.the.map.drag.the.pin")}</Text>
          {renderNotice()}
          <View style={styles.actions}>
            <Button label={t("report.map.my.location")} variant="secondary" busy={locating} onPress={() => void centerOnUser()} style={styles.flex} />
            <Button label={t("report.map.confirm.found.location")} onPress={confirm} style={styles.flex} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={styles.map} initialRegion={initialRegion} onPress={onMapPress}>
        {areas.map(renderArea)}
        {workingPoints.map((point, index) => <Marker key={`working-${index}`} coordinate={point} pinColor="#F59E0B" />)}
        {mode === "ROUTE" && workingPoints.length > 1 && <Polyline coordinates={workingPoints} strokeWidth={6} strokeColor="#F59E0B" />}
        {mode === "POLYGON" && workingPoints.length > 2 && <Polygon coordinates={workingPoints} strokeWidth={2} strokeColor="#F59E0B" fillColor="rgba(245,158,11,0.16)" />}
      </MapView>
      {renderTop()}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />
        {areas.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.areaList}>
            {areas.map((area, index) => {
              const selected = area.id === selectedAreaId;
              const detail = area.kind === "POLYGON"
                ? `${area.points.length} ${t("report.map.points")}`
                : area.kind === "ROUTE"
                  ? `${distance(area.radiusMeters || 500)} ${t("report.map.each.side")}`
                  : distance(area.radiusMeters || 500);
              const kindLabel = area.kind === "CIRCLE" ? t("report.map.place") : area.kind === "ROUTE" ? t("report.map.route") : t("report.map.area");
              return (
                <Pressable
                  key={area.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => selectArea(area.id)}
                  style={[styles.areaCard, selected && styles.areaCardSelected]}
                >
                  <Text style={[styles.areaNumber, selected && styles.areaNumberSelected]}>{index + 1}</Text>
                  <View>
                    <Text style={[styles.areaTitle, selected && styles.areaTitleSelected]}>{kindLabel}</Text>
                    <Text style={styles.areaDetail}>{detail}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectedArea ? (
          <View style={styles.selectedBar}>
            <View style={styles.flex}>
              <Text style={styles.selectedTitle}>{t("report.map.selected.area")}</Text>
              <Text style={styles.selectedText}>{t("report.map.adjust.delete.or.continue.with.another")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={deleteSelected} style={styles.deleteButton}>
              <Text style={styles.deleteText}>{t("report.map.delete")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.modes} accessibilityRole="tablist">
              {(["CIRCLE", "ROUTE", "POLYGON"] as Mode[]).map((item) => {
                const active = mode === item;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active, disabled: atLimit }}
                    disabled={atLimit}
                    onPress={() => changeMode(item)}
                    style={[styles.mode, active && styles.modeActive, atLimit && styles.disabled]}
                  >
                    <Text style={[styles.modeText, active && styles.modeTextActive]}>
                      {item === "CIRCLE" ? t("report.map.place.2") : item === "ROUTE" ? t("report.map.route.2") : t("report.map.area.2")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.help}>
              {atLimit ? t("report.map.maximum.reached.select.an.area.above") : mode === "CIRCLE" ? t("report.map.tap.a.possible.place") : t("report.map.tap.points.in.order.then.save")}
            </Text>
          </>
        )}

        {(editableRadius || (!selectedArea && mode !== "POLYGON")) && (
          <>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map((m) => {
                const active = displayedRadius === m;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => changeSelectedRadius(m)}
                    style={[styles.radius, active && styles.radiusActive]}
                  >
                    <Text style={[styles.radiusText, active && styles.radiusTextActive]}>{distance(m)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.radiusHelp}>{radiusHelp()}</Text>
          </>
        )}

        {!selectedArea && mode !== "CIRCLE" && (
          <Button label={t("report.map.save.drawn.area")} variant="neutral" disabled={atLimit} onPress={addWorkingArea} />
        )}

        {selectedArea && !atLimit && (
          <Button label={t("report.map.save.and.add.another.area")} variant="neutral" onPress={startNewArea} />
        )}

        {renderNotice()}

        <View style={styles.actions}>
          <Button label={t("report.map.my.location.2")} variant="secondary" busy={locating} onPress={() => void centerOnUser()} style={styles.flex} />
          <Button label={t("report.map.done")} onPress={confirm} style={styles.flex} />
        </View>
      </View>
    </View>
  );
}

const floating = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.12,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
} as const;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  map: { flex: 1 },
  flex: { flex: 1 },

  top: { position: "absolute", zIndex: 40, top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 18,
    backgroundColor: theme.colors.card,
    ...floating,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  subtitle: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary, marginTop: 1 },
  undo: { minHeight: 44, paddingHorizontal: 6, justifyContent: "center" },
  undoText: { fontSize: 14, fontWeight: "800", color: theme.colors.primary },

  searchCard: { padding: 6, borderRadius: 14, backgroundColor: theme.colors.card, ...floating },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 10, fontSize: 16, color: theme.colors.text },
  searchButton: {
    minWidth: 64,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  searchButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  searchResults: { marginTop: 6, borderTopWidth: 1, borderTopColor: theme.colors.border },
  searchResult: { minHeight: 44, justifyContent: "center", paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  searchResultText: { color: theme.colors.text, fontWeight: "700" },

  panel: {
    position: "absolute",
    zIndex: 30,
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 12,
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 999, backgroundColor: "#CBD5E1" },
  notice: { marginTop: 0 },

  areaList: { gap: 8 },
  areaCard: {
    minWidth: 112,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  areaCardSelected: { borderColor: "#F59E0B", backgroundColor: "#FFFBEB" },
  areaNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: "center",
    lineHeight: 26,
    overflow: "hidden",
    backgroundColor: "#E2E8F0",
    color: "#334155",
    fontWeight: "900",
  },
  areaNumberSelected: { backgroundColor: "#F59E0B", color: "#FFFFFF" },
  areaTitle: { fontWeight: "900", fontSize: 13, color: theme.colors.text },
  areaTitleSelected: { color: "#92400E" },
  areaDetail: { fontWeight: "700", fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },

  modes: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, backgroundColor: "#E9EEF5" },
  mode: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeActive: { backgroundColor: theme.colors.card, ...theme.shadow.card },
  modeText: { fontSize: 14, fontWeight: "800", color: theme.colors.textSecondary },
  modeTextActive: { fontWeight: "900", color: theme.colors.text },
  help: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },

  radiusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  radius: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  radiusActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  radiusText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  radiusTextActive: { color: "#FFFFFF" },
  radiusHelp: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },

  selectedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.tone.warning.bg,
    borderWidth: 1,
    borderColor: theme.tone.warning.border,
  },
  selectedTitle: { fontWeight: "900", color: theme.tone.warning.fg },
  selectedText: { fontWeight: "600", fontSize: 13, color: theme.tone.warning.icon, marginTop: 2 },
  deleteButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: theme.colors.dangerStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: { color: "#FFFFFF", fontWeight: "900" },

  actions: { flexDirection: "row", gap: 10 },
  disabled: { opacity: 0.4 },
});
