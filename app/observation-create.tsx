// app/observation-create.tsx
// T1.9W: "Jeg har sett den" / "Jeg har funnet den" after an area alert. The user places a pin
// (tap, drag or "Bruk min posisjon"), adds a comment and sends it to the owner.
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { userErrorMessage } from "../src/lib/userError";
import { theme } from "../src/ui/theme";
import { useI18n } from "../src/i18n/I18nProvider";
import { API_BASE_URL } from "../src/lib/config";
import { supabase } from "../src/lib/supabase";
import { InlineNotice } from "../src/ui/InlineNotice";
import { Button, InfoButton, ScreenHeader } from "../src/ui/kit";

type Kind = "SEEN" | "FOUND";
type Point = { latitude: number; longitude: number };
type LocationProblem = "denied" | "failed" | null;
type FieldError = "location" | "hasItem" | null;

// Used only when neither the alert nor the device gives a starting point.
const FALLBACK_POINT: Point = { latitude: 59.9139, longitude: 10.7522 };
const FALLBACK_DELTA = 0.2;
const CLOSE_DELTA = 0.015;

function paramPoint(lat?: string, lng?: string): Point | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!lat || !lng || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function Screen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const { t } = useI18n();
  const params = useLocalSearchParams<{ campaignId?: string; kind?: Kind; latitude?: string; longitude?: string }>();
  const campaignId = String(params.campaignId || "");
  const kind: Kind = params.kind === "FOUND" ? "FOUND" : "SEEN";
  // The alert's position when the caller passes it; otherwise the device's last known position.
  const alertPoint = useMemo(() => paramPoint(params.latitude, params.longitude), [params.latitude, params.longitude]);

  const [point, setPoint] = useState<Point>(alertPoint ?? FALLBACK_POINT);
  const [ready, setReady] = useState(false);
  const pickedRef = useRef(false);
  const [comment, setComment] = useState("");
  const [direction, setDirection] = useState("");
  const [hasItem, setHasItem] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<LocationProblem>(null);
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const clientRequestId = useMemo(() => `obs_${Date.now()}_${Math.random().toString(36).slice(2)}`, []);

  const moveTo = (next: Point, delta = CLOSE_DELTA) => {
    mapRef.current?.animateToRegion({ ...next, latitudeDelta: delta, longitudeDelta: delta }, 250);
  };

  // Start near the user without asking for permission: only if it was granted before.
  useEffect(() => {
    if (alertPoint) return;
    let cancelled = false;
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled || !last) return;
        const next = { latitude: last.coords.latitude, longitude: last.coords.longitude };
        // Do not move the pin if the user has already placed it.
        if (pickedRef.current) return;
        setPoint(next);
        moveTo(next, 0.04);
      } catch {
        // Keep the fallback start; the user places the pin anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [alertPoint]);

  const pick = (next: Point) => {
    pickedRef.current = true;
    setPoint(next);
    setReady(true);
    if (fieldError === "location") setFieldError(null);
  };

  const locateMe = async () => {
    setLocating(true);
    setLocationProblem(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocationProblem("denied");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      pick(next);
      moveTo(next);
    } catch {
      setLocationProblem("failed");
    } finally {
      setLocating(false);
    }
  };

  const submit = useCallback(async () => {
    setSubmitError(null);
    if (!campaignId) {
      setSubmitError(t("observation.create.missing.alert.reference"));
      return;
    }
    if (!ready) {
      setFieldError("location");
      return;
    }
    if (kind === "FOUND" && hasItem === null) {
      setFieldError("hasItem");
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setSubmitError(t("observation.create.you.must.be.logged.in"));
        return;
      }
      const r = await fetch(`${API_BASE_URL}/observations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          observationType: kind,
          latitude: point.latitude,
          longitude: point.longitude,
          observedAt: new Date().toISOString(),
          comment,
          movementDirection: direction,
          hasItem,
          clientRequestId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP_${r.status}`), { code: j?.error, status: r.status });
      router.replace(`/observation/${j.observation.id}`);
    } catch (e) {
      setSubmitError(userErrorMessage(e, t, "errors.generic", "observation.create"));
    } finally {
      setBusy(false);
    }
  }, [campaignId, kind, point, ready, comment, direction, hasItem, clientRequestId, router, t]);

  const choice = (value: boolean, label: string) => {
    const on = hasItem === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={[s.option, on && s.optionOn]}
        onPress={() => {
          setHasItem(value);
          if (fieldError === "hasItem") setFieldError(null);
        }}
      >
        <View style={[s.radio, on && s.radioOn]} />
        <Text style={s.optionTitle}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <ScreenHeader
          title={kind === "FOUND" ? t("observation.create.titleFound") : t("observation.create.titleSeen")}
          onBack={() => router.back()}
          right={<InfoButton title={t("observation.create.infoTitle")} body={t("observation.create.infoBody")} />}
        />
        <KeyboardAvoidingView style={s.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <Text style={s.lead}>
              {kind === "FOUND"
                ? t("observation.create.register.where.the.item.or.animal.is.now")
                : t("observation.create.register.where.and.when.it.was.observed")}
            </Text>

            <View style={[s.card, fieldError === "location" && s.cardMissing]}>
              <View style={s.mapBox}>
                <MapView
                  ref={mapRef}
                  style={StyleSheet.absoluteFill}
                  initialRegion={{ ...point, latitudeDelta: alertPoint ? 0.04 : FALLBACK_DELTA, longitudeDelta: alertPoint ? 0.04 : FALLBACK_DELTA }}
                  onPress={(e) => pick(e.nativeEvent.coordinate)}
                >
                  <Marker coordinate={point} draggable onDragEnd={(e) => pick(e.nativeEvent.coordinate)} />
                </MapView>
              </View>
              <Text style={fieldError === "location" ? s.fieldError : s.hint}>
                {t("observation.create.place.the.pin.or.use.your.location")}
              </Text>
              <Button
                label={t("observation.create.use.my.location")}
                variant="neutral"
                busy={locating}
                onPress={() => void locateMe()}
              />
              {locationProblem === "denied" && (
                <InlineNotice
                  tone="warning"
                  icon="location-outline"
                  title={t("observation.create.locationDeniedTitle")}
                  body={t("observation.create.locationDeniedBody")}
                  style={s.noMargin}
                />
              )}
              {locationProblem === "failed" && (
                <InlineNotice
                  tone="warning"
                  icon="location-outline"
                  title={t("observation.create.locationFailedTitle")}
                  body={t("observation.create.locationFailedBody")}
                  actionLabel={t("errors.retry")}
                  onAction={() => void locateMe()}
                  busy={locating}
                  style={s.noMargin}
                />
              )}
            </View>

            <View style={s.card}>
              <Text style={s.label}>{t("observation.create.comment")}</Text>
              <TextInput
                value={comment}
                onChangeText={setComment}
                multiline
                maxLength={1000}
                placeholder={t("observation.create.what.did.you.observe")}
                placeholderTextColor={theme.colors.textSecondary}
                accessibilityLabel={t("observation.create.comment")}
                style={[s.input, s.multi]}
              />
              {kind === "SEEN" && (
                <>
                  <Text style={s.label}>{t("observation.create.direction.optional")}</Text>
                  <TextInput
                    value={direction}
                    onChangeText={setDirection}
                    maxLength={120}
                    accessibilityLabel={t("observation.create.direction.optional")}
                    style={s.input}
                  />
                </>
              )}
            </View>

            {kind === "FOUND" && (
              <View style={[s.card, fieldError === "hasItem" && s.cardMissing]} accessibilityRole="radiogroup">
                <Text style={s.label}>{t("observation.create.where.is.it.now")}</Text>
                {choice(true, t("observation.create.it.is.with.me"))}
                {choice(false, t("observation.create.i.know.where.it.is.but.it.is.not.with.me"))}
                {fieldError === "hasItem" && (
                  <Text style={s.fieldError}>{t("observation.create.state.whether.the.item.or.animal.is.with.you")}</Text>
                )}
              </View>
            )}

            {!!submitError && (
              <InlineNotice tone="error" title={t("observation.create.could.not.send")} body={submitError} style={s.noMargin} />
            )}
            <Button label={t("observation.create.send")} onPress={() => void submit()} busy={busy} />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex1: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  noMargin: { marginTop: 0 },
  lead: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.textSecondary },
  card: {
    padding: 16,
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  cardMissing: { borderColor: theme.tone.warning.border, backgroundColor: theme.tone.warning.bg },
  mapBox: { height: 260, borderRadius: 14, overflow: "hidden", backgroundColor: "#E0E7EF" },
  hint: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  fieldError: { fontSize: 13, fontWeight: "700", color: theme.tone.warning.fg },
  label: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 48,
    backgroundColor: theme.colors.inputBg,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  multi: { minHeight: 100, paddingTop: 12, textAlignVertical: "top" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  optionOn: { borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.bg },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: "#94A3B8" },
  radioOn: { borderWidth: 7, borderColor: theme.colors.primary },
  optionTitle: { flex: 1, fontSize: 15, fontWeight: "900", color: theme.colors.text },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(Screen);
