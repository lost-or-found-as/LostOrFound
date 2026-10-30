// app/(report)/create-report.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Pressable,
  Image,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { API_BASE_URL } from "../../src/lib/config";
import { useReportDraft } from "../../src/contexts/ReportDraftContext";
import {
  pickOneImage,
  captureOneImage,
  uploadReportImage,
} from "../../src/lib/images";
import { supabase } from "../../src/lib/supabase";
import {
  ensureFoundIdentity,
  ensureLostAuthenticated,
} from "../../src/lib/authGate";
import { ensureProfileRow } from "../../src/lib/profile";
import { isAnonymousUser } from "../../src/lib/authGate";
import { reportHandledError } from "../../src/lib/sentry";
import { reverseGeocodeToLabel } from "../../src/lib/reverseGeocode";
import {
  CATEGORIES,
  SUBCATEGORIES,
  OBJECT_LABELS_EN,
  objectLabel,
  objectSearchText,
} from "../../src/lib/categories";
import { theme } from "../../src/ui/theme";
import { PremiumHeader } from "../../src/ui/PremiumHeader";
import { useI18n } from "../../src/i18n/I18nProvider";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { codedError, userErrorMessage } from "../../src/lib/userError";
import { formatDistance } from "../../src/i18n/formatters";
import { CATEGORY_CATALOG, COLOR_CATALOG, colorEntry, findByName, itemEntry, itemSearchText } from "../../src/i18n/catalog";
type ReportType = "LOST" | "FOUND";
type ColorOption = { label: string; value: string };
type RegionCode = "NO" | "US" | "GB" | "EU" | "OTHER";
type Translate = ReturnType<typeof useI18n>["t"];

function inferRegionCodeFromLocale(locale?: string): RegionCode {
  const region =
    String(locale || "")
      .split("-")
      .pop()
      ?.toUpperCase() || "";
  if (region === "NO") return "NO";
  if (region === "US") return "US";
  if (region === "GB") return "GB";
  if (
    [
      "SE",
      "DK",
      "FI",
      "DE",
      "FR",
      "ES",
      "IT",
      "NL",
      "BE",
      "PT",
      "IE",
      "AT",
      "CH",
      "PL",
      "CZ",
    ].includes(region)
  )
    return "EU";
  return "OTHER";
}

function formatDistanceDisplay(
  meters: number | undefined,
  region: RegionCode,
  language: "no" | "en",
  translate: Translate,
) {
  if (meters == null) return "—";
  return formatDistance(meters, language, translate, region === "US" || region === "GB" ? "imperial" : "metric");
}

function rewardCurrencyCode(region: RegionCode): "NOK" | "USD" | "GBP" | "EUR" {
  if (region === "NO") return "NOK";
  if (region === "US") return "USD";
  if (region === "GB") return "GBP";
  return "EUR";
}
// Picker values are colour keys; the shown name comes from the catalog in the app language.
const COLORS: ColorOption[] = COLOR_CATALOG.map((e) => ({ label: e.names.no, value: e.key }));
const pad = (n: number) => String(n).padStart(2, "0");
function localizeCategoryLabel(
  label: string | undefined,
  language: "no" | "en",
) {
  if (!label) return label ?? "";
  return findByName(CATEGORY_CATALOG, label)?.names[language] ?? label;
}

function localizeObjectLabel(
  value: string | undefined,
  fallbackLabel: string | undefined,
  language: "no" | "en",
) {
  if (!value && !fallbackLabel) return "";
  return (
    itemEntry(value)?.names[language] ??
    findByName(CATEGORY_CATALOG, fallbackLabel)?.names[language] ??
    fallbackLabel ??
    value ??
    ""
  );
}

function objectSearchAliases(
  value: string | undefined,
  noLabel: string | undefined,
  enLabel: string | undefined,
) {
  return [itemSearchText(value), noLabel ?? "", enLabel ?? ""].join(" ");
}

function localizeColorLabel(label: string | undefined, language: "no" | "en") {
  if (!label) return label ?? "";
  return (colorEntry(label) ?? findByName(COLOR_CATALOG, label))?.names[language] ?? label;
}
const fmtLocal = (iso?: string) => {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};
const toISO = (dateStr: string, timeStr: string): string | undefined => {
  if (!dateStr || !timeStr) return undefined;
  const [Y, M, D] = dateStr.split("-").map(Number);
  const [H, Min] = timeStr.split(":").map(Number);
  if (![Y, M, D, H, Min].every((x) => Number.isFinite(x))) return undefined;
  const dt = new Date(Y, (M || 1) - 1, D || 1, H || 0, Min || 0);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
};
function createClientRequestId() {
  return `report-${Date.now()}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}
class ReportApiError extends Error {
  status: number;
  code?: string;
  serverMessage?: string;

  constructor(status: number, code?: string, serverMessage?: string) {
    super(serverMessage || code || `HTTP ${status}`);
    this.name = "ReportApiError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

function showReportApiError(
  error: any,
  router: ReturnType<typeof useRouter>,
  translate: Translate,
) {
  const code = String(error?.code || "").toUpperCase();

  if (code === "LOST_REPORT_WEEKLY_LIMIT") {
    Alert.alert(
      translate("report.create.report.limit.reached"),
      translate("report.create.you.can.create.up.to.two"),
      [
        { text: translate("report.create.ok"), style: "cancel" },
        {
          text: translate("report.create.open.my.cases"),
          onPress: () => router.replace("/my-reports"),
        },
      ],
    );
    return true;
  }

  if (code === "ACCOUNT_REQUIRED_FOR_LOST") {
    Alert.alert(
      translate("report.create.account.required"),
      translate("report.create.you.need.a.regular.account.to"),
      [
        { text: translate("report.create.cancel"), style: "cancel" },
        {
          text: translate("report.create.log.in"),
          onPress: () =>
            router.push({
              pathname: "/(auth)/login",
              params: { returnTo: "/(report)/create-report", intent: "lost" },
            }),
        },
      ],
    );
    return true;
  }

  if (code === "CRITICAL_EDIT_COOLDOWN") {
    Alert.alert(
      translate("report.create.change.temporarily.locked"),
      translate("report.create.you.recently.changed.the.item.time"),
    );
    return true;
  }

  if (code === "CRITICAL_EDIT_LIMIT_REACHED") {
    Alert.alert(
      translate("report.create.major.change.limit.reached"),
      translate("report.create.you.can.still.update.the.description"),
    );
    return true;
  }

  return false;
}

export default function CreateReportScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const regionCode = useMemo(
    () =>
      inferRegionCodeFromLocale(
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().locale
          : "",
      ),
    [],
  );
  const rewardEnabled = regionCode === "NO";
  const activeCurrency = rewardCurrencyCode(regionCode);
  const params = useLocalSearchParams<{
    type?: ReportType;
    editReportId?: string;
  }>();
  const editReportId =
    typeof params?.editReportId === "string" ? params.editReportId : undefined;
  const isEditMode = !!editReportId;
  const {
    draft,
    setField,
    reset,
    flush,
    loading: draftLoading,
  } = useReportDraft();
  // Auto-scroll: ref + anchor
  const scrollRef = useRef<ScrollView>(null);
  const objectInputRef = useRef<TextInput>(null);
  const editLoadedRef = useRef<string | null>(null);
  const [categoryAnchorY, setCategoryAnchorY] = useState(0);
  const [saving, setSaving] = useState(false);
  const networkSubmitRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [imageRetryOpen, setImageRetryOpen] = useState(false);
  const [retryReportId, setRetryReportId] = useState<string | null>(null);
  const [retryImageUris, setRetryImageUris] = useState<string[]>([]);
  const [validationMissing, setValidationMissing] = useState<string[]>([]);
  const [validationOpen, setValidationOpen] = useState(false);
  const [objectSectionY, setObjectSectionY] = useState(0);
  const [timeSectionY, setTimeSectionY] = useState(0);
  const [detailsSectionY, setDetailsSectionY] = useState(0);
  const [imagesSectionY, setImagesSectionY] = useState(0);
  const [continueWithoutImage, setContinueWithoutImage] = useState(false);
  const [photoPromptOpen, setPhotoPromptOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [color2Open, setColor2Open] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [subQuery, setSubQuery] = useState("");
  const [objectQuery, setObjectQuery] = useState("");
  const [objectOpen, setObjectOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Saved confirmation modal.
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedReportId, setSavedReportId] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number>(0);
  const [savedType, setSavedType] = useState<ReportType>("LOST");
  // T1.9A: a guest gets a receipt screen instead of the "view matches" dialog.
  const savedSummaryRef = useRef<{ title: string; images: number }>({ title: "", images: 0 });
  const showSaved = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (isAnonymousUser(data.session?.user as any)) {
        router.replace({
          pathname: "/found-receipt",
          params: { title: savedSummaryRef.current.title, images: String(savedSummaryRef.current.images) },
        });
        return;
      }
    } catch {}
    setSavedOpen(true);
  }, [router]);
  const savedTypeLabel =
    savedType === "FOUND"
      ? t("report.create.found.item")
      : t("report.create.lost.item");
  // Editable place label populated by reverse geocoding.
  const [locationLabel, setLocationLabel] = useState<string>(
    (draft as any).locationLabel ?? "",
  );
  const [locationLabelTouched, setLocationLabelTouched] = useState(false);
  useEffect(() => {
    const t = params?.type;
    if (t === "LOST" || t === "FOUND") setField("type" as any, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.type]);
  const type: ReportType = (draft.type as ReportType) ?? "LOST";
  // FOUND uses an exact location with a small radius (default 10 m). LOST can use a broader user-selected radius.
  useEffect(() => {
    if (type !== "FOUND") return;
    const loc = (draft as any).location;
    const current = loc?.radiusMeters;
    if (current === 10) return;
    setField("location" as any, {
      latitude: loc?.latitude ?? latitude,
      longitude: loc?.longitude ?? longitude,
      radiusMeters: 10,
      confirmed: loc?.confirmed === true,
    });
  }, [type]);
  const category = (draft as any).category ?? "PERSONAL";
  const subcategoryKey = (draft as any).subcategoryKey ?? "";
  const subcategoryCustom = (draft as any).subcategoryCustom ?? "";
  const description = (draft as any).description ?? "";
  const color = (draft as any).color ?? "";
  const colorSecondary = (draft as any).colorSecondary ?? "";
  const brand = (draft as any).brand ?? "";
  const rewardNOK = (draft as any).rewardNOK ?? "0";
  const occurredAtISO = (draft as any).occurredAtISO as string | undefined;
  const latitude = (draft as any).location?.latitude ?? 59.9139;
  const longitude = (draft as any).location?.longitude ?? 10.7522;
  const radiusMeters = (draft as any).location?.radiusMeters;
  const effectiveRadiusMeters = type === "FOUND" ? 10 : radiusMeters;
  const locationConfirmed = (draft as any).location?.confirmed === true;
  const searchAreas = Array.isArray((draft as any).searchAreas)
    ? (draft as any).searchAreas
    : [];
  const previewRegion = useMemo(
    () => ({
      latitude,
      longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }),
    [latitude, longitude],
  );
  // Autofill the place from latitude and longitude through the backend reverse-geocoding endpoint.
  // Preserve a location label entered manually.
  // Ignore stale reverse-geocoding responses.
  const geoReqRef = useRef(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (locationLabelTouched) return;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const reqId = ++geoReqRef.current;
      const lat0 = latitude;
      const lng0 = longitude;
      try {
        const label = await reverseGeocodeToLabel(lat0, lng0, { language });
        if (!alive) return;
        if (reqId !== geoReqRef.current) return;
        if (lat0 !== latitude || lng0 !== longitude) return;
        if (label) {
          setLocationLabel(label);
          setField("locationLabel" as any, label);
        }
      } catch {
        // Reverse geocoding is optional because the location label is editable.
      }
    })();
    return () => {
      alive = false;
    };
  }, [latitude, longitude, locationLabelTouched, setField]);
  const whatLabel =
    type === "FOUND"
      ? t("report.create.what.did.you.find")
      : t("report.create.what.did.you.lose");
  const categoryLabel = useMemo(
    () =>
      localizeCategoryLabel(
        CATEGORIES.find((c) => c.value === category)?.label,
        language,
      ) ?? t("report.create.choose.category"),
    [category, language],
  );
  const subOptions = useMemo(() => SUBCATEGORIES[category] || [], [category]);
  const filteredSubOptions = useMemo(() => {
    const q = subQuery.trim().toLowerCase();
    if (!q) return subOptions;
    return subOptions.filter((s) => s.label.toLowerCase().includes(q));
  }, [subQuery, subOptions]);
  // Global search normalization for diacritics and whitespace.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const subIndex = useMemo(() => {
    const catLabelByKey = new Map(
      CATEGORIES.map((c) => [c.value, c.label] as const),
    );
    return Object.entries(SUBCATEGORIES).flatMap(([catKey, subs]) =>
      subs.map((s) => {
        const englishLabel = localizeObjectLabel(s.value, s.label, "en");
        return {
          catKey,
          catLabel: catLabelByKey.get(catKey) ?? catKey,
          subKey: s.value,
          subLabel: s.label,
          search: normalize(
            `${objectSearchAliases(s.value, s.label, englishLabel)} ${catLabelByKey.get(catKey) ?? ""}`,
          ),
        };
      }),
    );
  }, []);
  const filteredObjects = useMemo(() => {
    const q = normalize(objectQuery);
    if (!q) return [];
    if (q.length < 2) return [];
    return subIndex.filter((x) => x.search.includes(q)).slice(0, 30);
  }, [objectQuery, subIndex]);
  // Subcategory browsing across all categories, based on the global index.
  // Used when the user browses instead of using item search.
  const filteredSubIndex = useMemo(() => {
    const q = normalize(subQuery);
    if (!q) return subIndex;
    return subIndex.filter((x) => x.search.includes(q));
  }, [subQuery, subIndex]);
  const subBrowseRows = useMemo(() => {
    const out: any[] = [];
    let prevCat = "";
    for (const hit of filteredSubIndex) {
      if (hit.catKey !== prevCat) {
        out.push({
          kind: "header",
          key: `h:${hit.catKey}`,
          label: hit.catLabel,
        });
        prevCat = hit.catKey;
      }
      out.push({ kind: "item", key: `i:${hit.catKey}:${hit.subKey}`, hit });
    }
    return out;
  }, [filteredSubIndex]);
  const subcategoryLabel = useMemo(() => {
    if (!subcategoryKey) return t("report.create.choose.item");
    const hit = subOptions.find((s) => s.value === subcategoryKey)?.label;
    return (
      localizeObjectLabel(subcategoryKey, hit, language) ||
      t("report.create.choose.item.2")
    );
  }, [subcategoryKey, subOptions, language]);
  const colorLabel = useMemo(
    () =>
      color
        ? (localizeColorLabel(
            COLORS.find((c) => c.value === color)?.label,
            language,
          ) ?? t("report.create.choose.color"))
        : t("report.create.choose.color.2"),
    [color, language],
  );
  const color2Label = useMemo(
    () =>
      colorSecondary
        ? (localizeColorLabel(
            COLORS.find((c) => c.value === colorSecondary)?.label,
            language,
          ) ?? t("report.create.choose.secondary.color"))
        : t("report.create.choose.secondary.color.2"),
    [colorSecondary, language],
  );
  const radiusLabel = formatDistanceDisplay(
    effectiveRadiusMeters,
    regionCode,
    language,
    t,
  );
  // Time.
  const init = fmtLocal(occurredAtISO);
  const [dateStr, setDateStr] = useState(init.date);
  const [timeStr, setTimeStr] = useState(init.time);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Synchronize local date and time when the draft is restored after mount.
  useEffect(() => {
    if (!occurredAtISO) return;
    // Preserve a date and time already entered by the user.
    if (dateStr.trim() || timeStr.trim()) return;
    const v = fmtLocal(occurredAtISO);
    if (v.date) setDateStr(v.date);
    if (v.time) setTimeStr(v.time);
  }, [occurredAtISO]);
  // Set the current time as the responsive default.
  useEffect(() => {
    if (occurredAtISO || isEditMode) return;
    const now = new Date();
    now.setSeconds(0, 0);
    setField("occurredAtISO" as any, now.toISOString());
    setDateStr(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );
    setTimeStr(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  }, [draftLoading, occurredAtISO, setField, isEditMode]);

  useEffect(() => {
    if (!editReportId || editLoadedRef.current === editReportId) return;
    let alive = true;
    (async () => {
      try {
        setEditLoading(true);
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          await flush();
          router.replace({
            pathname: "/(auth)/login",
            params: { returnTo: "/(report)/create-report", intent: "lost" },
          });
          return;
        }
        const res = await fetch(
          `${API_BASE_URL}/reports/${encodeURIComponent(editReportId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(
            json?.error ?? t("report.create.could.not.load.case"),
          );
        const report = json?.report;
        const existingPaths = (json?.images ?? [])
          .map((x: any) => String(x?.path ?? ""))
          .filter(Boolean);
        if (existingPaths.length) {
          try {
            const signedRes = await fetch(
              `${API_BASE_URL}/storage/signed-download-batch`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ paths: existingPaths }),
              },
            );
            const signedJson = await signedRes.json().catch(() => ({}));
            if (signedRes.ok)
              setExistingImageUrls(
                existingPaths
                  .map((path: string) => signedJson?.urls?.[path])
                  .filter(Boolean),
              );
          } catch {
            setExistingImageUrls([]);
          }
        } else setExistingImageUrls([]);
        if (!report) throw new Error(t("report.create.case.was.not.found"));

        if (!alive) return;
        editLoadedRef.current = editReportId;
        setField("type" as any, report.type === "FOUND" ? "FOUND" : "LOST");
        setField("category" as any, report.category ?? "PERSONAL");
        setField("subcategoryKey" as any, report.subcategory_key ?? "");
        setField("subcategoryCustom" as any, report.subcategory_custom ?? "");
        setField("description" as any, report.description ?? "");
        setField("color" as any, report.color ?? "");
        setField("colorSecondary" as any, "");
        setField("brand" as any, report.brand ?? "");
        setField(
          "rewardNOK" as any,
          String(Math.round(Number(report.reward_ore || 0) / 100)),
        );
        setField("occurredAtISO" as any, report.occurred_at);
        setField("location" as any, {
          latitude: Number(report.lat ?? 59.9139),
          longitude: Number(report.lng ?? 10.7522),
          radiusMeters: Number(
            report.radius_m ??
              report.search_radius_m ??
              report.area_radius_m ??
              report.location_radius_m ??
              500,
          ),
          confirmed: true,
        });
        const label = report.location_label ?? "";
        setLocationLabel(label);
        setLocationLabelTouched(!!label);
        setField("locationLabel" as any, label);
        setField(
          "searchAreas" as any,
          Array.isArray(report.search_areas) ? report.search_areas : [],
        );
        const when = fmtLocal(report.occurred_at);
        setDateStr(when.date);
        setTimeStr(when.time);
      } catch (e: any) {
        Alert.alert(
          t("report.create.error"),
          userErrorMessage(e, t, "report.create.could.not.load.case.2", "report.edit.load"),
        );
      } finally {
        if (alive) setEditLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editReportId, setField, router, language, flush]);

  const closeMenus = () => {
    if (catOpen) setCatOpen(false);
    if (colorOpen) setColorOpen(false);
    if (color2Open) setColor2Open(false);
    if (subOpen) setSubOpen(false);
    if (objectOpen) setObjectOpen(false);
  };
  const selectedDate = useMemo(() => {
    const parsed = toISO(dateStr.trim(), timeStr.trim() || "12:00");
    const value = parsed ? new Date(parsed) : new Date();
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }, [dateStr, timeStr]);
  const applySelectedDate = (value: Date) => {
    const now = new Date();
    const safeDate = value.getTime() > now.getTime() ? now : value;
    const nextDate = `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())}`;
    const nextTime =
      timeStr.trim() ||
      `${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}`;
    setDateStr(nextDate);
    setTimeStr(nextTime);
    const iso = toISO(nextDate, nextTime);
    if (iso) setField("occurredAtISO" as any, iso);
    setDatePickerOpen(false);
  };
  // Synchronize date and time when editing finishes.
  const syncDateTimeToDraft = () => {
    const iso = toISO(dateStr.trim(), timeStr.trim());
    if (iso) setField("occurredAtISO" as any, iso);
  };
  const openMap = () => {
    closeMenus();
    router.push({ pathname: "/(report)/map", params: { reportType: type } });
  };
  const scrollToCategorySection = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, categoryAnchorY - 8),
        animated: true,
      });
    });
  };
  const applySubcategoryFromGlobalSearch = (catKey: string, subKey: string) => {
    setField("category" as any, catKey);
    setField("subcategoryKey" as any, subKey);
    if (!(catKey === "PETS" && subKey === "CUSTOM")) {
      setField("subcategoryCustom" as any, "");
    }
    setObjectOpen(false);
    setObjectQuery("");
    setSubQuery("");
    setCatOpen(false);
    setColorOpen(false);
    setSubOpen(false);
    scrollToCategorySection();
  };
  const setNow = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    setDateStr(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );
    setTimeStr(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setField("occurredAtISO" as any, now.toISOString());
    closeMenus();
  };
  const shiftMinutes = (mins: number) => {
    const base = new Date(
      occurredAtISO && !Number.isNaN(new Date(occurredAtISO).getTime())
        ? occurredAtISO
        : new Date().toISOString(),
    );
    base.setMinutes(base.getMinutes() + mins);
    base.setSeconds(0, 0);
    setDateStr(
      `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`,
    );
    setTimeStr(`${pad(base.getHours())}:${pad(base.getMinutes())}`);
    setField("occurredAtISO" as any, base.toISOString());
    closeMenus();
  };
  const computedTitle = useMemo(() => {
    const typeLabel =
      type === "FOUND" ? t("report.create.found") : t("report.create.lost");
    const petCustom =
      category === "PETS" &&
      subcategoryKey === "CUSTOM" &&
      subcategoryCustom.trim()
        ? subcategoryCustom.trim()
        : "";
    const parts = [
      typeLabel,
      localizeCategoryLabel(categoryLabel, language),
      subcategoryKey ? localizeCategoryLabel(subcategoryLabel, language) : "",
      petCustom,
      brand?.trim(),
      colorLabel !== t("report.create.choose.color.3") ? colorLabel : "",
      colorSecondary ? color2Label : "",
    ].filter(Boolean);
    return parts.join(" • ");
  }, [
    type,
    categoryLabel,
    subcategoryKey,
    subcategoryLabel,
    subcategoryCustom,
    category,
    brand,
    colorLabel,
    colorSecondary,
    color2Label,
    language,
  ]);
  const validationKey = {
    item: t("report.create.item"),
    color: t("report.create.primary.color"),
    time: t("report.create.date.and.time"),
    location: t("report.create.confirmed.location"),
  };
  useEffect(() => {
    setValidationMissing((current) => {
      if (current.length === 0) return current;
      const validDateTime = Boolean(toISO(dateStr.trim(), timeStr.trim()));
      const validLocation =
        locationConfirmed &&
        locationLabel.trim().length > 0 &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude);
      return current.filter((item) => {
        if (item === validationKey.item) return !subcategoryKey;
        if (item === validationKey.color) return !color;
        if (item === validationKey.time) return !validDateTime;
        if (item === validationKey.location) return !validLocation;
        if (item === t("report.create.type.of.pet"))
          return (
            category === "PETS" &&
            subcategoryKey === "CUSTOM" &&
            !subcategoryCustom.trim()
          );
        if (item === t("report.create.valid.reward.amount")) {
          const value = Number(rewardNOK || "0");
          return !Number.isFinite(value) || value < 0;
        }
        return true;
      });
    });
  }, [
    subcategoryKey,
    subcategoryCustom,
    color,
    dateStr,
    timeStr,
    locationConfirmed,
    locationLabel,
    latitude,
    longitude,
    rewardNOK,
    category,
    t,
  ]);
  const validate = () => {
    const missing: string[] = [];
    let firstY = 0;
    if (!subcategoryKey) {
      missing.push(validationKey.item);
      firstY = objectSectionY;
    }
    if (
      category === "PETS" &&
      subcategoryKey === "CUSTOM" &&
      !subcategoryCustom.trim()
    ) {
      missing.push(t("report.create.type.of.pet"));
      firstY = firstY || objectSectionY;
    }
    if (!color) {
      missing.push(validationKey.color);
      firstY = firstY || detailsSectionY;
    }
    const iso = toISO(dateStr.trim(), timeStr.trim());
    if (!iso) {
      missing.push(validationKey.time);
      firstY = firstY || timeSectionY;
    }
    if (
      !locationConfirmed ||
      !locationLabel.trim() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      missing.push(validationKey.location);
      firstY = firstY || timeSectionY;
    }
    if (type === "LOST" && rewardEnabled) {
      const n = Number(rewardNOK || "0");
      if (!Number.isFinite(n) || n < 0)
        missing.push(t("report.create.valid.reward.amount"));
    }
    if (missing.length) {
      setValidationMissing(missing);
      setValidationOpen(true);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({
          y: Math.max(0, firstY - 12),
          animated: true,
        }),
      );
      return false;
    }
    setValidationMissing([]);
    if (iso) setField("occurredAtISO" as any, iso);
    return true;
  };

  const addFromGallery = async () => {
    try {
      const uri = await pickOneImage();
      if (uri) {
        setPendingImages((prev) => [uri, ...prev]);
        setContinueWithoutImage(false);
      }
    } catch (e: any) {
      Alert.alert(
        t("report.create.error.2"),
        userErrorMessage(e, t, "report.create.could.not.open.image.library", "report.image.library"),
      );
    }
  };
  const addFromCamera = async () => {
    try {
      const uri = await captureOneImage();
      if (uri) {
        setPendingImages((prev) => [uri, ...prev]);
        setContinueWithoutImage(false);
      }
    } catch (e: any) {
      Alert.alert(
        t("report.create.error.3"),
        userErrorMessage(e, t, "report.create.could.not.open.camera", "report.image.camera"),
      );
    }
  };
  const removePending = (uri: string) =>
    setPendingImages((prev) => prev.filter((u) => u !== uri));

  const retryImagesOnly = useCallback(async () => {
    if (!retryReportId || retryImageUris.length === 0 || uploading) return;

    try {
      setUploading(true);
      const results = await Promise.allSettled(
        retryImageUris.map((uri) => uploadReportImage(retryReportId, uri)),
      );
      const failedUris = results
        .map((result, index) => ({ result, uri: retryImageUris[index] }))
        .filter(({ result }) => result.status === "rejected")
        .map(({ uri }) => uri);

      if (failedUris.length > 0) {
        setRetryImageUris(failedUris);
        Alert.alert(
          t("report.create.the.image.could.not.be.uploaded"),
          t("report.create.p0.image.s.still.could.not", {
            p0: failedUris.length,
          }),
        );
        return;
      }

      setImageRetryOpen(false);
      setRetryReportId(null);
      setRetryImageUris([]);
      setPendingImages([]);
      setSavedReportId(retryReportId);
      setSavedCount(0);
      await showSaved();
    } catch (error: any) {
      Alert.alert(
        t("report.create.the.image.could.not.be.uploaded.2"),
        userErrorMessage(error, t, "report.create.please.try.again", "report.image_upload.retry"),
      );
    } finally {
      setUploading(false);
    }
  }, [language, retryImageUris, retryReportId, uploading, showSaved]);

  const submitRef = useRef<
    (options?: {
      testOverrideWeeklyLimit?: boolean;
      allowWithoutImage?: boolean;
    }) => Promise<void>
  >(async () => {});
  const appendToDescription = (line: string) => {
    const current = String((draft as any).description ?? "").trim();
    const clean = String(line || "").trim();
    if (!clean) return;
    const next = current ? `${current}\n${clean}` : clean;
    setField("description" as any, next);
  };
  const onSubmit = useCallback(
    async (options?: {
      testOverrideWeeklyLimit?: boolean;
      allowWithoutImage?: boolean;
    }) => {
      console.log("[create-report] CTA pressed");
      const log = (...args: any[]) => console.log("[create-report]", ...args);
      if (!validate()) return;
      if (
        !isEditMode &&
        pendingImages.length === 0 &&
        !continueWithoutImage &&
        !options?.allowWithoutImage
      ) {
        setPhotoPromptOpen(true);
        requestAnimationFrame(() =>
          scrollRef.current?.scrollTo({
            y: Math.max(0, imagesSectionY - 12),
            animated: true,
          }),
        );
        return;
      }
      // Resolve the required identity before submitting.
      // Found reports can use an existing or anonymous session.
      // Lost reports require a regular authenticated account.
      try {
        const returnTo = "/(report)/create-report";
        if (type === "FOUND") {
          const session = await ensureFoundIdentity();
          const uid = session?.user?.id;
          if (uid) {
            try {
              await ensureProfileRow(uid);
            } catch (e: any) {
              log("ensureProfileRow warn", e?.message ?? e);
            }
          }
        } else {
          const session = await ensureLostAuthenticated();
          const uid = session?.user?.id;
          if (uid) {
            try {
              await ensureProfileRow(uid);
            } catch (e: any) {
              log("ensureProfileRow warn", e?.message ?? e);
            }
          }
        }
      } catch (e: any) {
        const code = e?.code || e?.message;
        if (
          type === "LOST" &&
          (code === "LOGIN_REQUIRED" || code === "UPGRADE_REQUIRED")
        ) {
          await flush();
          router.push({
            pathname: "/(auth)/login",
            params: {
              returnTo: "/(report)/create-report",
              intent: "lost",
              upgrade: code === "UPGRADE_REQUIRED" ? "1" : undefined,
            },
          });
          return;
        }
        throw e;
      }
      try {
        if (networkSubmitRef.current) return;
        networkSubmitRef.current = true;
        setSaving(true);
        const secondary =
          colorSecondary && colorSecondary !== color ? colorSecondary : "";
        const secondaryLabel = secondary
          ? COLORS.find((c) => c.value === secondary)?.label || secondary
          : "";
        const descriptionBase = description?.trim() || "";
        const extraLine = secondaryLabel
          ? `${t("report.create.secondary.color")}: ${localizeColorLabel(secondaryLabel, language)}`
          : "";
        const descriptionFull =
          descriptionBase || extraLine
            ? [descriptionBase, extraLine].filter(Boolean).join("\n")
            : undefined;
        const when = (() => {
          if (occurredAtISO) {
            const d = new Date(occurredAtISO);
            if (!Number.isNaN(d.getTime())) return d.toISOString();
          }
          return new Date().toISOString();
        })();
        if (!isEditMode && !requestIdRef.current)
          requestIdRef.current = createClientRequestId();
        const body: any = {
          type,
          category: category.trim().toUpperCase(),
          subcategory_key: subcategoryKey
            ? String(subcategoryKey).trim().toUpperCase()
            : undefined,
          subcategory_custom:
            category === "PETS" && subcategoryKey === "CUSTOM"
              ? subcategoryCustom.trim() || undefined
              : undefined,
          title: computedTitle,
          description: descriptionFull,
          color: color.trim() || undefined,
          brand: brand.trim() || undefined,
          occurred_at: when,
          // The backend expects latitude and longitude at the top level.
          lat: latitude,
          lng: longitude,
          // Send the radius to the backend to avoid pin-only matching.
          radius_m: effectiveRadiusMeters ?? undefined,
          location_label: locationLabel?.trim() || undefined,
          search_areas: searchAreas,
          ...(type === "LOST" && rewardEnabled
            ? { reward_ore: Math.max(0, Math.round(Number(rewardNOK) * 100)) }
            : {}),
          ...(!isEditMode ? { client_request_id: requestIdRef.current } : {}),
          ...(options?.testOverrideWeeklyLimit
            ? { test_override_weekly_limit: true }
            : {}),
        };
        let accessToken: string | undefined;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          accessToken = token;
          if (token) headers.Authorization = `Bearer ${token}`;
        } catch {}
        log("payload", body);
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 20_000);
        let r: Response;
        try {
          r = await fetch(
            isEditMode && editReportId
              ? `${API_BASE_URL}/reports/${encodeURIComponent(editReportId)}`
              : `${API_BASE_URL}/reports`,
            {
              method: isEditMode ? "PATCH" : "POST",
              headers,
              body: JSON.stringify(body),
              signal: controller.signal,
            },
          );
        } catch (e: any) {
          clearTimeout(id);
          const err = codedError(e?.name === "AbortError" ? "NETWORK_TIMEOUT" : "NETWORK_ERROR");
          log("POST /reports -> throw", err.code, e?.message ?? e);
          throw err;
        } finally {
          clearTimeout(id);
        }
        const raw = await r.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {}
        if (!r.ok) {
          const errorCode = String(data?.error || "");
          const serverMessage = String(
            data?.message || data?.error || raw || "",
          );
          log("POST /reports !ok", {
            status: r.status,
            errorCode,
            serverMessage,
            raw,
          });
          const apiError = new ReportApiError(
            r.status,
            errorCode,
            serverMessage,
          ) as ReportApiError & { testOverrideAllowed?: boolean };
          apiError.testOverrideAllowed = data?.test_override_allowed === true;
          throw apiError;
        }
        log("POST /reports ok", data);
        savedSummaryRef.current = { title: String(body?.title ?? ""), images: pendingImages.length };
        const reportId: string | null = data?.report?.id ?? data?.id ?? null;
        let count = data?.candidates?.length ?? 0;
        let imageUploadHadFailure = false;
        // Match count updates on My cases; do not delay report completion here.
        if (reportId && pendingImages.length > 0) {
          try {
            setUploading(true);
            // --- Upload-diagnostikk ---
            let sessInfo: any = null;
            try {
              const { data: sess } = await supabase.auth.getSession();
              sessInfo = {
                hasSession: !!sess.session,
                userId: sess.session?.user?.id ?? null,
                // Supabase Auth (anon sign-in) gir is_anonymous claim i JWT
                isAnonymous: (sess.session?.user as any)?.is_anonymous ?? null,
              };
            } catch (e: any) {
              sessInfo = {
                hasSession: false,
                userId: null,
                isAnonymous: null,
                error: e?.message ?? String(e),
              };
            }
            log("upload session", sessInfo);
            // Image upload requires an authenticated storage session.
            // Guest upload behavior is handled by the current authenticated flow.
            if (!sessInfo?.hasSession) {
              // Uploads are registered through the backend.
              log("upload note", "No client session is available");
            }
            const results = await Promise.allSettled(
              pendingImages.map(async (uri) => {
                try {
                  return await uploadReportImage(String(reportId), uri);
                } catch (err: any) {
                  const msg = err?.message ?? String(err);
                  throw Object.assign(codedError("IMAGE_UPLOAD_FAILED"), { detail: msg });
                }
              }),
            );
            const ok = results.filter((x) => x.status === "fulfilled").length;
            const failed = results.length - ok;
            const failedDetails = results
              .map((r, idx) => ({ r, idx }))
              .filter(({ r }) => r.status === "rejected")
              .map(({ r, idx }) => ({
                uri: pendingImages[idx],
                reason:
                  (r as PromiseRejectedResult).reason?.message ??
                  String((r as PromiseRejectedResult).reason),
              }));
            log("uploads done", { ok, failed, failedDetails });
            if (failed > 0) {
              imageUploadHadFailure = true;
              reportHandledError(new Error(String(failedDetails[0]?.reason ?? "IMAGE_UPLOAD_FAILED")), "report.image_upload");
              console.warn(
                "[create-report] image upload failed",
                failedDetails,
              );
              setRetryReportId(String(reportId));
              setRetryImageUris(
                failedDetails.map((item) => item.uri).filter(Boolean),
              );
              setImageRetryOpen(true);
            }
          } catch (e: any) {
            imageUploadHadFailure = true;
            log("uploads error", e?.message ?? e);
            setRetryReportId(String(reportId));
            setRetryImageUris([...pendingImages]);
            setImageRetryOpen(true);
          } finally {
            setUploading(false);
          }
        }
        reset();
        requestIdRef.current = null;
        if (!imageUploadHadFailure) {
          setSavedType(type);
          setSavedReportId(reportId ? String(reportId) : null);
          setSavedCount(Number(count) || 0);
          await showSaved();
        }
      } catch (e: any) {
        const code = String(e?.code || "").toUpperCase();
        const testOverrideAllowed = e?.testOverrideAllowed === true;
        // T1.9D: rule and validation answers (4xx) are expected; everything else is reported.
        if (!(e instanceof ReportApiError) || e.status >= 500) {
          reportHandledError(e, isEditMode ? "report.edit" : "report.create", code || undefined);
        }

        if (
          code === "LOST_REPORT_WEEKLY_LIMIT" &&
          testOverrideAllowed &&
          !options?.testOverrideWeeklyLimit
        ) {
          setLimitDialogOpen(true);
          return;
        }

        if (showReportApiError(e, router, t)) return;
        // Already reported to Sentry above, so no second report here.
        const msg = userErrorMessage(e, t, "report.create.could.not.save.the.case.please", null);
        console.log("[create-report] submit error:", code || e?.message);
        Alert.alert(t("report.create.could.not.save"), msg);
      } finally {
        setSaving(false);
        networkSubmitRef.current = false;
      }
    },
    [
      type,
      category,
      subcategoryKey,
      subcategoryCustom,
      computedTitle,
      description,
      color,
      colorSecondary,
      brand,
      rewardNOK,
      latitude,
      longitude,
      locationConfirmed,
      locationLabel,
      occurredAtISO,
      pendingImages,
      reset,
      router,
      subOptions.length,
      dateStr,
      timeStr,
      rewardEnabled,
      activeCurrency,
    ],
  );
  submitRef.current = onSubmit;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={
            isEditMode
              ? t("report.create.edit.lost.report")
              : type === "FOUND"
                ? t("report.create.report.found")
                : t("report.create.report.lost")
          }
          onBack={() => {
            try {
              router.back();
            } catch {}
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: "padding", android: "height" })}
          style={styles.keyboardWrap}
        >
          <ScrollView
            nestedScrollEnabled
            ref={scrollRef}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={closeMenus}
          >
            {/* Premium segmented control */}
            <View style={styles.segmentedOuter}>
              <Pressable
                style={[
                  styles.segmentedItem,
                  type === "LOST" && styles.segmentedItemOn,
                ]}
                onPress={() => {
                  setField("type" as any, "LOST");
                  closeMenus();
                }}
              >
                <Text
                  style={[
                    styles.segmentedTxt,
                    type === "LOST" && styles.segmentedTxtOn,
                  ]}
                >
                  {t("report.create.lost.2")}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.segmentedItem,
                  type === "FOUND" && styles.segmentedItemOn,
                ]}
                onPress={() => {
                  setField("type" as any, "FOUND");
                  closeMenus();
                }}
              >
                <Text
                  style={[
                    styles.segmentedTxt,
                    type === "FOUND" && styles.segmentedTxtOn,
                  ]}
                >
                  {t("report.create.found.2")}
                </Text>
              </Pressable>
            </View>
            {/* CARD: Objekt */}
            <View
              onLayout={(e) => setObjectSectionY(e.nativeEvent.layout.y)}
              style={[styles.card, objectOpen && styles.cardOnTop]}
            >
              <Text style={styles.h2}>{whatLabel}</Text>
              <Text style={styles.caption}>{t("report.create.item.2")}</Text>
              <Text style={styles.muted}>
                {t("report.create.type.what.was.lost.or.found")}
              </Text>

              <View
                style={[styles.selectWrap, objectOpen && styles.selectWrapOn]}
                pointerEvents="box-none"
              >
                <TextInput
                  ref={objectInputRef}
                  style={styles.input}
                  value={objectQuery}
                  onPressIn={() => {
                    if (!objectOpen) setObjectOpen(true);
                    if (catOpen) setCatOpen(false);
                    if (colorOpen) setColorOpen(false);
                    if (color2Open) setColor2Open(false);
                    if (subOpen) setSubOpen(false);
                  }}
                  onChangeText={(txt) => {
                    setObjectQuery(txt);
                    if (!objectOpen) setObjectOpen(true);
                  }}
                  placeholder={t("report.create.type.e.g.wedding.ring.keys")}
                  placeholderTextColor={theme.colors.muted}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {objectOpen && (
                  <View
                    style={[styles.selectMenu, { top: 52 }]}
                    pointerEvents="auto"
                  >
                    {objectQuery.trim().length < 2 ? (
                      <View style={{ padding: theme.space.md }}>
                        <Text style={styles.muted}>
                          {t("report.create.type.at.least.2.characters.to")}
                        </Text>
                      </View>
                    ) : filteredObjects.length === 0 ? (
                      <View style={{ padding: theme.space.md }}>
                        <Text style={styles.muted}>
                          {t("report.create.no.item.found.try.another.word")}
                        </Text>
                      </View>
                    ) : (
                      <ScrollView
                        style={styles.objectResultsScroll}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {filteredObjects.map((hit) => (
                          <Pressable
                            key={`${hit.catKey}:${hit.subKey}`}
                            style={styles.selectItem}
                            onPress={() =>
                              applySubcategoryFromGlobalSearch(
                                hit.catKey,
                                hit.subKey,
                              )
                            }
                          >
                            <Text style={styles.selectItemTxt}>
                              {localizeObjectLabel(
                                hit.subKey,
                                hit.subLabel,
                                language,
                              )}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
              </View>

              <View
                onLayout={(e) => setCategoryAnchorY(e.nativeEvent.layout.y)}
              />
              <Text style={[styles.caption, { marginTop: theme.space.lg }]}>
                {t("report.create.selected.item")}
              </Text>
              <View
                style={[
                  styles.selectedObjectBox,
                  validationMissing.some(
                    (x) => x === "Item" || x === "Gjenstand",
                  ) && styles.inputError,
                ]}
              >
                <Text style={styles.selectedObjectTxt}>{subcategoryLabel}</Text>
              </View>

              {category === "PETS" && subcategoryKey === "CUSTOM" && (
                <>
                  <Text style={[styles.caption, { marginTop: theme.space.md }]}>
                    {t("report.create.specify.pet")}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={subcategoryCustom}
                    onChangeText={(v) =>
                      setField("subcategoryCustom" as any, v)
                    }
                    placeholder={t("report.create.e.g.guinea.pig.turtle.goat")}
                    placeholderTextColor={theme.colors.muted}
                  />
                </>
              )}
            </View>
            {/* CARD: Detaljer */}
            <View
              onLayout={(e) => setDetailsSectionY(e.nativeEvent.layout.y)}
              style={[
                styles.card,
                (colorOpen || color2Open) && styles.cardOnTop,
                validationMissing.includes(validationKey.color) &&
                  styles.cardError,
              ]}
            >
              <Text style={styles.h2}>{t("report.create.details")}</Text>
              <View
                style={[
                  styles.row,
                  { marginTop: theme.space.md, alignItems: "flex-start" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.caption}>
                    {t("report.create.primary.color.2")}
                  </Text>
                  <Pressable
                    style={[
                      styles.selectBtn,
                      validationMissing.includes(validationKey.color) &&
                        styles.inputError,
                    ]}
                    onPress={() => {
                      setColorOpen((v) => !v);
                      setCatOpen(false);
                      setSubOpen(false);
                      setObjectOpen(false);
                    }}
                  >
                    <Text style={styles.selectBtnTxt}>{colorLabel} ▾</Text>
                  </Pressable>
                  {colorOpen && (
                    <View style={styles.selectMenu}>
                      <ScrollView
                        style={{ maxHeight: 260 }}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {COLORS.map((opt) => (
                          <Pressable
                            key={opt.value}
                            style={[
                              styles.selectItem,
                              color === opt.value && styles.selectItemActive,
                            ]}
                            onPress={() => {
                              setField("color" as any, opt.value);
                              setColorOpen(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.selectItemTxt,
                                color === opt.value &&
                                  styles.selectItemTxtActive,
                              ]}
                            >
                              {localizeColorLabel(opt.label, language)}
                            </Text>
                          </Pressable>
                        ))}
                        {!!color && (
                          <Pressable
                            style={styles.selectItem}
                            onPress={() => {
                              setField("color" as any, "");
                              setColorOpen(false);
                            }}
                          >
                            <Text style={styles.selectItemTxt}>
                              {t("report.create.remove.color")}
                            </Text>
                          </Pressable>
                        )}
                      </ScrollView>
                    </View>
                  )}
                  {/* removed stray token */}
                  {validationMissing.includes(validationKey.color) && (
                    <Text style={styles.errorText}>
                      {t("report.create.choose.a.primary.color")}
                    </Text>
                  )}
                  <Text style={[styles.caption, { marginTop: theme.space.md }]}>
                    {t("report.create.secondary.color.optional")}
                  </Text>
                  <Pressable
                    style={styles.selectBtn}
                    onPress={() => {
                      setColor2Open((v) => !v);
                      setColorOpen(false);
                      setCatOpen(false);
                      setSubOpen(false);
                      setObjectOpen(false);
                    }}
                  >
                    <Text style={styles.selectBtnTxt}>{color2Label} ▾</Text>
                  </Pressable>
                  {color2Open && (
                    <View style={styles.selectMenu}>
                      <ScrollView
                        style={{ maxHeight: 260 }}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {COLORS.map((opt) => {
                          const disabled = opt.value === color;
                          return (
                            <Pressable
                              key={opt.value}
                              style={[
                                styles.selectItem,
                                colorSecondary === opt.value &&
                                  styles.selectItemActive,
                                disabled && { opacity: 0.4 },
                              ]}
                              onPress={() => {
                                if (disabled) return;
                                setField("colorSecondary" as any, opt.value);
                                setColor2Open(false);
                              }}
                            >
                              <Text
                                style={[
                                  styles.selectItemTxt,
                                  colorSecondary === opt.value &&
                                    styles.selectItemTxtActive,
                                ]}
                              >
                                {localizeColorLabel(opt.label, language)}
                              </Text>
                            </Pressable>
                          );
                        })}
                        {!!colorSecondary && (
                          <Pressable
                            style={styles.selectItem}
                            onPress={() => {
                              setField("colorSecondary" as any, "");
                              setColor2Open(false);
                            }}
                          >
                            <Text style={styles.selectItemTxt}>
                              {t("report.create.remove.secondary.color")}
                            </Text>
                          </Pressable>
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>
                <View style={{ width: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.caption}>
                    {t("report.create.brand.optional")}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={brand}
                    onChangeText={(v) => setField("brand" as any, v)}
                    placeholder={t("report.create.apple")}
                    placeholderTextColor={theme.colors.muted}
                  />
                </View>
              </View>

              <Text style={[styles.caption, { marginTop: theme.space.lg }]}>
                {t("report.create.comment.optional")}
              </Text>
              <TextInput
                style={[styles.input, { minHeight: 76 }]}
                value={description}
                onChangeText={(v) => setField("description" as any, v)}
                placeholder={t(
                  "report.create.describe.important.details.identifiers.or.handover",
                )}
                placeholderTextColor={theme.colors.muted}
                multiline
              />
            </View>
            {/* CARD: Tid & sted */}
            <View
              onLayout={(e) => setTimeSectionY(e.nativeEvent.layout.y)}
              style={[
                styles.card,
                validationMissing.includes(validationKey.time) &&
                  styles.cardError,
                validationMissing.includes(validationKey.location) &&
                  styles.cardError,
              ]}
            >
              <Text style={styles.h2}>{t("report.create.time.place")}</Text>
              <Text style={styles.muted}>
                {t("report.create.radius.p0", {
                  p0:
                    type === "FOUND" ? `${radiusLabel} (precise)` : radiusLabel,
                })}
              </Text>
              <Text style={styles.caption}>
                {type === "LOST"
                  ? t("report.create.estimated.time.lost")
                  : t("report.create.time.if.known")}
              </Text>
              <View style={[styles.row, { alignItems: "center" }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("report.create.open.calendar")}
                  style={[
                    styles.input,
                    styles.inputCompact,
                    styles.dateButton,
                    { flex: 1 },
                  ]}
                  onPress={() => {
                    closeMenus();
                    setDatePickerOpen(true);
                  }}
                >
                  <Text style={styles.dateButtonText}>
                    {dateStr || t("report.create.choose.date")}
                  </Text>
                  <Ionicons
                    name="calendar-outline"
                    size={20}
                    color={theme.colors.muted}
                  />
                </Pressable>
                <View style={{ width: 8 }} />
                <TextInput
                  style={[styles.input, styles.inputCompact, { flex: 1 }]}
                  value={timeStr}
                  onChangeText={setTimeStr}
                  onEndEditing={syncDateTimeToDraft}
                  placeholder="HH:mm"
                  placeholderTextColor={theme.colors.muted}
                />
              </View>
              <View
                style={[
                  styles.row,
                  { justifyContent: "flex-start", marginTop: theme.space.md },
                ]}
              >
                <Pressable style={styles.chip} onPress={setNow}>
                  <Text style={styles.chipTxt}>{t("report.create.now")}</Text>
                </Pressable>
                <Pressable
                  style={styles.chip}
                  onPress={() => shiftMinutes(-60)}
                >
                  <Text style={styles.chipTxt}>{t("report.create.1.h")}</Text>
                </Pressable>
                <Pressable
                  style={styles.chip}
                  onPress={() => shiftMinutes(-1440)}
                >
                  <Text style={styles.chipTxt}>{t("report.create.1.day")}</Text>
                </Pressable>
              </View>
              <Text style={[styles.caption, { marginTop: theme.space.lg }]}>
                {t("report.create.position")}
              </Text>
              <Text style={styles.muted}>
                {t("report.create.add.one.or.more.possible.places")}
              </Text>
              {searchAreas.length > 0 && (
                <Text style={styles.confirmedText}>
                  {t("report.create.p0.search.area.s.saved", {
                    p0: searchAreas.length,
                  })}
                </Text>
              )}
              <Text
                style={[
                  locationConfirmed
                    ? styles.confirmedText
                    : styles.unconfirmedText,
                ]}
              >
                {locationConfirmed
                  ? t("report.create.location.confirmed")
                  : t("report.create.location.must.be.confirmed.on.the")}
              </Text>
              <Pressable
                style={[
                  styles.mapPreviewWrap,
                  validationMissing.includes(validationKey.location) &&
                    styles.inputError,
                ]}
                onPress={openMap}
              >
                <View pointerEvents="none" style={styles.mapPreviewInner}>
                  <MapView
                    provider={
                      Platform.OS === "android" ? PROVIDER_GOOGLE : undefined
                    }
                    style={StyleSheet.absoluteFill}
                    key={`preview-${latitude}-${longitude}`}
                    initialRegion={previewRegion}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                  >
                    <Marker coordinate={{ latitude, longitude }} />
                  </MapView>
                  <View style={styles.mapPreviewBadge}>
                    <Text style={styles.mapPreviewBadgeTxt}>
                      {t("report.create.tap.to.choose.on.map")}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { marginTop: theme.space.md }]}
                onPress={openMap}
              >
                <Text style={styles.primaryBtnTxt}>
                  {t("report.create.choose.on.map")}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.caption, { marginTop: theme.space.lg }]}>
              {t("report.create.place")}
            </Text>
            <TextInput
              style={styles.input}
              value={locationLabel}
              onChangeText={(v) => {
                setLocationLabel(v);
                setLocationLabelTouched(true);
                setField("locationLabel" as any, v);
              }}
              placeholder={t(
                "report.create.address.place.or.place.description",
              )}
              placeholderTextColor={theme.colors.muted}
            />
            {/* Reward */}
            {type === "LOST" && rewardEnabled && (
              <View style={styles.card}>
                <Text style={styles.h2}>
                  {t("report.create.reward.optional")}
                </Text>
                <Text style={styles.muted}>
                  {t("report.create.reward.is.optional.currency.for.this", {
                    p0: activeCurrency,
                  })}
                </Text>
                <Text style={styles.caption}>
                  {t("report.create.suggestions")}
                </Text>
                <View
                  style={[
                    styles.row,
                    { flexWrap: "wrap", gap: 8, marginTop: theme.space.sm },
                  ]}
                >
                  {[0, 50, 100, 250].map((n) => (
                    <Pressable
                      key={String(n)}
                      style={[
                        styles.chip,
                        Number(rewardNOK) === n && styles.chipOn,
                      ]}
                      onPress={() => setField("rewardNOK" as any, String(n))}
                    >
                      <Text
                        style={[
                          styles.chipTxt,
                          Number(rewardNOK) === n && styles.chipTxtOn,
                        ]}
                      >
                        {n} {activeCurrency}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.caption, { marginTop: theme.space.md }]}>
                  {t("report.create.custom.amount.p0", { p0: activeCurrency })}
                </Text>
                <TextInput
                  style={styles.input}
                  value={String(rewardNOK)}
                  onChangeText={(v) => setField("rewardNOK" as any, v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={theme.colors.muted}
                />
              </View>
            )}
            {type === "LOST" && !rewardEnabled && (
              <View style={styles.card}>
                <Text style={styles.h2}>{t("report.create.reward")}</Text>
                <Text style={styles.muted}>
                  {t("report.create.local.currency.support.is.not.enabled", {
                    p0: activeCurrency,
                  })}
                </Text>
              </View>
            )}
            {/* Bilder */}
            <View
              onLayout={(e) => setImagesSectionY(e.nativeEvent.layout.y)}
              style={styles.card}
            >
              <Text style={styles.h2}>{t("report.create.images")}</Text>
              <View style={[styles.row, { marginTop: theme.space.md }]}>
                <Pressable style={styles.primaryBtn} onPress={addFromGallery}>
                  <Text style={styles.primaryBtnTxt}>
                    {t("report.create.choose.from.gallery")}
                  </Text>
                </Pressable>
                <View style={{ width: 8 }} />
                <Pressable style={styles.primaryBtn} onPress={addFromCamera}>
                  <Text style={styles.primaryBtnTxt}>
                    {t("report.create.take.photo")}
                  </Text>
                </Pressable>
              </View>
              {existingImageUrls.length > 0 && (
                <View style={{ marginTop: theme.space.md }}>
                  <Text style={styles.caption}>
                    {t("report.create.already.saved")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      marginTop: theme.space.sm,
                    }}
                  >
                    {existingImageUrls.map((uri) => (
                      <Image
                        key={uri}
                        source={{ uri }}
                        style={{
                          width: 120,
                          height: 120,
                          borderRadius: theme.radius.md,
                          marginRight: theme.space.md,
                          marginBottom: theme.space.md,
                        }}
                      />
                    ))}
                  </View>
                </View>
              )}
              {pendingImages.length === 0 ? (
                <Text style={styles.muted}>
                  {t("report.create.no.images.selected.yet")}
                </Text>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    marginTop: theme.space.md,
                  }}
                >
                  {pendingImages.map((uri) => (
                    <View
                      key={uri}
                      style={{
                        marginRight: theme.space.md,
                        marginBottom: theme.space.md,
                      }}
                    >
                      <Image
                        source={{ uri }}
                        style={{
                          width: 120,
                          height: 120,
                          borderRadius: theme.radius.md,
                        }}
                      />
                      <Pressable
                        onPress={() => removePending(uri)}
                        style={{ marginTop: theme.space.xs }}
                      >
                        <Text
                          style={{
                            color: theme.colors.danger,
                            fontWeight: "800",
                          }}
                        >
                          {t("report.create.remove")}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
            {/* CTA */}
            <Pressable
              style={[styles.ctaBtn, saving && { opacity: 0.7 }]}
              onPress={() => void onSubmit()}
              disabled={saving || uploading || editLoading}
            >
              <Text style={styles.ctaTxt}>
                {saving
                  ? t("report.create.saving")
                  : editLoading
                    ? t("report.create.loading.case")
                    : uploading
                      ? t("report.create.saving.uploading")
                      : isEditMode
                        ? t("report.create.save.changes")
                        : type === "FOUND"
                          ? t("report.create.report.found.item")
                          : t("report.create.report.lost.item")}{" "}
              </Text>
            </Pressable>
            <View style={{ height: theme.space.xl }} />
          </ScrollView>
        </KeyboardAvoidingView>
        <Modal
          visible={validationOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setValidationOpen(false)}
        >
          <View style={modalStyles.backdrop}>
            <View style={modalStyles.card}>
              <View style={[modalStyles.icon, { backgroundColor: "#FEF3C7" }]}>
                <Text style={[modalStyles.iconTxt, { color: "#B45309" }]}>
                  !
                </Text>
              </View>
              <Text style={modalStyles.title}>
                {t("report.create.the.report.is.incomplete")}
              </Text>
              <Text style={modalStyles.body}>
                {t(
                  "report.create.complete.the.highlighted.fields.before.submitting",
                )}
              </Text>
              <View style={styles.missingList}>
                {validationMissing.map((item) => (
                  <Text key={item} style={styles.missingItem}>
                    • {item}
                  </Text>
                ))}
              </View>
              <Pressable
                style={[
                  modalStyles.btn,
                  modalStyles.btnStacked,
                  modalStyles.btnPrimary,
                  { marginTop: 16 },
                ]}
                onPress={() => setValidationOpen(false)}
              >
                <Text style={modalStyles.btnPrimaryTxt}>
                  {t("report.create.go.to.first.missing.field")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        <Modal
          visible={datePickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDatePickerOpen(false)}
        >
          <View style={modalStyles.backdrop}>
            <View style={modalStyles.card}>
              <Text style={modalStyles.title}>
                {t("report.create.choose.date")}
              </Text>
              <Text style={modalStyles.body}>
                {t("report.create.date.cannot.be.in.future")}
              </Text>
              <View style={styles.datePickerWrap}>
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  maximumDate={new Date()}
                  onChange={(_, value) => {
                    if (Platform.OS === "android" && !value)
                      setDatePickerOpen(false);
                    if (value) applySelectedDate(value);
                  }}
                />
              </View>
              {Platform.OS === "ios" && (
                <Pressable
                  style={[
                    modalStyles.btn,
                    modalStyles.btnStacked,
                    modalStyles.btnOutline,
                  ]}
                  onPress={() => setDatePickerOpen(false)}
                >
                  <Text style={modalStyles.btnOutlineTxt}>
                    {t("report.create.close")}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
        <Modal
          visible={photoPromptOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoPromptOpen(false)}
        >
          <View style={modalStyles.backdrop}>
            <View style={modalStyles.card}>
              <View style={[modalStyles.icon, { backgroundColor: "#EEF2FF" }]}>
                <Text
                  style={[modalStyles.iconTxt, { color: theme.colors.primary }]}
                >
                  +
                </Text>
              </View>
              <Text style={modalStyles.title}>
                {t("report.create.continue.without.a.photo")}
              </Text>
              <Text style={modalStyles.body}>
                {t("report.create.a.photo.can.make.the.item")}
              </Text>
              <View style={modalStyles.actions}>
                <Pressable
                  style={[modalStyles.btn, modalStyles.btnOutline]}
                  onPress={() => {
                    setPhotoPromptOpen(false);
                    requestAnimationFrame(() =>
                      scrollRef.current?.scrollTo({
                        y: Math.max(0, imagesSectionY - 12),
                        animated: true,
                      }),
                    );
                  }}
                >
                  <Text style={modalStyles.btnOutlineTxt}>
                    {t("report.create.add.photo")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[modalStyles.btn, modalStyles.btnPrimary]}
                  onPress={() => {
                    setPhotoPromptOpen(false);
                    setContinueWithoutImage(true);
                    setTimeout(() => {
                      void submitRef.current({ allowWithoutImage: true });
                    }, 0);
                  }}
                >
                  <Text style={modalStyles.btnPrimaryTxt}>
                    {t("report.create.continue")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          visible={limitDialogOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setLimitDialogOpen(false)}
        >
          <View style={modalStyles.backdrop}>
            <View style={modalStyles.card}>
              <View style={[modalStyles.icon, { backgroundColor: "#FEF3C7" }]}>
                <Text style={[modalStyles.iconTxt, { color: "#B45309" }]}>
                  !
                </Text>
              </View>
              <Text style={modalStyles.title}>
                {t("report.create.report.limit.reached.2")}
              </Text>
              <Text style={modalStyles.body}>
                {t("report.create.you.can.normally.create.up.to")}
              </Text>
              <Pressable
                style={[
                  modalStyles.btn,
                  modalStyles.btnStacked,
                  modalStyles.btnPrimary,
                  { marginTop: 16 },
                ]}
                onPress={() => {
                  setLimitDialogOpen(false);
                  setTimeout(
                    () =>
                      void submitRef.current({
                        testOverrideWeeklyLimit: true,
                        allowWithoutImage: true,
                      }),
                    0,
                  );
                }}
              >
                <Text style={modalStyles.btnPrimaryTxt}>
                  {t("report.create.create.anyway")}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  modalStyles.btn,
                  modalStyles.btnStacked,
                  modalStyles.btnOutline,
                  { marginTop: 10 },
                ]}
                onPress={() => {
                  setLimitDialogOpen(false);
                  router.replace("/my-reports");
                }}
              >
                <Text style={modalStyles.btnOutlineTxt}>
                  {t("report.create.open.my.cases.2")}
                </Text>
              </Pressable>
              <Pressable
                style={styles.dialogTextBtn}
                onPress={() => setLimitDialogOpen(false)}
              >
                <Text style={styles.dialogText}>
                  {t("report.create.cancel.2")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        <Modal
          visible={imageRetryOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setImageRetryOpen(false)}
        >
          <View style={modalStyles.backdrop}>
            <View style={modalStyles.card}>
              <View style={[modalStyles.icon, { backgroundColor: "#FEF3C7" }]}>
                <Text style={[modalStyles.iconTxt, { color: "#B45309" }]}>
                  !
                </Text>
              </View>
              <Text style={modalStyles.title}>
                {t("report.create.the.report.was.saved")}
              </Text>
              <Text style={modalStyles.body}>
                {t("report.create.the.image.could.not.be.uploaded.3")}
              </Text>
              <Pressable
                style={[
                  modalStyles.btn,
                  modalStyles.btnStacked,
                  modalStyles.btnPrimary,
                  { marginTop: 16 },
                ]}
                disabled={uploading}
                onPress={() => void retryImagesOnly()}
              >
                <Text style={modalStyles.btnPrimaryTxt}>
                  {uploading
                    ? t("report.create.uploading.image")
                    : t("report.create.try.image.again")}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  modalStyles.btn,
                  modalStyles.btnStacked,
                  modalStyles.btnOutline,
                  { marginTop: 10 },
                ]}
                onPress={() => {
                  setImageRetryOpen(false);
                  router.replace("/my-reports");
                }}
              >
                <Text style={modalStyles.btnOutlineTxt}>
                  {t("report.create.open.my.cases.3")}
                </Text>
              </Pressable>
              <Pressable
                style={styles.dialogTextBtn}
                onPress={() => setImageRetryOpen(false)}
              >
                <Text style={styles.dialogText}>
                  {t("report.create.close")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        {/* Lagret-modal (proff) */}
        <Modal
          visible={savedOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setSavedOpen(false)}
        >
          <Pressable
            style={modalStyles.backdrop}
            onPress={() => setSavedOpen(false)}
          >
            <Pressable style={modalStyles.card} onPress={() => {}}>
              <View style={modalStyles.icon}>
                <Text style={modalStyles.iconTxt}>✓</Text>
              </View>
              <Text style={modalStyles.title}>
                {isEditMode
                  ? t("report.create.case.updated")
                  : t("report.create.case.created")}
              </Text>
              <Text style={modalStyles.body}>
                {isEditMode
                  ? t("report.create.the.report.has.been.updated.matches")
                  : savedReportId
                    ? savedCount > 0
                      ? t(
                          "report.create.case.created.p0.suggested.matches.p1",
                          { p0: savedTypeLabel, p1: savedCount },
                        )
                      : t(
                          "report.create.case.created.p0.matches.are.updating",
                          { p0: savedTypeLabel },
                        )
                    : t("report.create.case.created.p0", {
                        p0: savedTypeLabel,
                      })}
              </Text>
              <View style={modalStyles.actions}>
                <Pressable
                  style={[modalStyles.btn, modalStyles.btnOutline]}
                  onPress={() => {
                    setSavedOpen(false);
                    router.replace("/");
                  }}
                >
                  <Text style={modalStyles.btnOutlineTxt}>
                    {t("report.create.to.home")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    modalStyles.btn,
                    modalStyles.btnPrimary,
                    !savedReportId && { opacity: 0.4 },
                  ]}
                  disabled={!savedReportId}
                  onPress={() => {
                    if (!savedReportId) return;
                    setSavedOpen(false);
                    router.push({
                      pathname: "/match",
                      params: { reportId: savedReportId },
                    });
                  }}
                >
                  <Text style={modalStyles.btnPrimaryTxt}>
                    {t("report.create.view.matches")}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  keyboardWrap: { flex: 1, backgroundColor: theme.colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.sm,
    backgroundColor: theme.colors.bg,
  },
  topBarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  topBarBtnTxt: {
    fontSize: 26,
    fontWeight: "900",
    color: theme.colors.text,
    marginTop: -2,
  },
  topBarTitle: {
    flex: 1,
    textAlign: "center",
    marginHorizontal: theme.space.sm,
    fontSize: 16,
    fontWeight: "900",
    color: theme.colors.text,
    fontFamily: "Inter_800ExtraBold",
  },
  container: {
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: 80,
    backgroundColor: theme.colors.bg,
    flexGrow: 1,
  },
  row: { flexDirection: "row" },
  card: {
    position: "relative",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.space.lg,
    marginTop: theme.space.md,
    ...theme.shadow.card,
  },
  // Raise the card while a dropdown is open so the menu remains visible.
  inputError: {
    borderColor: theme.colors.danger,
    borderWidth: 1.5,
    backgroundColor: "#FFF7F7",
  },
  cardError: { borderColor: theme.colors.danger, borderWidth: 1.5 },
  errorText: {
    marginTop: 7,
    color: theme.colors.danger,
    fontWeight: "800",
    fontSize: 12,
  },
  confirmedText: {
    marginTop: 9,
    color: "#15803D",
    fontWeight: "800",
    fontSize: 12,
  },
  unconfirmedText: {
    marginTop: 9,
    color: "#B45309",
    fontWeight: "800",
    fontSize: 12,
  },
  missingList: {
    marginTop: 14,
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    padding: 12,
  },
  missingItem: { color: "#9A3412", fontWeight: "800", marginVertical: 2 },
  dialogTextBtn: { marginTop: 12, paddingVertical: 9, alignItems: "center" },
  dialogText: { color: theme.colors.muted, fontWeight: "800" },
  cardOnTop: {
    zIndex: 5000,
    ...Platform.select({ android: { elevation: 30 } }),
  },
  h2: {
    fontSize: theme.type.h2,
    fontWeight: "800",
    color: theme.colors.text,
    fontFamily: "Inter_800ExtraBold",
  },
  caption: {
    fontSize: theme.type.caption,
    fontWeight: "700",
    color: theme.colors.muted,
    marginTop: theme.space.md,
    fontFamily: "Inter_700Bold",
  },
  muted: {
    fontSize: theme.type.caption,
    fontWeight: "600",
    color: theme.colors.muted,
    marginTop: theme.space.sm,
    fontFamily: "Inter_600SemiBold",
  },
  labelSmall: {
    fontSize: theme.type.small,
    fontWeight: "700",
    color: theme.colors.muted,
    marginTop: theme.space.md,
    fontFamily: "Inter_600SemiBold",
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.inputBg,
    marginTop: theme.space.sm,
    color: theme.colors.text,
    fontSize: theme.type.body,
    fontFamily: "Inter_400Regular",
  },
  // Compact date and time input variant.
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  dateButtonText: {
    color: theme.colors.text,
    fontSize: theme.type.body,
    fontFamily: "Inter_400Regular",
  },
  datePickerWrap: {
    marginTop: 12,
    marginBottom: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  inputCompact: {
    marginTop: 0,
    paddingVertical: 10,
  },
  selectWrap: { position: "relative", marginTop: theme.space.sm },
  objectResultsScroll: { maxHeight: 260 },
  selectWrapOn: {
    zIndex: 9999,
    ...(Platform.OS === "android" ? { elevation: 9999 } : {}),
  },
  selectBtn: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    marginTop: theme.space.sm,
  },
  selectBtnTxt: {
    fontWeight: "800",
    color: theme.colors.text,
    fontSize: theme.type.body,
  },
  selectMenu: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    zIndex: 9999,
    ...Platform.select({
      android: { elevation: 50 },
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        fontFamily: "Inter_700Bold",
      },
    }),
  },
  selectItem: { paddingVertical: 12, paddingHorizontal: theme.space.lg },
  selectItemActive: { backgroundColor: "#F1F5F9" },
  selectItemTxt: {
    color: theme.colors.text,
    fontSize: theme.type.body,
    fontWeight: "700",
  },
  selectItemTxtActive: { fontWeight: "800", color: theme.colors.primary },
  selectedObjectBox: {
    marginTop: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
  },
  selectedObjectTxt: {
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: theme.type.body,
  },
  selectHeader: {
    paddingVertical: 10,
    paddingHorizontal: theme.space.lg,
    backgroundColor: "#F8FAFC",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  selectHeaderTxt: {
    color: theme.colors.muted,
    fontWeight: "900",
    fontSize: 12,
  },
  // Segmented control
  segmentedOuter: {
    flexDirection: "row",
    backgroundColor: theme.colors.chipBg,
    borderRadius: theme.radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.space.md,
    fontFamily: "Inter_600SemiBold",
  },
  segmentedItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentedItemOn: {
    backgroundColor: theme.colors.primary,
  },
  segmentedTxt: {
    fontSize: theme.type.body,
    fontFamily: "Inter_400Regular",
    fontWeight: "800",
    color: theme.colors.text,
  },
  segmentedTxtOn: {
    color: "#fff",
  },
  chip: {
    backgroundColor: theme.colors.chipBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    marginRight: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipTxt: { fontWeight: "800", color: theme.colors.text },
  chipOn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipTxtOn: { color: "#fff" },
  primaryBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Inter_700Bold",
  },
  primaryBtnTxt: {
    color: "#fff",
    fontWeight: "800",
    fontSize: theme.type.body,
  },
  ctaBtn: {
    marginTop: theme.space.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
    fontFamily: "Inter_700Bold",
  },
  ctaTxt: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    textAlign: "center",
    width: "100%",
    lineHeight: 22,
  },
  // Location map preview.
  mapPreviewWrap: {
    marginTop: theme.space.sm,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    ...theme.shadow.card,
  },
  mapPreviewInner: {
    height: 160,
    position: "relative",
  },
  mapPreviewBadge: {
    position: "absolute",
    right: 10,
    top: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mapPreviewBadgeTxt: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
  },
});
const modalStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
    ...theme.shadow.card,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  iconTxt: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    marginTop: -2,
  },
  title: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "900",
    color: theme.colors.text,
    textAlign: "center",
    fontFamily: "Inter_800ExtraBold",
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.muted,
    textAlign: "center",
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  btnStacked: {
    flex: 0,
    width: "100%",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  btnPrimary: {
    backgroundColor: theme.colors.primary,
  },
  btnPrimaryTxt: {
    color: "#fff",
    fontWeight: "900",
  },
  btnOutline: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  btnOutlineTxt: {
    color: theme.colors.text,
    fontWeight: "900",
  },
});
