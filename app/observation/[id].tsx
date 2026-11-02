// app/observation/[id].tsx
// T1.9W: one observation ("Noen har sett den" / "Noen har funnet den"). The owner rates it
// (Nyttig | Ikke relevant), both sides can open the chat and propose that the case is resolved.
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { theme } from "../../src/ui/theme";
import { useI18n } from "../../src/i18n/I18nProvider";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { caseTitle } from "../../src/lib/caseDisplay";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { reverseGeocodeToLabel } from "../../src/lib/reverseGeocode";
import { formatDayLabel, formatTime } from "../../src/i18n/formatters";
import { useObservationResolution } from "../../src/lib/observationResolution";
import { ObservationResolution } from "../../src/ui/ObservationResolution";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { Button, ConfirmSheet, InfoButton, ScreenHeader } from "../../src/ui/kit";

type RatedStatus = "RELEVANT" | "DISMISSED";

async function authToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

async function jsonOrThrow(r: Response, fallbackCode: string) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(codedError(String(j?.error || fallbackCode)), { status: r.status });
  return j;
}

function Screen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const observationId = id ? String(id) : undefined;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"chat" | RatedStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const resolution = useObservationResolution(observationId);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await authToken();
      const r = await fetch(`${API_BASE_URL}/observations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await jsonOrThrow(r, "OBSERVATION_LOAD_FAILED"));
    } catch (e) {
      setLoadError(userErrorMessage(e, t, "errors.generic", "observation"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const o = data?.observation;
  const lat = Number(o?.latitude);
  const lng = Number(o?.longitude);
  const hasPoint = o?.latitude != null && o?.longitude != null && Number.isFinite(lat) && Number.isFinite(lng);

  // Place name for the map label; the map works without it.
  useEffect(() => {
    if (!hasPoint) return;
    let cancelled = false;
    void reverseGeocodeToLabel(lat, lng, { language })
      .then((label) => {
        if (!cancelled) setPlaceLabel(label);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasPoint, lat, lng, language]);

  const openChat = async () => {
    setBusy("chat");
    setActionError(null);
    try {
      const token = await authToken();
      const r = await fetch(`${API_BASE_URL}/observation-chat/${id}/open`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      await jsonOrThrow(r, "OBSERVATION_CHAT_OPEN_FAILED");
      router.push(`/observation-chat/${id}`);
    } catch (e) {
      setActionError(userErrorMessage(e, t, "errors.generic", "observation"));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: RatedStatus) => {
    setBusy(status);
    setActionError(null);
    try {
      const token = await authToken();
      const r = await fetch(`${API_BASE_URL}/observations/${id}/status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await jsonOrThrow(r, "OBSERVATION_STATUS_FAILED");
      await load();
    } catch (e) {
      setActionError(userErrorMessage(e, t, "errors.generic", "observation"));
    } finally {
      setBusy(null);
      setDismissOpen(false);
    }
  };

  const isOwner = data?.role === "OWNER";
  const found = o?.observation_type === "FOUND";
  const title = !o
    ? t("observation.detail.observation")
    : isOwner
      ? t(found ? "observation.detail.titleFound" : "observation.detail.titleSeen")
      : t("observation.detail.titleMine");
  const report = o?.reports;
  const subtitle = report ? caseTitle(report, language) : undefined;
  const when = o?.observed_at ? `${formatDayLabel(o.observed_at, language, t)} ${formatTime(o.observed_at, language)}` : "–";
  const resolved = o?.status === "CONFIRMED" || resolution.status === "ACCEPTED";

  const statusText = (status?: string) =>
    status === "NEW"
      ? t("observation.detail.statusNew")
      : status === "RELEVANT"
        ? t("observation.detail.statusRelevant")
        : status === "DISMISSED"
          ? t("observation.detail.statusDismissed")
          : status === "CONFIRMED"
            ? t("observation.detail.statusConfirmed")
            : String(status ?? "");

  const segment = (value: RatedStatus, label: string) => {
    const on = o?.status === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on, disabled: !!busy }}
        disabled={!!busy}
        onPress={() => {
          if (on) return;
          if (value === "DISMISSED") setDismissOpen(true);
          else void setStatus(value);
        }}
        style={({ pressed }) => [s.segment, on && s.segmentOn, pressed && s.pressed]}
      >
        {busy === value ? (
          <ActivityIndicator color={theme.colors.text} />
        ) : (
          <Text style={[s.segmentText, on && (value === "RELEVANT" ? s.segmentTextUseful : s.segmentTextOn)]}>{label}</Text>
        )}
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <ScreenHeader
          title={title}
          subtitle={subtitle}
          onBack={() => router.back()}
          right={<InfoButton title={t("observation.detail.infoTitle")} body={t("observation.detail.infoBody")} />}
        />
        {loading && !data ? (
          <View style={s.center}>
            <ActivityIndicator />
          </View>
        ) : !o ? (
          <View style={s.content}>
            <InlineNotice
              tone="warning"
              title={t("observation.detail.loadError")}
              body={loadError ?? t("observation.detail.unavailable")}
              actionLabel={t("errors.retry")}
              onAction={() => void load()}
              busy={loading}
              style={s.noMargin}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.content}>
            {!!loadError && (
              <InlineNotice
                tone="warning"
                title={t("observation.detail.loadError")}
                body={loadError}
                actionLabel={t("errors.retry")}
                onAction={() => void load()}
                busy={loading}
                style={s.noMargin}
              />
            )}

            {hasPoint && (
              <View style={s.mapBox} pointerEvents="none" accessible accessibilityLabel={placeLabel ?? t("observation.detail.mapLabel")}>
                <MapView
                  style={StyleSheet.absoluteFill}
                  initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  toolbarEnabled={false}
                >
                  <Marker coordinate={{ latitude: lat, longitude: lng }} />
                </MapView>
                {!!placeLabel && (
                  <View style={s.mapPill}>
                    <Text style={s.mapPillText} numberOfLines={1}>
                      {placeLabel}
                    </Text>
                  </View>
                )}
              </View>
            )}

            <View style={s.card}>
              <View style={s.grid}>
                <View style={s.cell}>
                  <Text style={s.cellLabel}>{t("observation.detail.whenLabel")}</Text>
                  <Text style={s.cellValue}>{when}</Text>
                </View>
                {found ? (
                  <View style={s.cell}>
                    <Text style={s.cellLabel}>{t("observation.detail.whereNowLabel")}</Text>
                    <Text style={s.cellValue}>{o.has_item ? t("observation.detail.itemHeld") : t("observation.detail.itemKnown")}</Text>
                  </View>
                ) : (
                  <View style={s.cell}>
                    <Text style={s.cellLabel}>{t("observation.detail.directionLabel")}</Text>
                    <Text style={s.cellValue}>{o.movement_direction || "–"}</Text>
                  </View>
                )}
              </View>
              {!!o.comment && <Text style={s.quote}>{t("observation.detail.quote", { value: o.comment })}</Text>}
              {!isOwner && (
                <Text style={s.statusLine}>{t("observation.detail.status", { value: statusText(o.status) })}</Text>
              )}
            </View>

            {isOwner && !resolved && (
              <View style={s.segmented} accessibilityRole="radiogroup">
                {segment("RELEVANT", t("observation.detail.useful"))}
                {segment("DISMISSED", t("observation.detail.notRelevant"))}
              </View>
            )}

            {!!actionError && <InlineNotice tone="error" title={actionError} style={s.noMargin} />}

            <Button
              label={isOwner && !data?.conversationId ? t("observation.detail.replyInChat") : t("observation.detail.openConversation")}
              onPress={() => void openChat()}
              busy={busy === "chat"}
              disabled={!!busy && busy !== "chat"}
            />
            <ObservationResolution
              controller={resolution}
              proposeLabel={isOwner ? t("observation.resolution.ownerProposeButton") : undefined}
            />
          </ScrollView>
        )}
      </View>

      <ConfirmSheet
        visible={dismissOpen}
        title={t("observation.detail.dismissTitle")}
        body={t("observation.detail.dismissBody")}
        confirmLabel={t("observation.detail.notRelevant")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void setStatus("DISMISSED")}
        onCancel={() => setDismissOpen(false)}
        busy={busy === "DISMISSED"}
      />
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  noMargin: { marginTop: 0 },
  pressed: { opacity: 0.85 },
  mapBox: {
    height: 170,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#DDE7D3",
  },
  mapPill: {
    position: "absolute",
    left: 10,
    bottom: 10,
    maxWidth: "90%",
    backgroundColor: theme.colors.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  mapPillText: { fontSize: 12, fontWeight: "800", color: theme.colors.text },
  card: {
    padding: 16,
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  grid: { flexDirection: "row", gap: 10 },
  cell: { flex: 1, minWidth: 0, gap: 2 },
  cellLabel: { fontSize: 12, fontWeight: "800", color: theme.colors.textSecondary, textTransform: "uppercase" },
  cellValue: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  quote: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: theme.colors.text },
  statusLine: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
  segmented: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, backgroundColor: "#E9EEF5" },
  segment: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: theme.colors.card },
  segmentText: { fontSize: 14, fontWeight: "800", color: theme.colors.textSecondary },
  segmentTextOn: { fontWeight: "900", color: theme.colors.text },
  segmentTextUseful: { fontWeight: "900", color: theme.tone.success.icon },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(Screen);
