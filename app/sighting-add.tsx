// app/sighting-add.tsx
// T1.9AN: the owner puts a tip on the map – something they heard by phone, on social media or saw
// themselves. Where (tap the map), when, and a short note. It shows in «Sist sett» on the case.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet, Button, ScreenHeader } from "../src/ui/kit";
import { InlineNotice } from "../src/ui/InlineNotice";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { formatDate, formatTime } from "../src/i18n/formatters";
import { addOwnerTip, tipTimeIsValid } from "../src/lib/petSightings";
import { knownErrorKey } from "../src/lib/userError";

const NOTE_MAX = 300;

function SightingAddScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const params = useLocalSearchParams<{ reportId?: string; title?: string; lat?: string; lng?: string }>();
  const reportId = String(params.reportId || "");
  const startLat = Number(params.lat);
  const startLng = Number(params.lng);
  const hasStart = Number.isFinite(startLat) && Number.isFinite(startLng) && (startLat !== 0 || startLng !== 0);

  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [seenAt, setSeenAt] = useState(() => new Date());
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const timeOk = tipTimeIsValid(seenAt);
  const canSave = !!point && timeOk && !saving;

  const save = async () => {
    if (!point || !canSave) return;
    setSaving(true);
    setErrorCode(null);
    try {
      await addOwnerTip(reportId, { ...point, seenAt: seenAt.toISOString(), note: note.trim() || null });
      router.back();
    } catch (e: any) {
      setErrorCode(String(e?.code || e?.message || "UNKNOWN"));
    } finally {
      setSaving(false);
    }
  };

  const setDate = (d: Date) => {
    // Keep the time when the day changes, and the day when the time changes.
    const next = new Date(seenAt);
    if (picker === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    setSeenAt(next);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.safe}>
        <ScreenHeader title={t("sightingAdd.title")} subtitle={String(params.title || "")} onBack={() => router.back()} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <Text style={s.lead}>{t("sightingAdd.lead")}</Text>

            <Text style={s.label}>{t("sightingAdd.where")}</Text>
            <View style={s.mapFrame}>
              <MapView
                provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
                style={s.map}
                initialRegion={
                  hasStart
                    ? { latitude: startLat, longitude: startLng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
                    : { latitude: 59.91, longitude: 10.75, latitudeDelta: 0.2, longitudeDelta: 0.2 }
                }
                onPress={(e) => setPoint(e.nativeEvent.coordinate)}
              >
                {hasStart && <Marker coordinate={{ latitude: startLat, longitude: startLng }} pinColor="#475569" />}
                {point && <Marker coordinate={point} pinColor="#B45309" draggable onDragEnd={(e) => setPoint(e.nativeEvent.coordinate)} />}
              </MapView>
            </View>
            <Text style={s.help}>{point ? t("sightingAdd.whereSet") : t("sightingAdd.whereHelp")}</Text>

            <Text style={s.label}>{t("sightingAdd.when")}</Text>
            <View style={s.whenRow}>
              <Pressable accessibilityRole="button" style={s.whenButton} onPress={() => setPicker("date")}>
                <Ionicons name="calendar-outline" size={18} color={theme.colors.text} />
                <Text style={s.whenText}>{formatDate(seenAt, language)}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={s.whenButton} onPress={() => setPicker("time")}>
                <Ionicons name="time-outline" size={18} color={theme.colors.text} />
                <Text style={s.whenText}>{formatTime(seenAt, language)}</Text>
              </Pressable>
            </View>
            {!timeOk && <Text style={s.error}>{t("sightingAdd.whenInvalid")}</Text>}

            <Text style={s.label}>{t("sightingAdd.note")}</Text>
            <TextInput
              style={s.input}
              value={note}
              onChangeText={setNote}
              maxLength={NOTE_MAX}
              multiline
              placeholder={t("sightingAdd.notePlaceholder")}
              placeholderTextColor={theme.colors.muted}
              accessibilityLabel={t("sightingAdd.note")}
            />
            <Text style={s.help}>{t("sightingAdd.private")}</Text>

            {!!errorCode && (
              <InlineNotice
                tone="warning"
                icon="alert-circle-outline"
                title={t("sightingAdd.errorTitle")}
                body={t(knownErrorKey(errorCode) ?? "sightingAdd.errorBody")}
              />
            )}
            <Button label={t("sightingAdd.save")} onPress={() => void save()} busy={saving} disabled={!canSave} />
          </ScrollView>
        </KeyboardAvoidingView>

        {picker && Platform.OS === "android" && (
          <DateTimePicker
            value={seenAt}
            mode={picker}
            maximumDate={picker === "date" ? new Date() : undefined}
            onChange={(event: any, d?: Date) => {
              setPicker(null);
              if (event?.type === "set" && d) setDate(d);
            }}
          />
        )}
        <BottomSheet visible={!!picker && Platform.OS === "ios"} onClose={() => setPicker(null)} accessibilityLabel={t("common.close")}>
          {picker && Platform.OS === "ios" && (
            // Same as registration (T1.9X): a fresh native picker per mode with a fixed spinner height.
            <DateTimePicker
              key={picker}
              value={seenAt}
              mode={picker}
              display={picker === "date" ? "inline" : "spinner"}
              maximumDate={picker === "date" ? new Date() : undefined}
              style={picker === "time" ? s.timeSpinner : undefined}
              themeVariant="light"
              onChange={(_event: any, d?: Date) => d && setDate(d)}
            />
          )}
          <Button label={t("common.close")} variant="neutral" onPress={() => setPicker(null)} />
        </BottomSheet>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  lead: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.textSecondary },
  label: { fontSize: 15, fontWeight: "900", color: theme.colors.text, marginTop: 8 },
  mapFrame: { height: 240, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border },
  map: { flex: 1 },
  help: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  whenRow: { flexDirection: "row", gap: 10 },
  whenButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  whenText: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  error: { fontSize: 13, fontWeight: "700", color: theme.tone.error.fg },
  input: {
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
    fontSize: 15,
    color: theme.colors.text,
    textAlignVertical: "top",
  },
  timeSpinner: { height: 216, alignSelf: "stretch" },
});

// T1.9A: registered accounts only.
export default requireAccount(SightingAddScreen);
