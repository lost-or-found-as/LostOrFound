import React, { useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

const MAX_SEARCH_AREAS = 3;
const RADIUS_OPTIONS = [100, 250, 500, 1000, 2000, 5000];
type Mode = "CIRCLE" | "ROUTE" | "POLYGON";
type Point = { latitude: number; longitude: number };
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

  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null;
  const atLimit = areas.length >= MAX_SEARCH_AREAS;
  const editableRadius = selectedArea?.kind === "CIRCLE" || selectedArea?.kind === "ROUTE";
  const displayedRadius = editableRadius ? selectedArea?.radiusMeters ?? radius : radius;

  const initialRegion = useMemo<Region>(() => ({
    latitude: isFound ? foundPin.latitude : draft.location?.latitude ?? areas[0]?.points[0]?.latitude ?? 59.9139,
    longitude: isFound ? foundPin.longitude : draft.location?.longitude ?? areas[0]?.points[0]?.longitude ?? 10.7522,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  }), []);

  const limitAlert = () => Alert.alert(
    t("report.map.maximum.three.search.areas"),
    t("report.map.delete.an.existing.place.route.or")
  );

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
    setSelectedAreaId(id);
    setWorkingPoints([]);
    if (area.kind !== "POLYGON") setRadius(area.radiusMeters ?? 500);
    fitArea(area);
  };

  const startNewArea = () => {
    if (atLimit) return limitAlert();
    setSelectedAreaId(null);
    setWorkingPoints([]);
    setMode("CIRCLE");
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
      if (atLimit) return limitAlert();
      const newArea: SearchArea = { id: uid(), kind: "CIRCLE", radiusMeters: radius, points: [point] };
      setAreas((current) => [...current, newArea]);
      setSelectedAreaId(newArea.id);
    } else {
      if (atLimit && workingPoints.length === 0) return limitAlert();
      setWorkingPoints((current) => [...current, point]);
    }
  };

  const onMapPress = (event: MapPressEvent) => {
    if (isFound) {
      setFoundPin(event.nativeEvent.coordinate);
      return;
    }
    onLostMapPress(event);
  };

  const addWorkingArea = () => {
    if (atLimit) return limitAlert();
    const minimum = mode === "ROUTE" ? 2 : 3;
    if (workingPoints.length < minimum) {
      Alert.alert(
        t("report.map.more.points.needed"),
        t("report.map.add.at.least.p0.points", { p0: minimum })
      );
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
    setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
    setSelectedAreaId(null);
  };

  const changeSelectedRadius = (nextRadius: number) => {
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
      limitAlert();
      return;
    }
    mapRef.current?.animateToRegion({ ...point, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 250);
  };
  const searchAddress = async () => {
    const q = addressQuery.trim();
    if (q.length < 3) return;
    try {
      setSearching(true);
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error(t("report.map.log.in.to.search"));
      const url = API_BASE_URL + "/geo/search?q=" + encodeURIComponent(q) + "&language=" + encodeURIComponent(language);
      const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "ADDRESS_SEARCH_FAILED");
      setAddressResults(json?.results || []);
    } catch (e: any) {
      Alert.alert(t("report.map.address.search.failed"), userErrorMessage(e, t, "errors.generic", "report.map.search"));
    } finally {
      setSearching(false);
    }
  };
  const chooseAddress = (item: any) => {
    const point = { latitude: Number(item.latitude), longitude: Number(item.longitude) };
    placePoint(point);
    setAddressQuery(String(item.label || ""));
    setAddressResults([]);
  };
  const renderAddressSearch = () => (
    <View style={[styles.searchBox, { top: insets.top + 66 }]}>
      <View style={styles.searchRow}>
        <TextInput style={styles.searchInput} value={addressQuery} onChangeText={setAddressQuery} onSubmitEditing={searchAddress} returnKeyType="search" placeholder={t("report.map.search.address.or.place")} />
        <Pressable style={styles.searchButton} onPress={searchAddress}><Text style={styles.searchButtonText}>{searching ? "…" : t("report.map.search")}</Text></Pressable>
      </View>
      {addressResults.length > 0 && <View style={styles.searchResults}>{addressResults.map((item) => <Pressable key={item.id || item.label} onPress={() => chooseAddress(item)} style={styles.searchResult}><Text style={styles.searchResultText} numberOfLines={2}>{item.label}</Text></Pressable>)}</View>}
    </View>
  );
  const centerOnUser = async () => {
    try {
      setLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      placePoint(point);
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
      Alert.alert(
        t("report.map.finish.the.area"),
        t("report.map.add.or.discard.the.points.currently")
      );
      return;
    }
    if (!areas.length) {
      Alert.alert(t("report.map.no.search.area"), t("report.map.add.at.least.one.area"));
      return;
    }
    const primary = areas[0].points[0];
    setField("searchAreas" as any, areas);
    setLocation({ latitude: primary.latitude, longitude: primary.longitude, radiusMeters: areas[0].radiusMeters ?? radius, confirmed: true });
    router.back();
  };

  const confirm = () => isFound ? confirmFound() : confirmLost();

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

  if (isFound) {
    return (
      <View style={styles.safe}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}> 
          <Pressable onPress={() => router.back()} style={styles.headerButton}><Text style={styles.headerButtonText}>‹</Text></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t("report.map.found.location")}</Text>
            <Text style={styles.subtitle}>{t("report.map.place.one.pin.where.the.item")}</Text>
          </View>
        </View>
        {renderAddressSearch()}
        <MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={styles.map} initialRegion={initialRegion} onPress={onMapPress}>
          <Marker coordinate={foundPin} draggable onDragEnd={(event) => setFoundPin(event.nativeEvent.coordinate)} />
        </MapView>
        <View style={[styles.panel, { bottom: insets.bottom + 12 }]}> 
          <Text style={styles.foundHelp}>{t("report.map.tap.the.map.drag.the.pin")}</Text>
          <View style={styles.actions}>
            <Pressable onPress={centerOnUser} style={styles.secondary}><Text style={styles.secondaryText}>{locating ? "…" : t("report.map.my.location")}</Text></Pressable>
            <Pressable onPress={confirm} style={styles.primary}><Text style={styles.primaryText}>{t("report.map.confirm.found.location")}</Text></Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}> 
        <Pressable onPress={() => router.back()} style={styles.headerButton}><Text style={styles.headerButtonText}>‹</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("report.map.search.areas")}</Text>
          <Text style={styles.subtitle}>{t("report.map.p0.of.p1.areas", { p0: areas.length, p1: MAX_SEARCH_AREAS })}</Text>
        </View>
        <Pressable onPress={undo} style={styles.undo}><Text style={styles.undoText}>{t("report.map.undo")}</Text></Pressable>
      </View>
      {renderAddressSearch()}
      <MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={styles.map} initialRegion={initialRegion} onPress={onMapPress}>
        {areas.map(renderArea)}
        {workingPoints.map((point, index) => <Marker key={`working-${index}`} coordinate={point} pinColor="#F59E0B" />)}
        {mode === "ROUTE" && workingPoints.length > 1 && <Polyline coordinates={workingPoints} strokeWidth={6} strokeColor="#F59E0B" />}
        {mode === "POLYGON" && workingPoints.length > 2 && <Polygon coordinates={workingPoints} strokeWidth={2} strokeColor="#F59E0B" fillColor="rgba(245,158,11,0.16)" />}
      </MapView>
      <View style={[styles.panel, { bottom: insets.bottom + 12 }]}> 
        {areas.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.areaList}>
            {areas.map((area, index) => {
              const selected = area.id === selectedAreaId;
              const detail = area.kind === "POLYGON" ? `${area.points.length} ${t("report.map.points")}` : area.kind === "ROUTE" ? `${area.radiusMeters || 500} m ${t("report.map.each.side")}` : `${area.radiusMeters || 500} m`;
              return (
                <Pressable key={area.id} onPress={() => selectArea(area.id)} style={[styles.areaCard, selected && styles.areaCardSelected]}>
                  <Text style={[styles.areaNumber, selected && styles.areaNumberSelected]}>{index + 1}</Text>
                  <View><Text style={[styles.areaTitle, selected && styles.areaTitleSelected]}>{area.kind === "CIRCLE" ? t("report.map.place") : area.kind === "ROUTE" ? t("report.map.route") : t("report.map.area")}</Text><Text style={styles.areaDetail}>{detail}</Text></View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectedArea ? (
          <View style={styles.selectedBar}>
            <View style={{ flex: 1 }}><Text style={styles.selectedTitle}>{t("report.map.selected.area")}</Text><Text style={styles.selectedText}>{t("report.map.adjust.delete.or.continue.with.another")}</Text></View>
            <Pressable onPress={deleteSelected} style={styles.deleteButton}><Text style={styles.deleteText}>{t("report.map.delete")}</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={styles.modes}>
              {(["CIRCLE", "ROUTE", "POLYGON"] as Mode[]).map((item) => (
                <Pressable key={item} disabled={atLimit} onPress={() => { setMode(item); setWorkingPoints([]); }} style={[styles.mode, mode === item && styles.modeActive, atLimit && styles.disabled]}>
                  <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{item === "CIRCLE" ? t("report.map.place.2") : item === "ROUTE" ? t("report.map.route.2") : t("report.map.area.2")}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.help}>{atLimit ? t("report.map.maximum.reached.select.an.area.above") : mode === "CIRCLE" ? t("report.map.tap.a.possible.place") : t("report.map.tap.points.in.order.then.save")}</Text>
          </>
        )}

        {(editableRadius || (!selectedArea && mode !== "POLYGON")) && (
          <>
            <View style={styles.radiusRow}>{RADIUS_OPTIONS.map((m) => <Pressable key={m} onPress={() => changeSelectedRadius(m)} style={[styles.radius, displayedRadius === m && styles.radiusActive]}><Text style={[styles.radiusText, displayedRadius === m && styles.radiusTextActive]}>{formatDistance(m, language, t)}</Text></Pressable>)}</View>
            <Text style={styles.radiusHelp}>{selectedArea?.kind === "ROUTE" ? t("report.map.p0.m.on.each.side.approximately", { p0: displayedRadius, p1: Number(displayedRadius) * 2 }) : selectedArea?.kind === "CIRCLE" ? t("report.map.radius.p0.m", { p0: displayedRadius }) : mode === "ROUTE" ? t("report.map.p0.m.on.each.side.of", { p0: radius }) : t("report.map.radius.for.the.new.place.p0", { p0: radius })}</Text>
          </>
        )}

        {!selectedArea && mode !== "CIRCLE" && <Pressable onPress={addWorkingArea} disabled={atLimit} style={[styles.secondaryFull, atLimit && styles.disabled]}><Text style={styles.secondaryText}>{t("report.map.save.drawn.area")}</Text></Pressable>}

        {selectedArea && !atLimit && <Pressable onPress={startNewArea} style={styles.addAnother}><Text style={styles.addAnotherText}>{t("report.map.save.and.add.another.area")}</Text></Pressable>}

        <View style={styles.actions}>
          <Pressable onPress={centerOnUser} style={styles.secondary}><Text style={styles.secondaryText}>{locating ? "…" : t("report.map.my.location.2")}</Text></Pressable>
          <Pressable onPress={confirm} style={styles.primary}><Text style={styles.primaryText}>{t("report.map.done.with.areas")}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox:{position:"absolute",zIndex:40,left:12,right:12,backgroundColor:"rgba(255,255,255,.98)",borderRadius:14,padding:8,borderWidth:1,borderColor:"#CBD5E1"},
  searchRow:{flexDirection:"row",gap:8},
  searchInput:{flex:1,minHeight:42,borderRadius:10,borderWidth:1,borderColor:"#CBD5E1",paddingHorizontal:12,backgroundColor:"#fff"},
  searchButton:{minWidth:64,minHeight:42,borderRadius:10,backgroundColor:"#2563EB",alignItems:"center",justifyContent:"center",paddingHorizontal:10},
  searchButtonText:{color:"#fff",fontWeight:"900"},
  searchResults:{marginTop:6,borderTopWidth:1,borderTopColor:"#E2E8F0"},
  searchResult:{paddingVertical:10,paddingHorizontal:6,borderBottomWidth:1,borderBottomColor:"#E2E8F0"},
  searchResultText:{color:"#0F172A",fontWeight:"700"},
  safe:{flex:1,backgroundColor:"#fff"},map:{flex:1},header:{position:"absolute",zIndex:20,top:0,left:0,right:0,backgroundColor:"rgba(255,255,255,.96)",paddingHorizontal:12,paddingBottom:9,flexDirection:"row",alignItems:"center",gap:10},headerButton:{width:42,height:42,borderRadius:21,backgroundColor:"#F1F5F9",alignItems:"center",justifyContent:"center"},headerButtonText:{fontSize:28,fontWeight:"900"},title:{fontSize:18,fontWeight:"900",color:"#0F172A"},subtitle:{fontSize:12,fontWeight:"700",color:"#64748B",marginTop:2},undo:{padding:9},undoText:{fontWeight:"900",color:"#2563EB"},panel:{position:"absolute",left:12,right:12,zIndex:30,backgroundColor:"rgba(255,255,255,.97)",borderRadius:20,padding:12,borderWidth:1,borderColor:"#CBD5E1"},areaList:{gap:7,paddingBottom:9},areaCard:{minWidth:112,flexDirection:"row",alignItems:"center",gap:8,padding:8,borderRadius:12,borderWidth:1,borderColor:"#CBD5E1",backgroundColor:"#F8FAFC"},areaCardSelected:{borderColor:"#F59E0B",backgroundColor:"#FFFBEB"},areaNumber:{width:26,height:26,borderRadius:13,textAlign:"center",lineHeight:26,overflow:"hidden",backgroundColor:"#E2E8F0",color:"#334155",fontWeight:"900"},areaNumberSelected:{backgroundColor:"#F59E0B",color:"#fff"},areaTitle:{fontWeight:"900",fontSize:12,color:"#0F172A"},areaTitleSelected:{color:"#92400E"},areaDetail:{fontWeight:"700",fontSize:10,color:"#64748B",marginTop:2},modes:{flexDirection:"row",gap:7},mode:{flex:1,minHeight:38,borderRadius:11,borderWidth:1,borderColor:"#CBD5E1",alignItems:"center",justifyContent:"center"},modeActive:{backgroundColor:"#0F172A",borderColor:"#0F172A"},modeText:{fontWeight:"900",color:"#64748B"},modeTextActive:{color:"#fff"},help:{color:"#64748B",fontWeight:"700",fontSize:12,marginTop:9},radiusRow:{flexDirection:"row",flexWrap:"wrap",gap:6,marginTop:9},radius:{paddingHorizontal:9,paddingVertical:6,borderRadius:999,backgroundColor:"#F1F5F9"},radiusActive:{backgroundColor:"#DBEAFE"},radiusText:{fontWeight:"800",fontSize:11,color:"#475569"},radiusTextActive:{color:"#1D4ED8"},radiusHelp:{color:"#475569",fontWeight:"700",fontSize:11,marginTop:7},actions:{flexDirection:"row",gap:8,marginTop:10},secondary:{flex:1,minHeight:42,borderRadius:12,borderWidth:1,borderColor:"#CBD5E1",alignItems:"center",justifyContent:"center"},secondaryFull:{minHeight:42,borderRadius:12,borderWidth:1,borderColor:"#CBD5E1",alignItems:"center",justifyContent:"center",marginTop:9},secondaryText:{fontWeight:"900",color:"#334155"},primary:{flex:1,minHeight:42,borderRadius:12,backgroundColor:"#2563EB",alignItems:"center",justifyContent:"center"},primaryText:{fontWeight:"900",color:"#fff"},disabled:{opacity:.4},selectedBar:{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:13,backgroundColor:"#FFFBEB",borderWidth:1,borderColor:"#FCD34D"},selectedTitle:{fontWeight:"900",color:"#92400E"},selectedText:{fontWeight:"600",fontSize:12,color:"#92400E",marginTop:2},deleteButton:{minHeight:40,paddingHorizontal:14,borderRadius:11,backgroundColor:"#B91C1C",alignItems:"center",justifyContent:"center"},deleteText:{color:"#fff",fontWeight:"900"},addAnother:{minHeight:42,borderRadius:12,backgroundColor:"#E0F2FE",borderWidth:1,borderColor:"#7DD3FC",alignItems:"center",justifyContent:"center",marginTop:9},addAnotherText:{fontWeight:"900",color:"#075985"},foundHelp:{color:"#475569",fontWeight:"700",fontSize:13,lineHeight:18},
});
