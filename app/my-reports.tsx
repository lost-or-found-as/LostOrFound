// app/my-reports.tsx
// Mine saker (language package A)
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  View,
  Alert,
  Modal,
} from "react-native";
import {
  Stack,
  useRouter,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { supabase } from "../src/lib/supabase";
import { API_BASE_URL } from "../src/lib/config";
import { theme } from "../src/ui/theme";
import { getLastSeenMap } from "../src/lib/unread";
import { useAuth } from "../src/contexts/AuthContext";
import { SUBCATEGORIES, OBJECT_LABELS_EN } from "../src/lib/categories";
import { shortPlace } from "../src/lib/places";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { AuthHeaderAction } from "../src/ui/AuthHeaderAction";
import { useI18n } from "../src/i18n/I18nProvider";
import {
  activateTestReportOrder,
  createReportOrder,
} from "../src/lib/reportCommerce";
import { REPORT_PRODUCT_CODES } from "../src/lib/reportProducts";

type Report = {
  id: string;
  type: "LOST" | "FOUND";
  title?: string;
  created_at: string;
  occurred_at?: string | null;
  category?: string;
  subcategory_key?: string;
  color?: string | null;
  brand?: string | null;
  lat?: number | null;
  lng?: number | null;
  location_label?: string | null;
  status?: "ACTIVE" | "CLOSED" | "EXPIRED" | "ARCHIVED" | string | null;
  visible_until?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  last_extended_at?: string | null;
  extension_count?: number | null;
};

type LastActivity = {
  at: string;
  sender_id: string;
  body: string;
  match_id?: string;
};

type Translate = ReturnType<typeof useI18n>["t"];
type MessageInsert = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function colorLabel(v?: string | null, language: "no" | "en" = "no") {
  if (!v) return null;
  const noMap: Record<string, string> = {
    black: "Svart",
    white: "Hvit",
    gray: "Grå",
    grey: "Grå",
    red: "Rød",
    orange: "Oransje",
    yellow: "Gul",
    green: "Grønn",
    blue: "Blå",
    purple: "Lilla",
    brown: "Brun",
    pink: "Rosa",
    beige: "Beige",
    gold: "Gull",
    silver: "Sølv",
  };
  const enMap: Record<string, string> = {
    black: "Black",
    white: "White",
    gray: "Gray",
    red: "Red",
    orange: "Orange",
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    purple: "Purple",
    brown: "Brown",
    pink: "Pink",
    beige: "Beige",
    gold: "Gold",
    silver: "Silver",
    grey: "Gray",
  };
  const map = language === "en" ? enMap : noMap;
  return map[String(v).toLowerCase()] ?? v;
}

function titleCase(s?: string | null) {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const SUBCATEGORY_LABELS_EN: Record<string, string> = {
  ...OBJECT_LABELS_EN,
  KEYCHAIN: "Keychain",
  GLASSES_CASE: "Glasses case",
  ACCESS_CARD: "Access card",
  TRAVEL_CARD: "Travel card",
  STUDENT_CARD: "Student card",
  MEDICATION: "Medication",
  TOILETRY_BAG: "Toiletry bag",
  CHARGING_CASE: "Charging case",
  CHARGER: "Charger",
  CHARGING_CABLE: "Charging cable",
  SPEAKER: "Speaker",
  GAME_CONSOLE: "Game console",
  STYLUS: "Stylus",
  GPS_DEVICE: "GPS",
  TRACKER_TAG: "Tracker tag",
  PHONE_CASE: "Phone case",
  SPORTS_BAG: "Sports bag",
  CAMERA_BAG: "Camera bag",
  TOOL_BAG: "Tool bag",
  SHOPPING_BAG: "Shopping bag",
  SWEATER: "Sweater",
  TROUSERS: "Trousers",
  DRESS: "Dress",
  SHIRT: "Shirt",
  CAP: "Cap",
  BOOTS: "Boots",
  WEDDING_RING: "Wedding ring",
  ENGAGEMENT_RING: "Engagement ring",
  SIGNET_RING: "Signet ring",
  PENDANT: "Pendant",
  BROOCH: "Brooch",
  CUFFLINKS: "Cufflinks",
  MEASURING_TOOL: "Measuring tool",
  POWER_TOOL: "Power tool",
  BIKE_HELMET: "Bike helmet",
  VEHICLE_ACCESSORY: "Vehicle accessory",
  PADEL_RACKET: "Padel racket",
  GOLF_CLUB: "Golf club",
  GOLF_BAG: "Golf bag",
  HIKING_BACKPACK: "Hiking backpack",
  SLEEPING_BAG: "Sleeping bag",
  MUSICAL_INSTRUMENT: "Musical instrument",
  NOTEBOOK: "Notebook",
  CRAFT_ITEM: "Craft item",
  STROLLER: "Stroller",
  STUFFED_TOY: "Stuffed toy",
  PACIFIER: "Pacifier",
  LUNCH_BOX: "Lunch box",
  TOY: "Toy",
  CHILD_BACKPACK: "Child backpack",
  OTHER_CHILDREN: "Other child/family item",
  GUINEA_PIG: "Guinea pig",
  TURTLE: "Turtle",
  REPTILE: "Reptile",

  KEYS: "Keys",
  WALLET: "Wallet",
  MOBILE_PHONE: "Mobile phone",
  SUNGLASSES: "Sunglasses",
  GLASSES: "Glasses",
  BANK_CARD: "Bank card",
  ID_CARD: "ID card",
  PASSPORT: "Passport",
  DRIVER_LICENSE: "Driver license",
  HEARING_AID: "Hearing aid",
  OTHER_PERSONAL: "Other personal item",
  HEADPHONES: "Headphones / AirPods",
  SMARTWATCH: "Smartwatch",
  TABLET: "Tablet",
  LAPTOP: "Laptop",
  POWERBANK: "Power bank",
  CAMERA: "Camera",
  OTHER_ELECTRONICS: "Other electronics",
  BACKPACK: "Backpack",
  HANDBAG: "Handbag",
  SUITCASE: "Suitcase",
  GYM_BAG: "Gym bag",
  LAPTOP_BAG: "Laptop bag",
  SHOULDER_BAG: "Shoulder bag",
  DOCUMENT_BRIEFCASE: "Document case",
  SCHOOL_BAG: "School bag",
  TRAVEL_LUGGAGE: "Travel luggage",
  TOTE_BAG: "Tote bag",
  OTHER_BAGS: "Other bag/luggage",
  JACKET: "Jacket",
  HAT: "Hat",
  GLOVES: "Gloves",
  SCARF: "Scarf",
  BELT: "Belt",
  SHOES: "Shoes",
  UMBRELLA: "Umbrella",
  OTHER_CLOTHING: "Other clothing/accessory",
  RING: "Ring",
  EARRINGS: "Earrings",
  NECKLACE: "Necklace",
  BRACELET: "Bracelet",
  WATCH: "Watch",
  OTHER_JEWELRY: "Other jewelry",
  TOOLS: "Tools",
  OTHER_TOOLS: "Other tools",
  CAR_KEYS: "Car keys",
  BICYCLE: "Bicycle",
  SCOOTER: "Scooter",
  OTHER_VEHICLE: "Other vehicle/transport",
  FOOTBALL: "Football",
  TENNIS_RACKET: "Tennis racket",
  FISHING_ROD: "Fishing rod",
  HEADLAMP: "Headlamp",
  CAMPING_GEAR: "Camping gear",
  SKIS: "Skis",
  SNOWBOARD: "Snowboard",
  HELMET: "Helmet",
  GOGGLES: "Goggles",
  WATER_BOTTLE: "Water bottle",
  OTHER_SPORT: "Other sport/outdoor item",
  BOOK: "Book",
  OTHER_HOBBY: "Other culture/hobby item",
  DOG: "Dog",
  CAT: "Cat",
  BIRD: "Bird",
  RABBIT: "Rabbit",
  OTHER_PET: "Other pet",
  CUSTOM: "Custom",
};

function subcategoryLabel(
  cat?: string,
  sub?: string,
  language: "no" | "en" = "no",
) {
  if (!cat || !sub) return null;
  if (language === "en") return SUBCATEGORY_LABELS_EN[sub] ?? sub;
  const list = (SUBCATEGORIES as any)[cat] ?? [];
  return list.find((x: any) => x.value === sub)?.label ?? sub;
}

function objectPhrase(r: Report, language: "no" | "en", t: Translate) {
  const sub = subcategoryLabel(r.category, r.subcategory_key, language);
  const color = colorLabel(r.color, language);
  if (!sub) return r.title || t("cases.item");
  if (!color) return sub.toLowerCase();
  if (language === "en") return `${color.toLowerCase()} ${sub.toLowerCase()}`;
  const metal = String(r.color || "").toLowerCase();
  const compounds: Record<string, Record<string, string>> = {
    gold: {
      RING: "gullring",
      WEDDING_RING: "gullgiftering",
      ENGAGEMENT_RING: "gullforlovelsesring",
      SIGNET_RING: "gullsignetring",
      WATCH: "gullklokke",
      BRACELET: "gullarmbånd",
      NECKLACE: "gullhalskjede",
      EARRINGS: "gulløredobber",
      PENDANT: "gullanheng",
      BROOCH: "gullbrosje",
      CUFFLINKS: "gullmansjettknapper",
    },
    silver: {
      RING: "sølvring",
      WEDDING_RING: "sølvgiftering",
      ENGAGEMENT_RING: "sølvforlovelsesring",
      SIGNET_RING: "sølvsignetring",
      WATCH: "sølvklokke",
      BRACELET: "sølvarmbånd",
      NECKLACE: "sølvhalskjede",
      EARRINGS: "sølvøredobber",
      PENDANT: "sølvanheng",
      BROOCH: "sølvbrosje",
      CUFFLINKS: "sølvmansjettknapper",
    },
    bronze: {
      RING: "bronsering",
      WATCH: "bronseklokke",
      BRACELET: "bronsearmbånd",
      NECKLACE: "bronsehalskjede",
      PENDANT: "bronseanheng",
    },
  };
  return (
    compounds[metal]?.[String(r.subcategory_key || "").toUpperCase()] ||
    `${color.toLowerCase()} ${sub.toLowerCase()}`
  );
}
function prettyReportTitle(r: Report, language: "no" | "en", t: Translate) {
  const typ = r.type === "LOST" ? t("cases.lost") : t("cases.found");
  const core = objectPhrase(r, language, t);
  const brand = titleCase(r.brand);
  const tail = brand ? ` (${brand})` : "";
  const placeShort = shortPlace(r.location_label);
  const place = placeShort ? ` ${t("cases.in")} ${placeShort}` : "";
  return `${typ}: ${core}${tail}${place}`;
}

function reportStatusInfo(r: Report, language: "no" | "en", t: Translate) {
  if ((r as any).status === "ARCHIVED" || (r as any).archived_at)
    return { label: t("cases.archived") };
  if ((r as any).closed_at || (r as any).status === "CLOSED")
    return { label: t("cases.closed") };
  if (
    (r as any).status === "EXPIRED" ||
    ((r as any).visible_until &&
      Date.parse((r as any).visible_until) <= Date.now())
  )
    return { label: t("cases.expired") };
  if ((r as any).visible_until) {
    const daysLeft = Math.ceil(
      (Date.parse((r as any).visible_until) - Date.now()) /
        (24 * 60 * 60 * 1000),
    );
    if (Number.isFinite(daysLeft) && daysLeft >= 0)
      return { label: t("cases.active.days.left", { count: daysLeft }) };
  }
  return { label: t("cases.active") };
}
function canExtendFound(r: Report) {
  if (
    r.type !== "FOUND" ||
    r.closed_at ||
    r.status === "CLOSED" ||
    r.status === "ARCHIVED"
  )
    return false;
  if (Number(r.extension_count || 0) >= 2) return false;
  const until = Date.parse(r.visible_until || "");
  if (!Number.isFinite(until)) return true;
  return until - Date.now() <= 7 * 24 * 60 * 60 * 1000;
}

function lifecycleErrorCopy(code: string | undefined, t: (key: any) => string) {
  switch (String(code || "").toUpperCase()) {
    case "FOUND_EXTENSION_TOO_EARLY":
      return {
        title: t("reports.extendTooEarlyTitle"),
        body: t("reports.extendTooEarlyBody"),
      };
    case "FOUND_EXTENSION_LIMIT":
      return {
        title: t("reports.extendLimitTitle"),
        body: t("reports.extendLimitBody"),
      };
    case "FOUND_MAX_AGE_REACHED":
      return { title: t("reports.maxAgeTitle"), body: t("reports.maxAgeBody") };
    case "REPORT_CLOSED":
      return { title: t("reports.closedTitle"), body: t("reports.closedBody") };
    default:
      return null;
  }
}

function shortMessage(body?: string) {
  if (!body) return "";
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length <= 70) return t;
  return t.slice(0, 67) + "…";
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sortReportsByActivity(
  reports: Report[],
  activityByReport: Record<string, LastActivity | null>,
) {
  const getKey = (r: Report) => activityByReport[r.id]?.at ?? r.created_at;
  return [...reports].sort((a, b) => {
    const ak = new Date(getKey(a)).getTime();
    const bk = new Date(getKey(b)).getTime();
    return bk - ak;
  });
}

function MyReportsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    section?: string;
    reportId?: string;
  }>();
  const { user } = useAuth();
  const { language, t } = useI18n();
  const [reports, setReports] = useState<Report[]>([]);
  const [unreadByReport, setUnreadByReport] = useState<Record<string, boolean>>(
    {},
  );
  const [activityByReport, setActivityByReport] = useState<
    Record<string, LastActivity | null>
  >({});
  const [matchCountByReport, setMatchCountByReport] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"active" | "history">(
    params.section === "history" ? "history" : "active",
  );
  const [confirmDialog, setConfirmDialog] = useState<{
    kind: "extend" | "reactivateLost" | "close" | "delete";
    report: Report;
  } | null>(null);
  const [reactivatingReportId, setReactivatingReportId] = useState<
    string | null
  >(null);
  const [reactivationSuccessOpen, setReactivationSuccessOpen] = useState(false);
  const matchToReportRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (params.section === "history" || params.section === "active") {
      setSection(params.section);
    }
  }, [params.section]);
  const lastSeenMapRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token || !user) {
        setReports([]);
        setUnreadByReport({});
        setActivityByReport({});
        setMatchCountByReport({});
        matchToReportRef.current = {};
        lastSeenMapRef.current = {};
        return;
      }

      lastSeenMapRef.current = await getLastSeenMap();
      const res = await fetch(`${API_BASE_URL}/reports/mine/with-activity`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ?? t("cases.could.not.load.cases.activity"),
        );
      }

      const reps: Report[] = data.reports ?? [];
      const matchToReport: Record<string, string> = data.matchToReport ?? {};
      const historyMatchToReport: Record<string, string> =
        data.historyMatchToReport ?? {};
      const allMatchToReport: Record<string, string> = {
        ...historyMatchToReport,
        ...matchToReport,
      };
      const lastMessages: Array<{
        conversation_id: string;
        sender_id: string;
        body: string;
        created_at: string;
      }> = data.lastMessages ?? [];

      const reportToMatches: Record<string, string[]> = {};
      for (const [mid, rid] of Object.entries(allMatchToReport)) {
        if (!rid) continue;
        if (!reportToMatches[rid]) reportToMatches[rid] = [];
        reportToMatches[rid].push(mid);
      }
      const matchCounts: Record<string, number> = {};
      for (const r of reps) {
        matchCounts[r.id] = (reportToMatches[r.id] ?? []).length;
      }

      const lastByMatch: Record<string, LastActivity> = {};
      for (const row of lastMessages) {
        const mid = String(row.conversation_id);
        lastByMatch[mid] = {
          at: String(row.created_at),
          sender_id: String(row.sender_id),
          body: String(row.body ?? ""),
          match_id: mid,
        };
      }

      const unread: Record<string, boolean> = {};
      const activity: Record<string, LastActivity | null> = {};
      for (const r of reps) {
        const matchIds = reportToMatches[r.id] ?? [];
        let hasUnread = false;
        let latest: LastActivity | null = null;
        for (const mid of matchIds) {
          const lastSeen = lastSeenMapRef.current[mid];
          const lastAct = lastByMatch[mid];
          if (!lastAct) continue;
          if (!latest || new Date(lastAct.at) > new Date(latest.at)) {
            latest = lastAct;
          }
          const isNewerThanSeen =
            !lastSeen || new Date(lastAct.at) > new Date(lastSeen);
          const fromOther = lastAct.sender_id !== user.id;
          if (isNewerThanSeen && fromOther) hasUnread = true;
        }
        unread[r.id] = hasUnread;
        activity[r.id] = latest;
      }

      matchToReportRef.current = allMatchToReport;
      setUnreadByReport(unread);
      setActivityByReport(activity);
      setMatchCountByReport(matchCounts);
      setReports(sortReportsByActivity(reps, activity));
    } catch (e) {
      console.warn(t("cases.could.not.load.cases.unread"), e);
      setReports([]);
      setUnreadByReport({});
      setActivityByReport({});
      setMatchCountByReport({});
      matchToReportRef.current = {};
      lastSeenMapRef.current = {};
    } finally {
      setLoading(false);
    }
  }, [user, language]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load]),
  );

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("realtime:my-cases-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const msg = payload?.new as MessageInsert | undefined;
          if (!msg?.conversation_id || !msg?.sender_id || !msg?.created_at)
            return;
          const reportId = matchToReportRef.current[msg.conversation_id];
          if (!reportId) return;

          const newActivity: LastActivity = {
            at: msg.created_at,
            sender_id: msg.sender_id,
            body: String(msg.body ?? ""),
            match_id: msg.conversation_id,
          };

          if (msg.sender_id !== user.id) {
            const lastSeen = lastSeenMapRef.current[msg.conversation_id];
            const isNewerThanSeen =
              !lastSeen || new Date(msg.created_at) > new Date(lastSeen);
            if (isNewerThanSeen) {
              setUnreadByReport((prev) => {
                if (prev[reportId] === true) return prev;
                return { ...prev, [reportId]: true };
              });
            }
          }

          setActivityByReport((prev) => {
            const next = { ...prev, [reportId]: newActivity };
            setReports((prevReports) =>
              sortReportsByActivity(prevReports, next),
            );
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const openReport = (r: Report) => {
    router.push({ pathname: "/report-details/[id]", params: { id: r.id } });
  };

  const editReport = (r: Report) => {
    router.push({
      pathname: "/(report)/create-report",
      params: { editReportId: r.id },
    });
  };

  const deleteReport = async (id: string) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      Alert.alert(
        t("cases.error"),
        t("cases.you.must.be.logged.in.to.delete.this.case"),
      );
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/reports/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      Alert.alert(t("cases.delete.failed"), t("cases.delete.failed.body"));
      return;
    }

    setReports((prev) => prev.filter((r) => r.id !== id));
    setUnreadByReport((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setActivityByReport((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setMatchCountByReport((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    load();
  };

  const extendFoundReport = async (r: Report) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      Alert.alert(t("cases.error"), t("cases.you.must.be.logged.in"));
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/reports/${encodeURIComponent(r.id)}/extend-found`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const friendly = lifecycleErrorCopy(data?.error, t);
      Alert.alert(
        friendly?.title || t("cases.could.not.extend"),
        friendly?.body || data?.message || t("cases.please.try.again.later"),
      );
      return;
    }
    await load();
  };

  const confirmExtendFound = (r: Report) =>
    setConfirmDialog({ kind: "extend", report: r });
  const reactivateLostReport = async (r: Report) => {
    try {
      setReactivatingReportId(r.id);
      const clientRequestId = `report-reactivation-${r.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const created = await createReportOrder({
        reportId: r.id,
        productCode: REPORT_PRODUCT_CODES.REPORT_REACTIVATION,
        clientRequestId,
        platform: "TEST",
        provider: "TEST",
      });
      await activateTestReportOrder(created.order.id);
      await load();
      setSection("active");
      setReactivationSuccessOpen(true);
    } catch (error: any) {
      Alert.alert(
        t("cases.reactivation.failed"),
        error?.message || t("cases.please.try.again.later"),
      );
    } finally {
      setReactivatingReportId(null);
    }
  };

  const closeReport = async (r: Report) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      Alert.alert(
        t("cases.error"),
        t("cases.you.must.be.logged.in.to.close.this.case"),
      );
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/reports/${encodeURIComponent(r.id)}/close`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      Alert.alert(
        t("cases.error"),
        data?.message || data?.error || t("cases.could.not.close.case"),
      );
      return;
    }

    load();
  };

  const confirmClose = (r: Report) =>
    setConfirmDialog({ kind: "close", report: r });

  const confirmDelete = (r: Report) =>
    setConfirmDialog({ kind: "delete", report: r });

  const dialogTitle =
    confirmDialog?.kind === "extend"
      ? t("cases.reactivate.found.report")
      : confirmDialog?.kind === "reactivateLost"
        ? t("cases.reactivate.lost.report")
        : confirmDialog?.kind === "close"
          ? t("cases.close.case")
          : t("cases.delete.case");
  const dialogBody =
    confirmDialog?.kind === "extend"
      ? t(
          "cases.keep.the.report.active.for.up.to.30.more.days.found.reports.can.remain",
        )
      : confirmDialog?.kind === "reactivateLost"
        ? t("cases.reactivate.payment.summary")
        : confirmDialog?.kind === "close"
          ? t(
              "cases.the.case.stays.in.my.cases.but.it.will.no.longer.be.used.for.new.match",
            )
          : t(
              "cases.the.case.is.removed.from.your.account.immediately.for.security.and.fra",
            );
  const activeReports = reports.filter(
    (r) =>
      String(r.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
      !r.closed_at &&
      !r.archived_at &&
      (!r.visible_until || Date.parse(r.visible_until) > Date.now()),
  );
  const activeIds = new Set(activeReports.map((r) => r.id));
  const historyReports = reports.filter((r) => !activeIds.has(r.id));
  const visibleReports = section === "active" ? activeReports : historyReports;

  const runDialogAction = async () => {
    const current = confirmDialog;
    if (!current) return;
    setConfirmDialog(null);
    if (current.kind === "extend") await extendFoundReport(current.report);
    else if (current.kind === "reactivateLost")
      await reactivateLostReport(current.report);
    else if (current.kind === "close") await closeReport(current.report);
    else await deleteReport(current.report.id);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <PremiumHeader
          title={t("cases.my.cases")}
          subtitle={
            section === "active"
              ? t("cases.active.cases")
              : t("cases.case.history")
          }
          onBack={() => {
            // Return to where the user came from (e.g. Profile); home only when opened directly.
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
          right={<AuthHeaderAction />}
        />

        <View style={styles.sectionTabs}>
          <Pressable
            style={[
              styles.sectionTab,
              section === "active" && styles.sectionTabActive,
            ]}
            onPress={() => setSection("active")}
          >
            <Text
              style={[
                styles.sectionTabText,
                section === "active" && styles.sectionTabTextActive,
              ]}
            >
              {t("cases.active.count", { count: activeReports.length })}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.sectionTab,
              section === "history" && styles.sectionTabActive,
            ]}
            onPress={() => setSection("history")}
          >
            <Text
              style={[
                styles.sectionTabText,
                section === "history" && styles.sectionTabTextActive,
              ]}
            >
              {t("cases.history.count", { count: historyReports.length })}
            </Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>{t("cases.loading.cases")}</Text>
          </View>
        ) : visibleReports.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>
              {section === "active"
                ? t("cases.no.active.cases.right.now")
                : t("cases.no.case.history.yet")}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {visibleReports.map((r) => {
              const act = activityByReport[r.id] ?? null;
              const actFromMe = act?.sender_id === user?.id;
              const statusInfo = reportStatusInfo(r, language, t);
              const isClosed = r.status === "CLOSED" || !!r.closed_at;
              const isExpired =
                r.status === "EXPIRED" ||
                (!!r.visible_until &&
                  Date.parse(r.visible_until) <= Date.now());
              const latestChatId = act?.match_id;
              const count = matchCountByReport[r.id] ?? 0;
              return (
                <View
                  key={r.id}
                  style={[
                    styles.card,
                    params.reportId === r.id && styles.cardFocused,
                  ]}
                >
                  <View style={styles.cardTopRow}>
                    <Text
                      style={[
                        styles.kindBadge,
                        r.type === "FOUND" && styles.kindBadgeFound,
                      ]}
                    >
                      {r.type === "LOST"
                        ? t("cases.lost.2")
                        : t("cases.found.2")}
                    </Text>
                    <Text
                      style={[
                        styles.statusBadge,
                        isExpired && styles.statusExpired,
                        isClosed && styles.statusClosed,
                      ]}
                    >
                      {statusInfo.label}
                    </Text>
                  </View>
                  <Text style={styles.title}>
                    {prettyReportTitle(r, language, t).replace(
                      /^Lost:\s*|^Found:\s*|^Mistet:\s*|^Funnet:\s*/i,
                      "",
                    )}
                  </Text>
                  <Text style={styles.meta}>
                    {t("cases.reported")}{" "}
                    {new Date(r.created_at).toLocaleDateString()}
                  </Text>
                  {!!r.brand?.trim() && (
                    <Text style={styles.brandLine}>
                      {t("cases.brand")}: {titleCase(r.brand)}
                    </Text>
                  )}
                  {r.type === "FOUND" && (
                    <Text style={styles.extensionInfo}>
                      {t("cases.extended.count", {
                        count: Number(r.extension_count || 0),
                      })}
                    </Text>
                  )}
                  {act && (
                    <Text style={styles.lastLine} numberOfLines={2}>
                      {t("cases.latest.chat")}:{" "}
                      {actFromMe ? t("cases.you") : t("cases.other.party")} ·{" "}
                      {formatTime(act.at)} · {shortMessage(act.body)}
                    </Text>
                  )}
                  {unreadByReport[r.id] && (
                    <Text style={styles.unread}>
                      ● {t("cases.new.message")}
                    </Text>
                  )}
                  <View style={styles.primaryActions}>
                    {latestChatId && (
                      <Pressable
                        style={styles.primaryBtn}
                        onPress={() => router.push(`/chat/${latestChatId}`)}
                      >
                        <Text style={styles.primaryBtnText}>
                          {t("cases.open.chat")}
                        </Text>
                      </Pressable>
                    )}
                    {count > 0 ? (
                      <Pressable
                        style={[
                          styles.primaryBtn,
                          latestChatId && styles.secondaryPrimary,
                        ]}
                        onPress={() =>
                          router.push({
                            pathname: "/match",
                            params: { reportId: r.id },
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.primaryBtnText,
                            latestChatId && styles.secondaryPrimaryText,
                          ]}
                        >
                          {t("cases.view.matches.count", { count })}
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={styles.noMatches}>
                        <Text style={styles.noMatchesText}>
                          {t("cases.no.matches.yet")}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.secondaryActions}>
                    <Pressable onPress={() => openReport(r)}>
                      <Text style={styles.viewLink}>
                        {t("cases.view.report")}
                      </Text>
                    </Pressable>
                    {!isClosed && (
                      <Pressable onPress={() => editReport(r)}>
                        <Text style={styles.secondaryLink}>
                          {isExpired
                            ? t("cases.edit.details")
                            : t("cases.edit")}
                        </Text>
                      </Pressable>
                    )}
                    {canExtendFound(r) && (
                      <Pressable onPress={() => confirmExtendFound(r)}>
                        <Text style={styles.extendLink}>
                          {isExpired
                            ? t("cases.reactivate")
                            : t("cases.extend")}
                        </Text>
                      </Pressable>
                    )}
                    {r.type === "LOST" && isExpired && !isClosed && (
                      <Pressable
                        disabled={reactivatingReportId === r.id}
                        onPress={() =>
                          setConfirmDialog({
                            kind: "reactivateLost",
                            report: r,
                          })
                        }
                      >
                        <Text style={styles.extendLink}>
                          {reactivatingReportId === r.id
                            ? t("cases.reactivating")
                            : t("cases.reactivate.30.days")}
                        </Text>
                      </Pressable>
                    )}
                    {!isClosed && !(r.type === "LOST" && isExpired) && (
                      <Pressable onPress={() => confirmClose(r)}>
                        <Text style={styles.secondaryLink}>
                          {t("cases.close")}
                        </Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => confirmDelete(r)}>
                      <Text style={styles.deleteLink}>{t("cases.delete")}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <Pressable style={styles.reloadBtn} onPress={load}>
              <Text style={styles.reloadTxt}>{t("cases.refresh")}</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
      <Modal
        transparent
        visible={!!confirmDialog}
        animationType="fade"
        onRequestClose={() => setConfirmDialog(null)}
      >
        <View style={dialogStyles.backdrop}>
          <View style={dialogStyles.card}>
            <View style={dialogStyles.iconCircle}>
              <Text style={dialogStyles.iconText}>
                {confirmDialog?.kind === "delete"
                  ? "!"
                  : confirmDialog?.kind === "close"
                    ? "✓"
                    : "+"}
              </Text>
            </View>
            <Text style={dialogStyles.title}>{dialogTitle}</Text>
            <Text style={dialogStyles.body}>{dialogBody}</Text>
            {confirmDialog?.kind === "reactivateLost" && (
              <View style={dialogStyles.paymentSummary}>
                <View style={dialogStyles.paymentRow}>
                  <Text style={dialogStyles.paymentLabel}>
                    {t("cases.reactivation.product")}
                  </Text>
                  <Text style={dialogStyles.paymentValue}>
                    {t("cases.reactivation.30.days")}
                  </Text>
                </View>
                <View style={dialogStyles.paymentRow}>
                  <Text style={dialogStyles.paymentLabel}>
                    {t("cases.test.price")}
                  </Text>
                  <Text style={dialogStyles.paymentPrice}>99 kr</Text>
                </View>
                <Text style={dialogStyles.testModeText}>
                  {t("cases.test.payment.notice")}
                </Text>
              </View>
            )}
            <View
              style={[
                dialogStyles.actions,
                confirmDialog?.kind === "reactivateLost" &&
                  dialogStyles.paymentActions,
              ]}
            >
              <Pressable
                style={[
                  dialogStyles.cancelBtn,
                  confirmDialog?.kind === "reactivateLost" &&
                    dialogStyles.paymentActionButton,
                ]}
                onPress={() => setConfirmDialog(null)}
              >
                <Text style={dialogStyles.cancelText}>{t("cases.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[
                  dialogStyles.confirmBtn,
                  confirmDialog?.kind === "reactivateLost" &&
                    dialogStyles.paymentActionButton,
                  confirmDialog?.kind === "delete" &&
                    dialogStyles.deleteConfirmBtn,
                ]}
                onPress={() => void runDialogAction()}
              >
                <Text style={dialogStyles.confirmText}>
                  {confirmDialog?.kind === "extend" ||
                  confirmDialog?.kind === "reactivateLost"
                    ? confirmDialog?.kind === "reactivateLost"
                      ? t("cases.complete.test.payment")
                      : t("cases.reactivate.2")
                    : confirmDialog?.kind === "close"
                      ? t("cases.close.case.2")
                      : t("cases.delete")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={reactivationSuccessOpen}
        animationType="fade"
        onRequestClose={() => setReactivationSuccessOpen(false)}
      >
        <View style={successStyles.backdrop}>
          <View style={successStyles.card}>
            <View style={successStyles.iconCircle}>
              <Text style={successStyles.iconText}>✓</Text>
            </View>
            <Text style={successStyles.title}>
              {t("cases.reactivation.success.title")}
            </Text>
            <Text style={successStyles.body}>
              {t("cases.reactivation.success.body")}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={successStyles.closeButton}
              onPress={() => setReactivationSuccessOpen(false)}
            >
              <Text style={successStyles.closeButtonText}>
                {t("cases.reactivation.success.close")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  sectionTabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: theme.colors.bg,
  },
  sectionTab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTabActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  sectionTabText: {
    color: theme.colors.muted,
    fontWeight: "900",
    fontSize: 13,
  },
  sectionTabTextActive: { color: "#FFF" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  muted: { color: theme.colors.muted, fontWeight: "600", textAlign: "center" },
  list: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 30 },
  card: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: 14,
  },
  cardFocused: { borderColor: theme.colors.primary, borderWidth: 2 },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  kindBadge: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#FFF1F2",
    color: "#BE123C",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  kindBadgeFound: { backgroundColor: "#ECFDF3", color: "#15803D" },
  statusBadge: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    color: theme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  statusExpired: { backgroundColor: "#FFF7ED", color: "#B45309" },
  statusClosed: { backgroundColor: "#F1F5F9", color: "#475569" },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  meta: {
    marginTop: 5,
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  brandLine: {
    marginTop: 5,
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  extensionInfo: {
    marginTop: 7,
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  lastLine: {
    marginTop: 9,
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  unread: {
    marginTop: 6,
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 12,
  },
  primaryActions: { flexDirection: "row", gap: 8, marginTop: 13 },
  primaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
  },
  primaryBtnText: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  secondaryPrimary: {
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  secondaryPrimaryText: { color: theme.colors.primary },
  noMatches: {
    alignSelf: "flex-start",
    minHeight: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  noMatchesText: { color: theme.colors.muted, fontWeight: "800", fontSize: 12 },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#EEF2F6",
  },
  viewLink: { color: theme.colors.primary, fontWeight: "900", fontSize: 13 },
  secondaryLink: { color: "#475569", fontWeight: "800", fontSize: 13 },
  extendLink: { color: "#15803D", fontWeight: "900", fontSize: 13 },
  deleteLink: { color: "#B42318", fontWeight: "900", fontSize: 13 },
  reloadBtn: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  reloadTxt: { fontWeight: "800", color: theme.colors.text },
});
const dialogStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 410,
    borderRadius: 22,
    backgroundColor: "#FFF",
    padding: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
  },
  iconText: { color: theme.colors.primary, fontSize: 25, fontWeight: "900" },
  title: {
    marginTop: 14,
    textAlign: "center",
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  body: {
    marginTop: 9,
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  paymentSummary: {
    marginTop: 16,
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  paymentLabel: { color: "#64748B", fontWeight: "800" },
  paymentValue: {
    color: "#0F172A",
    fontWeight: "900",
    flexShrink: 1,
    textAlign: "right",
    marginLeft: 12,
  },
  paymentPrice: { color: "#1D4ED8", fontWeight: "900", fontSize: 20 },
  testModeText: {
    marginTop: 5,
    color: "#92400E",
    fontWeight: "700",
    lineHeight: 19,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  paymentActions: { flexDirection: "column-reverse", gap: 10 },
  paymentActionButton: { width: "100%", flex: 0 },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cancelText: { color: theme.colors.text, fontWeight: "900" },
  confirmBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  deleteConfirmBtn: { backgroundColor: "#B42318" },
  confirmText: {
    color: "#FFF",
    fontWeight: "900",
    textAlign: "center",
    width: "100%",
    paddingHorizontal: 8,
  },
});

const successStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 410,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: "#D1FAE5",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  iconText: { color: "#15803D", fontSize: 32, fontWeight: "900" },
  title: {
    marginTop: 18,
    textAlign: "center",
    color: theme.colors.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
  },
  body: {
    marginTop: 10,
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  closeButton: {
    width: "100%",
    minHeight: 50,
    marginTop: 22,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
  },
  closeButtonText: {
    width: "100%",
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    textAlign: "center",
  },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyReportsScreen);
