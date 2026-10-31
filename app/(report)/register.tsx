// app/(report)/register.tsx
// T1.9K: the new one-page registration, tried next to the current one (Profil → "Prøv ny
// registrering"). Four numbered cards on one scrolling page: 1 Hva, 2 Detaljer, 3 Når og hvor
// (with the current map screen), 4 Finnerlønn (lost) or Hvor er gjenstanden nå (found).
// Uses the same draft as the current screen, so the map screen works unchanged.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Circle, Marker } from "react-native-maps";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useReportDraft } from "../../src/contexts/ReportDraftContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { colorName, itemName, categoryName, COLOR_CATALOG } from "../../src/i18n/catalog";
import { formatDate, formatDateTimeCustom, formatMoney, formatTime } from "../../src/i18n/formatters";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { captureOneImage, pickOneImage, uploadReportImage } from "../../src/lib/images";
import { ensureFoundIdentity, ensureLostAuthenticated, isAnonymousUser } from "../../src/lib/authGate";
import { ensureProfileRow } from "../../src/lib/profile";
import { reverseGeocodeToLabel } from "../../src/lib/reverseGeocode";
import { reportHandledError } from "../../src/lib/sentry";
import { userErrorMessage } from "../../src/lib/userError";
import {
  cleanRewardInput,
  isLongAgo,
  missingFields,
  needsCustomPet,
  newClientRequestId,
  occurredAtFor,
  reportBody,
  searchItems,
  type Custody,
  type OccurredPrecision,
} from "../../src/lib/registerForm";
import { COLOR_SWATCHES, COMMON_COLOR_KEYS, nextColors } from "../../src/ui/colorSwatches";
import { theme } from "../../src/ui/theme";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { BottomSheet, Button, ConfirmSheet, ScreenHeader } from "../../src/ui/kit";
import type { TranslationKey } from "../../src/i18n/locales/en";

const MAX_IMAGES = 3;
const REWARD_PRESETS = [0, 200, 500];
// The reward is only offered where the app knows the currency rules (same as today).
const rewardEnabledForLocale = () => {
  const locale = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().locale : "";
  return String(locale).split("-").pop()?.toUpperCase() === "NO";
};

type Section = "what" | "details" | "when" | "extra";
const SECTION_OF: Partial<Record<TranslationKey, Section>> = {
  "register.missing.item": "what",
  "register.missing.pet": "what",
  "register.missing.color": "details",
  "register.missing.time": "when",
  "register.missing.place": "when",
  "register.missing.handedIn": "extra",
  "register.missing.reward": "extra",
};

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; longAgo?: string }>();
  const { language, t } = useI18n();
  const { draft, setField, reset, flush, loading: draftLoading } = useReportDraft();
  const rewardEnabled = useMemo(rewardEnabledForLocale, []);

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<Section, number>>({ what: 0, details: 0, when: 0, extra: 0 });
  const requestIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  const [query, setQuery] = useState("");
  const [allColors, setAllColors] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [rewardOther, setRewardOther] = useState(false);
  const [missing, setMissing] = useState<TranslationKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitSheet, setLimitSheet] = useState(false);
  const [imageRetry, setImageRetry] = useState<{ reportId: string; uris: string[] } | null>(null);

  const type: "LOST" | "FOUND" = draft.type === "FOUND" ? "FOUND" : "LOST";
  const precision: OccurredPrecision = draft.occurredPrecision || "EXACT";
  const occurred = draft.occurredAtISO ? new Date(draft.occurredAtISO) : null;

  // The start screen says which kind of report this is; "Mistet for lenge siden?" starts with a year.
  useEffect(() => {
    if (draftLoading) return;
    if (params.type === "LOST" || params.type === "FOUND") setField("type", params.type);
    if (params.longAgo === "1") setField("occurredPrecision", "YEAR");
    if (!draft.occurredAtISO) setField("occurredAtISO", new Date().toISOString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoading, params.type, params.longAgo]);

  // Place name from the chosen point (editable), as in the current registration.
  const lat = draft.location?.latitude;
  const lng = draft.location?.longitude;
  const confirmed = !!draft.location?.confirmed;
  const geoReq = useRef(0);
  useEffect(() => {
    if (!confirmed || lat == null || lng == null) return;
    const id = ++geoReq.current;
    reverseGeocodeToLabel(lat, lng, { language })
      .then((label) => {
        if (label && id === geoReq.current) setField("locationLabel", label);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, confirmed]);

  const hits = useMemo(() => searchItems(query, language), [query, language]);
  const swatchKeys = allColors ? COLOR_CATALOG.map((c) => c.key) : COMMON_COLOR_KEYS;
  const longAgo = type === "LOST" && isLongAgo(draft.occurredAtISO);
  const areaCount = (draft.searchAreas || []).length;

  const chooseImage = async (camera: boolean) => {
    const uri = camera ? await captureOneImage() : await pickOneImage();
    if (uri) setImages((prev) => [...prev, uri].slice(0, MAX_IMAGES));
  };

  const setDate = (d: Date, nextPrecision: OccurredPrecision = precision) => {
    setField("occurredPrecision", nextPrecision);
    setField("occurredAtISO", occurredAtFor(d, nextPrecision));
  };
  const quickDay = (daysBack: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    setDate(d, "EXACT");
  };
  const dateLabel = !occurred
    ? t("register.when.pickDate")
    : precision === "YEAR"
      ? String(occurred.getFullYear())
      : precision === "MONTH"
        ? formatDateTimeCustom(occurred, language, { month: "long", year: "numeric" })
        : formatDate(occurred, language);

  const goToMissing = (list: TranslationKey[]) => {
    const first = list.map((k) => SECTION_OF[k]).find(Boolean) as Section | undefined;
    if (first) scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[first] - 12), animated: true });
  };

  const uploadImages = async (reportId: string, uris: string[]) => {
    const results = await Promise.allSettled(uris.map((uri, i) => uploadReportImage(reportId, uri, i)));
    return uris.filter((_, i) => results[i].status === "rejected");
  };

  const finish = async (reportId: string) => {
    const title = draft.subcategoryKey ? itemName(draft.subcategoryKey, language, draft.category) : "";
    await reset();
    requestIdRef.current = null;
    const { data } = await supabase.auth.getSession();
    if (isAnonymousUser(data.session?.user as any)) {
      router.replace({ pathname: "/found-receipt", params: { title, images: String(images.length) } });
      return;
    }
    router.replace({ pathname: "/report-details/[id]", params: { id: reportId } });
  };

  const submit = async (testOverrideWeeklyLimit = false) => {
    const list = missingFields(draft, rewardEnabled);
    setMissing(list);
    if (list.length) {
      goToMissing(list);
      return;
    }
    if (submittingRef.current) return;
    setError(null);

    // Identity: a found report can be sent as a guest; a lost report needs an account.
    try {
      const session = type === "FOUND" ? await ensureFoundIdentity() : await ensureLostAuthenticated();
      const uid = session?.user?.id;
      if (uid) await ensureProfileRow(uid).catch(() => {});
    } catch (e: any) {
      const code = e?.code || e?.message;
      if (type === "LOST" && (code === "LOGIN_REQUIRED" || code === "UPGRADE_REQUIRED")) {
        await flush();
        router.push({
          pathname: "/(auth)/login",
          params: { returnTo: "/(report)/register", intent: "lost", upgrade: code === "UPGRADE_REQUIRED" ? "1" : undefined },
        });
        return;
      }
      setError(userErrorMessage(e, t, "report.create.could.not.save.the.case.please", "register.identity"));
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    try {
      if (!requestIdRef.current) requestIdRef.current = newClientRequestId();
      const body = reportBody(draft, { language, rewardEnabled, clientRequestId: requestIdRef.current, testOverrideWeeklyLimit });
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/reports`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e: any) {
        throw Object.assign(new Error(e?.name === "AbortError" ? "NETWORK_TIMEOUT" : "NETWORK_ERROR"), {
          code: e?.name === "AbortError" ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = String(data?.error || `HTTP_${response.status}`);
        throw Object.assign(new Error(code), { code, status: response.status, testOverrideAllowed: data?.test_override_allowed === true });
      }
      const reportId = String(data?.report?.id || "");
      const failed = images.length ? await uploadImages(reportId, images) : [];
      if (failed.length) {
        setImageRetry({ reportId, uris: failed });
        return;
      }
      await finish(reportId);
    } catch (e: any) {
      const code = String(e?.code || "").toUpperCase();
      if (code === "LOST_REPORT_WEEKLY_LIMIT" && e?.testOverrideAllowed && !testOverrideWeeklyLimit) {
        setLimitSheet(true);
        return;
      }
      if (code === "ACCOUNT_REQUIRED_FOR_LOST") {
        await flush();
        router.push({ pathname: "/(auth)/login", params: { returnTo: "/(report)/register", intent: "lost" } });
        return;
      }
      if (!(Number(e?.status) >= 400 && Number(e?.status) < 500)) reportHandledError(e, "register.create", code || undefined);
      setError(
        code === "LOST_REPORT_WEEKLY_LIMIT"
          ? t("report.create.you.can.create.up.to.two")
          : userErrorMessage(e, t, "report.create.could.not.save.the.case.please", null),
      );
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  const retryImages = async () => {
    if (!imageRetry) return;
    setSaving(true);
    try {
      const failed = await uploadImages(imageRetry.reportId, imageRetry.uris);
      if (failed.length) setImageRetry({ ...imageRetry, uris: failed });
      else await finish(imageRetry.reportId);
    } finally {
      setSaving(false);
    }
  };

  const numberBadge = (n: number) => (
    <View style={s.badge}>
      <Text style={s.badgeText}>{n}</Text>
    </View>
  );
  const isMissing = (section: Section) => missing.some((k) => SECTION_OF[k] === section);

  if (draftLoading)
    return (
      <View style={[s.safe, s.center]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );

  const selectedItem = draft.subcategoryKey
    ? draft.subcategoryKey === "CUSTOM"
      ? t("register.what.customPet")
      : itemName(draft.subcategoryKey, language, draft.category)
    : "";
  const colorsText =
    draft.color && draft.colorSecondary
      ? t("catalog.colorPair", { first: colorName(draft.color, language), second: colorName(draft.colorSecondary, language).toLocaleLowerCase() })
      : draft.color
        ? colorName(draft.color, language)
        : t("register.details.noColor");
  const reward = Number(draft.rewardNOK || "0");

  return (
    <View style={s.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        raised
        title={type === "FOUND" ? t("register.title.found") : t("register.title.lost")}
        subtitle={t("register.draftSaved")}
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.select({ ios: "padding", android: undefined })}>
        <ScrollView ref={scrollRef} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {/* 1 Hva */}
          <View style={[s.card, isMissing("what") && s.cardMissing]} onLayout={(e) => (sectionY.current.what = e.nativeEvent.layout.y)}>
            <View style={s.cardHeader}>
              {numberBadge(1)}
              <Text style={s.h2}>{type === "FOUND" ? t("register.what.titleFound") : t("register.what.titleLost")}</Text>
            </View>
            <View style={s.photos}>
              {images.map((uri) => (
                <View key={uri}>
                  <Image source={{ uri }} style={s.photo} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("register.what.removePhoto")}
                    style={s.photoRemove}
                    onPress={() => setImages((prev) => prev.filter((x) => x !== uri))}
                  >
                    <Ionicons name="close" size={16} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {images.length < MAX_IMAGES && (
                <>
                  <Pressable accessibilityRole="button" style={s.photoAdd} onPress={() => void chooseImage(true)}>
                    <Ionicons name="camera-outline" size={22} color={theme.colors.text} />
                    <Text style={s.photoAddText}>{t("register.what.camera")}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={s.photoAdd} onPress={() => void chooseImage(false)}>
                    <Ionicons name="images-outline" size={22} color={theme.colors.text} />
                    <Text style={s.photoAddText}>{t("register.what.album")}</Text>
                  </Pressable>
                </>
              )}
            </View>

            {draft.subcategoryKey ? (
              <View style={s.selected}>
                <View style={s.flex}>
                  <Text style={s.selectedName}>{selectedItem}</Text>
                  <Text style={s.muted}>{categoryName(draft.category, language)}</Text>
                </View>
                <Pressable accessibilityRole="button" style={s.linkButton} onPress={() => setField("subcategoryKey", "")}>
                  <Text style={s.link}>{t("register.change")}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.field}>
                <Text style={s.label}>
                  {t("register.what.searchLabel")}
                </Text>
                <TextInput
                  accessibilityLabel={t("register.what.searchLabel")}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t("register.what.searchPlaceholder")}
                  placeholderTextColor="#64748B"
                  style={s.input}
                />
                {hits.length > 0 && (
                  <View style={s.hits}>
                    {hits.map((hit, i) => (
                      <Pressable
                        key={`${hit.category}:${hit.key}`}
                        accessibilityRole="button"
                        style={[s.hit, i < hits.length - 1 && s.hitBorder]}
                        onPress={() => {
                          setField("category", hit.category);
                          setField("subcategoryKey", hit.key);
                          setQuery("");
                        }}
                      >
                        <Text style={s.hitName}>{hit.name}</Text>
                        <Text style={s.mutedSmall}>{hit.categoryName}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {query.trim().length >= 2 && hits.length === 0 && (
                  <Pressable
                    accessibilityRole="button"
                    style={s.linkButton}
                    onPress={() => {
                      setField("category", "PETS");
                      setField("subcategoryKey", "CUSTOM");
                      setField("subcategoryCustom", query.trim());
                      setQuery("");
                    }}
                  >
                    <Text style={s.link}>{t("register.what.otherPet", { name: query.trim() })}</Text>
                  </Pressable>
                )}
              </View>
            )}
            {needsCustomPet(draft.category, draft.subcategoryKey) && (
              <View style={s.field}>
                <Text style={s.label}>
                  {t("register.what.petLabel")}
                </Text>
                <TextInput
                  accessibilityLabel={t("register.what.petLabel")}
                  value={draft.subcategoryCustom || ""}
                  onChangeText={(v) => setField("subcategoryCustom", v)}
                  style={s.input}
                />
              </View>
            )}
          </View>

          {/* 2 Detaljer */}
          <View style={[s.card, isMissing("details") && s.cardMissing]} onLayout={(e) => (sectionY.current.details = e.nativeEvent.layout.y)}>
            <View style={s.cardHeader}>
              {numberBadge(2)}
              <Text style={s.h2}>{t("register.details.title")}</Text>
            </View>
            <View style={s.rowBetween}>
              <Text style={s.label}>{t("register.details.color")}</Text>
              <Text style={s.muted}>{colorsText}</Text>
            </View>
            <View style={s.swatches}>
              {swatchKeys.map((key) => {
                const sw = COLOR_SWATCHES[key];
                const order = key === draft.color ? 1 : key === draft.colorSecondary ? 2 : 0;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: order > 0 }}
                    accessibilityLabel={
                      order === 1
                        ? t("register.details.mainColor", { color: colorName(key, language) })
                        : order === 2
                          ? t("register.details.secondColor", { color: colorName(key, language) })
                          : colorName(key, language)
                    }
                    onPress={() => {
                      const next = nextColors(draft.color || "", draft.colorSecondary || "", key);
                      setField("color", next.color);
                      setField("colorSecondary", next.colorSecondary);
                    }}
                    style={[s.swatch, { backgroundColor: sw?.fill || "#F1F5F9" }, order > 0 && s.swatchOn]}
                  >
                    {order > 0 ? (
                      <Text style={[s.swatchText, { color: sw?.dark ? "#FFFFFF" : theme.colors.text }]}>{order}</Text>
                    ) : sw?.icon ? (
                      <Ionicons name={sw.icon} size={18} color={theme.colors.textSecondary} />
                    ) : null}
                  </Pressable>
                );
              })}
              {!allColors && (
                <Pressable accessibilityRole="button" style={[s.swatch, s.swatchMore]} onPress={() => setAllColors(true)}>
                  <Text style={s.swatchMoreText}>{t("register.details.moreColors")}</Text>
                </Pressable>
              )}
            </View>
            <Text style={s.mutedSmall}>{t("register.details.colorHelp")}</Text>
            <View style={s.field}>
              <Text style={s.label}>
                {t("register.details.brand")}
              </Text>
              <TextInput
                accessibilityLabel={t("register.details.brand")}
                value={draft.brand || ""}
                onChangeText={(v) => setField("brand", v)}
                style={s.input}
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>
                {t("register.details.description")}
              </Text>
              <TextInput
                accessibilityLabel={t("register.details.description")}
                value={draft.description || ""}
                onChangeText={(v) => setField("description", v)}
                style={[s.input, s.textarea]}
                multiline
                textAlignVertical="top"
              />
              <Text style={s.mutedSmall}>{type === "LOST" ? t("register.details.descriptionHelpLost") : t("register.details.descriptionHelpFound")}</Text>
            </View>
          </View>

          {/* 3 Når og hvor */}
          <View style={[s.card, isMissing("when") && s.cardMissing]} onLayout={(e) => (sectionY.current.when = e.nativeEvent.layout.y)}>
            <View style={s.cardHeader}>
              {numberBadge(3)}
              <Text style={s.h2}>{type === "FOUND" ? t("register.when.titleFound") : t("register.when.titleLost")}</Text>
            </View>
            {type === "LOST" && (
              <View style={s.segment} accessibilityRole="radiogroup">
                {(["EXACT", "MONTH", "YEAR"] as OccurredPrecision[]).map((p) => (
                  <Pressable
                    key={p}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: precision === p }}
                    style={[s.segmentItem, precision === p && s.segmentOn]}
                    onPress={() => setDate(occurred || new Date(), p)}
                  >
                    <Text style={[s.segmentText, precision === p && s.segmentTextOn]}>{t(`register.when.precision.${p}` as TranslationKey)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={s.twoCols}>
              <Pressable accessibilityRole="button" style={[s.input, s.pick]} onPress={() => setPicker("date")}>
                <Text style={s.pickText}>{dateLabel}</Text>
              </Pressable>
              {precision === "EXACT" && (
                <Pressable accessibilityRole="button" style={[s.input, s.pick]} onPress={() => setPicker("time")}>
                  <Text style={s.pickText}>{occurred ? t("register.when.about", { time: formatTime(occurred, language) }) : "–"}</Text>
                </Pressable>
              )}
            </View>
            <View style={s.chips}>
              <Pressable accessibilityRole="button" style={s.chip} onPress={() => quickDay(0)}>
                <Text style={s.chipText}>{t("register.when.today")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={s.chip} onPress={() => quickDay(1)}>
                <Text style={s.chipText}>{t("register.when.yesterday")}</Text>
              </Pressable>
              {type === "LOST" && (
                <Pressable
                  accessibilityRole="button"
                  style={s.chip}
                  onPress={() => {
                    const d = new Date();
                    d.setFullYear(d.getFullYear() - 1);
                    setDate(d, "YEAR");
                    setPicker("date");
                  }}
                >
                  <Text style={s.chipText}>{t("register.when.longAgo")}</Text>
                </Pressable>
              )}
            </View>
            {longAgo && (
              <InlineNotice tone="warning" icon="hourglass-outline" title={t("register.when.historicTitle")} body={t("register.when.historicBody")} style={s.notice} />
            )}

            <View style={s.divider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("register.where.open")}
              onPress={() => router.push({ pathname: "/(report)/map", params: { reportType: type } })}
              style={s.mapBox}
            >
              {confirmed && lat != null && lng != null ? (
                <MapView
                  pointerEvents="none"
                  style={StyleSheet.absoluteFill}
                  region={{ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                >
                  <Marker coordinate={{ latitude: lat, longitude: lng }} />
                  {type === "LOST" && !!draft.location?.radiusMeters && (
                    <Circle
                      center={{ latitude: lat, longitude: lng }}
                      radius={draft.location.radiusMeters}
                      strokeColor="#2563EB"
                      fillColor="rgba(37,99,235,.12)"
                    />
                  )}
                </MapView>
              ) : (
                <View style={s.mapEmpty}>
                  <Ionicons name="map-outline" size={26} color={theme.colors.textSecondary} />
                  <Text style={s.mapEmptyText}>{type === "FOUND" ? t("register.where.pickFound") : t("register.where.pickLost")}</Text>
                </View>
              )}
              <View style={s.mapPill}>
                <Text style={s.mapPillText}>{confirmed ? t("register.where.change") : t("register.where.choose")}</Text>
              </View>
            </Pressable>
            {confirmed && (
              <View style={s.field}>
                <Text style={s.label}>
                  {t("register.where.placeName")}
                </Text>
                <TextInput
                  accessibilityLabel={t("register.where.placeName")}
                  value={draft.locationLabel || ""}
                  onChangeText={(v) => setField("locationLabel", v)}
                  style={s.input}
                />
                {type === "LOST" && areaCount > 0 && <Text style={s.mutedSmall}>{t("register.where.areas", { count: areaCount })}</Text>}
                <Text style={s.mutedSmall}>{t("register.where.private")}</Text>
              </View>
            )}
          </View>

          {/* 4 Finnerlønn (lost) / Hvor er gjenstanden nå (found) */}
          {type === "LOST" && rewardEnabled && (
            <View style={[s.card, isMissing("extra") && s.cardMissing]} onLayout={(e) => (sectionY.current.extra = e.nativeEvent.layout.y)}>
              <View style={s.cardHeader}>
                {numberBadge(4)}
                <Text style={s.h2}>{t("register.reward.title")}</Text>
              </View>
              <View style={s.chips}>
                {REWARD_PRESETS.map((amount) => {
                  const on = !rewardOther && reward === amount;
                  return (
                    <Pressable
                      key={amount}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[s.chip, on && s.chipOn]}
                      onPress={() => {
                        setRewardOther(false);
                        setField("rewardNOK", String(amount));
                      }}
                    >
                      <Text style={[s.chipText, on && s.chipTextOn]}>{amount === 0 ? t("register.reward.none") : formatMoney(amount, "NOK", language, 0)}</Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rewardOther || !REWARD_PRESETS.includes(reward) }}
                  style={[s.chip, (rewardOther || !REWARD_PRESETS.includes(reward)) && s.chipOn]}
                  onPress={() => {
                    // Start with an empty field, so typing does not end up after a "0".
                    setRewardOther(true);
                    if (REWARD_PRESETS.includes(reward)) setField("rewardNOK", "");
                  }}
                >
                  <Text style={[s.chipText, (rewardOther || !REWARD_PRESETS.includes(reward)) && s.chipTextOn]}>{t("register.reward.other")}</Text>
                </Pressable>
              </View>
              {(rewardOther || !REWARD_PRESETS.includes(reward)) && (
                <TextInput
                  accessibilityLabel={t("register.reward.amount")}
                  value={draft.rewardNOK === "0" ? "" : draft.rewardNOK || ""}
                  onChangeText={(v) => setField("rewardNOK", cleanRewardInput(v))}
                  placeholder={t("register.reward.placeholder")}
                  placeholderTextColor="#64748B"
                  autoFocus={rewardOther}
                  keyboardType="number-pad"
                  style={s.input}
                />
              )}
              <Text style={s.mutedSmall}>{t("register.reward.help")}</Text>
            </View>
          )}

          {type === "FOUND" && (
            <View style={[s.card, isMissing("extra") && s.cardMissing]} onLayout={(e) => (sectionY.current.extra = e.nativeEvent.layout.y)}>
              <View style={s.cardHeader}>
                {numberBadge(4)}
                <Text style={s.h2}>{t("register.custody.title")}</Text>
              </View>
              {(["WITH_FINDER", "LEFT_AT_PLACE", "HANDED_IN"] as Custody[]).map((value) => {
                const on = (draft.custody || "WITH_FINDER") === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[s.option, on && s.optionOn]}
                    onPress={() => setField("custody", value)}
                  >
                    <View style={[s.radio, on && s.radioOn]} />
                    <View style={s.flex}>
                      <Text style={s.optionTitle}>{t(`register.custody.${value}` as TranslationKey)}</Text>
                      <Text style={s.mutedSmall}>{t(`register.custody.${value}.body` as TranslationKey)}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {draft.custody === "HANDED_IN" && (
                <View style={s.field}>
                  <Text style={s.label}>
                    {t("register.custody.where")}
                  </Text>
                  <TextInput
                    accessibilityLabel={t("register.custody.where")}
                    value={draft.custodyPlace || ""}
                    onChangeText={(v) => setField("custodyPlace", v)}
                    placeholder={t("register.custody.wherePlaceholder")}
                    placeholderTextColor="#64748B"
                    style={s.input}
                    maxLength={200}
                  />
                  <Text style={s.mutedSmall}>{t("register.custody.whereHelp")}</Text>
                </View>
              )}
            </View>
          )}

          {type === "LOST" && <InlineNotice tone="info" icon="time-outline" title={t("register.freePeriod")} style={s.notice} />}
        </ScrollView>

        <View style={s.bottom}>
          {missing.length > 0 && (
            <Text style={s.missing} accessibilityLiveRegion="polite">
              {t("register.missing.title", { list: missing.map((k) => t(k)).join(", ") })}
            </Text>
          )}
          {!!error && <InlineNotice tone="warning" title={t("report.create.could.not.save")} body={error} style={s.notice} />}
          <Button label={t("register.send")} onPress={() => void submit()} busy={saving} />
        </View>
      </KeyboardAvoidingView>

      {picker && Platform.OS === "android" && (
        <DateTimePicker
          value={occurred || new Date()}
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
          <DateTimePicker
            value={occurred || new Date()}
            mode={picker}
            display={picker === "date" ? "inline" : "spinner"}
            maximumDate={picker === "date" ? new Date() : undefined}
            onChange={(_event: any, d?: Date) => d && setDate(d)}
          />
        )}
        <Button label={t("common.close")} variant="neutral" onPress={() => setPicker(null)} />
      </BottomSheet>

      <ConfirmSheet
        visible={limitSheet}
        title={t("report.create.report.limit.reached")}
        body={t("register.limitTestBody")}
        confirmLabel={t("report.create.create.anyway")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setLimitSheet(false)}
        onConfirm={() => {
          setLimitSheet(false);
          void submit(true);
        }}
      />
      <ConfirmSheet
        visible={!!imageRetry}
        title={t("report.create.the.report.was.saved")}
        body={t("report.create.the.image.could.not.be.uploaded.3")}
        confirmLabel={t("report.create.try.image.again")}
        cancelLabel={t("register.continueWithoutPhoto")}
        busy={saving}
        onCancel={() => {
          const id = imageRetry?.reportId;
          setImageRetry(null);
          if (id) void finish(id);
        }}
        onConfirm={() => void retryImages()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 16, gap: 12 },
  cardMissing: { borderColor: theme.tone.warning.border, borderWidth: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { width: 26, height: 26, borderRadius: 999, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  h2: { flex: 1, fontSize: 17, fontWeight: "900", color: theme.colors.text },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photo: { width: 84, height: 84, borderRadius: 14, backgroundColor: "#E5E7EB" },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  photoAdd: {
    width: 84,
    height: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#94A3B8",
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  photoAddText: { fontSize: 12, fontWeight: "800", color: theme.colors.text },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
  },
  textarea: { minHeight: 88, paddingTop: 12 },
  hits: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, overflow: "hidden" },
  hit: { paddingHorizontal: 14, paddingVertical: 11, minHeight: 44, justifyContent: "center" },
  hitBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  hitName: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  selected: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: theme.colors.bg },
  selectedName: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  muted: { fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary },
  mutedSmall: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  linkButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  link: { fontSize: 15, fontWeight: "800", color: theme.colors.primary, textDecorationLine: "underline" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchOn: { borderWidth: 3, borderColor: "#2563EB" },
  swatchText: { fontSize: 14, fontWeight: "900" },
  swatchMore: { width: 98, backgroundColor: theme.colors.card },
  swatchMoreText: { fontSize: 13, fontWeight: "800", color: theme.colors.text },
  segment: { flexDirection: "row", gap: 4, backgroundColor: "#EEF2F6", borderRadius: 14, padding: 4 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: theme.colors.card },
  segmentText: { fontSize: 13, fontWeight: "800", color: theme.colors.textSecondary },
  segmentTextOn: { color: theme.colors.text, fontWeight: "900" },
  twoCols: { flexDirection: "row", gap: 10 },
  pick: { flex: 1, justifyContent: "center" },
  pickText: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  chipTextOn: { color: "#FFFFFF" },
  notice: { marginTop: 0 },
  divider: { height: 1, backgroundColor: theme.colors.border },
  mapBox: { height: 140, borderRadius: 14, overflow: "hidden", backgroundColor: "#E0E7EF" },
  mapEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  mapEmptyText: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  mapPill: { position: "absolute", right: 10, bottom: 10, backgroundColor: theme.colors.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  mapPillText: { fontSize: 13, fontWeight: "800", color: theme.colors.text },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionOn: { borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.bg },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: "#94A3B8" },
  radioOn: { borderWidth: 7, borderColor: theme.colors.primary },
  optionTitle: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
  bottom: { padding: 16, paddingBottom: 28, gap: 8, backgroundColor: theme.colors.card, borderTopWidth: 1, borderTopColor: theme.colors.border },
  missing: { fontSize: 13, fontWeight: "700", color: theme.tone.warning.fg },
});
