// src/ui/PetSightingsCard.tsx
// T1.9AL: "Sist sett" on a lost animal case. A small map with the route from where it went missing
// through the sightings, and a newest-first list. Tapping a sighting opens the observation.
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import { useI18n } from "../i18n/I18nProvider";
import { formatDayLabel, formatTime } from "../i18n/formatters";
import { reverseGeocodeToLabel } from "../lib/reverseGeocode";
import { EMPTY_SIGHTINGS, fetchSightings, shortPlace, sightingPath, sightingRegion, type Sightings } from "../lib/petSightings";

// Place names are looked up for the newest sightings only.
const PLACE_LOOKUPS = 6;
const SIGHTING_COLOR = "#BE123C";
const START_COLOR = "#475569";

type Props = {
  reportId: string;
  petName: string | null;
  // Changes when the case's timeline changes, so a new sighting shows up.
  refreshKey?: string | null;
  onOpenObservation: (id: string) => void;
};

export function PetSightingsCard({ reportId, petName, refreshKey, onOpenObservation }: Props) {
  const { language, t } = useI18n();
  const [data, setData] = useState<Sightings>(EMPTY_SIGHTINGS);
  const [ready, setReady] = useState(false);
  const [places, setPlaces] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    fetchSightings(reportId)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [reportId, refreshKey]);

  useEffect(() => {
    let alive = true;
    for (const s of data.sightings.slice(0, PLACE_LOOKUPS)) {
      if (places[s.id]) continue;
      void reverseGeocodeToLabel(s.latitude, s.longitude, { language })
        .then((label) => {
          const place = shortPlace(label);
          if (alive && place) setPlaces((prev) => ({ ...prev, [s.id]: place }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // places is left out on purpose: each lookup runs once per sighting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, language]);

  const path = useMemo(() => sightingPath(data), [data]);
  const region = useMemo(() => sightingRegion(path), [path]);
  if (!ready || !data.start) return null;

  const when = (iso: string | null) => (iso ? `${formatDayLabel(iso, language, t)} ${formatTime(iso, language)}` : "");
  const name = petName?.trim() || null;

  return (
    <View style={s.card}>
      <Text style={s.h2}>{t("caseDetail.sightings.title")}</Text>
      {region && (
        <MapView style={s.map} initialRegion={region} scrollEnabled={false} zoomEnabled={false} pitchEnabled={false} rotateEnabled={false}>
          {path.length > 1 && <Polyline coordinates={path} strokeColor={SIGHTING_COLOR} strokeWidth={3} lineDashPattern={[6, 6]} />}
          <Marker coordinate={{ latitude: data.start.latitude, longitude: data.start.longitude }} pinColor={START_COLOR} />
          {data.sightings.map((x, i) => (
            <Marker key={x.id} coordinate={{ latitude: x.latitude, longitude: x.longitude }} pinColor={SIGHTING_COLOR} opacity={i === 0 ? 1 : 0.7} />
          ))}
        </MapView>
      )}

      {data.sightings.length === 0 && (
        <Text style={s.muted}>{name ? t("caseDetail.sightings.emptyNamed", { name }) : t("caseDetail.sightings.empty")}</Text>
      )}

      <View>
        {data.sightings.map((x) => {
          const place = places[x.id];
          const detail = [x.direction ? t("caseDetail.sightings.direction", { direction: x.direction }) : null, x.comment].filter(Boolean).join(" · ");
          return (
            <Pressable key={x.id} accessibilityRole="button" onPress={() => onOpenObservation(x.id)} style={[s.row, s.rowBorder]}>
              <View style={[s.dot, { backgroundColor: SIGHTING_COLOR }]} />
              <View style={s.text}>
                <Text style={s.title} numberOfLines={1}>
                  {[when(x.at), place].filter(Boolean).join(" · ")}
                </Text>
                <Text style={s.sub} numberOfLines={2}>
                  {detail || (x.kind === "FOUND" ? t("caseDetail.sightings.found") : t("caseDetail.sightings.seen"))}
                </Text>
              </View>
              {x.isNew && <Text style={s.newBadge}>{t("caseDetail.sightings.new")}</Text>}
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          );
        })}
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: START_COLOR }]} />
          <View style={s.text}>
            <Text style={s.title} numberOfLines={1}>
              {[when(data.start.at), shortPlace(data.start.label)].filter(Boolean).join(" · ")}
            </Text>
            <Text style={s.sub}>{t("caseDetail.sightings.start")}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    gap: 10,
  },
  h2: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  map: { height: 170, borderRadius: 14, overflow: "hidden" },
  muted: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, minHeight: 44 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  dot: { width: 10, height: 10, borderRadius: 999 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  sub: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  newBadge: {
    fontSize: 12,
    fontWeight: "900",
    color: theme.tone.info.fg,
    backgroundColor: theme.tone.info.bg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },
});
