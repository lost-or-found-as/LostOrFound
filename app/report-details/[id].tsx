// app/report-details/[id].tsx
// Saksdetaljer. T1.9G: the top (photo, title, badges, reward) is unchanged; below it a
// "Neste steg" card says what to do now, then Detaljer, Område, the area-alert offer and one
// Aktivitet timeline. Case actions (edit, extend, close, delete) live in the ⋯ menu.
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker, Circle } from "react-native-maps";
import ImageViewing from "react-native-image-viewing";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { useI18n } from "../../src/i18n/I18nProvider";
import { theme } from "../../src/ui/theme";
import { categoryName } from "../../src/i18n/catalog";
import { fetchGeoAlertStatus } from "../../src/lib/reportCommerce";
import {
  classifyAreaAlertError,
  deriveAreaAlertView,
  type AreaAlertErrorInfo,
  type GeoAlertStatus,
} from "../../src/lib/areaAlertStatus";
import { AreaAlertServiceCard } from "../../src/ui/AreaAlertServiceCard";
import { InlineNotice } from "../../src/ui/InlineNotice";
import { formatDistance, formatLocalizedDateTime, formatMoney, formatTimeAgo } from "../../src/i18n/formatters";
import { STORED_MONEY_CURRENCY } from "../../src/lib/market";
import { reportDescriptionText } from "../../src/lib/reportDescription";
import { caseColors, caseTitle } from "../../src/lib/caseDisplay";
import { userErrorMessage } from "../../src/lib/userError";
import {
  canExtendFound,
  canReactivateLost,
  closeReportRequest,
  deleteReportRequest,
  extendFoundRequest,
  isReportClosed,
  isReportExpired,
  reactivateLostRequest,
  reportDaysLeft,
  REACTIVATION_TEST_PRICE,
} from "../../src/lib/reportLifecycle";
import {
  activityTarget,
  activityText,
  EMPTY_ACTIVITY,
  fetchReportActivity,
  nextStep,
  type ActivityEvent,
  type ReportActivity,
} from "../../src/lib/reportActivity";
import { BottomSheet, Button, ConfirmSheet, IconButton, InfoButton, ScreenHeader } from "../../src/ui/kit";

type D = {
  report: any;
  images: any[];
  entitlements: any[];
  geo_alert_campaigns: any[];
  confirmed_matches: any[];
  last_messages: any[];
  observations: any[];
};

type Confirm = "close" | "delete" | "extend" | "reactivate" | null;

function Screen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language, t } = useI18n();
  const [data, setData] = useState<D | null>(null);
  const [activity, setActivity] = useState<ReportActivity>(EMPTY_ACTIVITY);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(false);
  const [loadError, setLoadError] = useState<AreaAlertErrorInfo | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoAlertStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      try {
        if (!quiet) setLoading(true);
        setLoadError(null);
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("AUTH_REQUIRED");
        const r = await fetch(`${API_BASE_URL}/reports/${encodeURIComponent(String(id))}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await r.json();
        if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP_${r.status}`), { status: r.status });
        setData(j);
      } catch (e: any) {
        // T1.8E.5I: shown in the screen with a retry, never as a native dialog.
        if (!quiet) setLoadError(classifyAreaAlertError(e));
      } finally {
        if (!quiet) setLoading(false);
      }
      // The timeline is extra: the case still shows when it cannot be loaded.
      try {
        setActivity(await fetchReportActivity(String(id)));
      } catch {
        setActivity(EMPTY_ACTIVITY);
      }
      try {
        setGeoStatus(await fetchGeoAlertStatus(String(id)));
      } catch {
        setGeoStatus(null);
      }
    },
    [id],
  );

  // Reload on focus so new matches, messages and a finished area-alert order show up after
  // returning from the match list, the chat or the order screen.
  const loadedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void load(loadedOnce.current);
      loadedOnce.current = true;
    }, [load]),
  );

  const geoView = useMemo(() => deriveAreaAlertView(geoStatus), [geoStatus]);
  const imgs = useMemo(
    () => (data?.images || []).filter((x) => x.signed_url).map((x) => ({ uri: String(x.signed_url) })),
    [data],
  );

  const header = (
    <>
      <Stack.Screen options={{ headerShown: false, title: t("caseDetail.case.details"), headerBackTitle: "" }} />
      <ScreenHeader
        title={t("caseDetail.case.details")}
        onBack={() => router.back()}
        right={
          data ? (
            <IconButton icon="ellipsis-horizontal" label={t("caseDetail.menu.label")} onPress={() => setMenuOpen(true)} />
          ) : undefined
        }
      />
    </>
  );

  if (loading)
    return (
      <View style={s.safe}>
        {header}
        <View style={s.loadingContent}>
          <View style={[s.loadingBlock, s.loadingHero]} />
          <View style={s.loadingCard}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={s.loadingText}>{t("caseDetail.loadingReport")}</Text>
          </View>
          <View style={s.loadingBlock} />
        </View>
      </View>
    );

  if (!data)
    return (
      <View style={s.safe}>
        {header}
        <View style={s.errorWrap}>
          {loadError && loadError.kind !== "notAvailable" && loadError.kind !== "unknown" ? (
            <InlineNotice
              tone={loadError.kind === "auth" ? "info" : "warning"}
              icon={loadError.kind === "network" ? "wifi-outline" : loadError.kind === "auth" ? "lock-closed-outline" : "cloud-offline-outline"}
              title={
                loadError.kind === "network" ? t("errors.networkTitle") : loadError.kind === "auth" ? t("errors.authTitle") : t("errors.serviceTitle")
              }
              body={loadError.kind === "network" ? t("errors.networkBody") : loadError.kind === "auth" ? t("errors.authBody") : t("errors.serviceBody")}
              actionLabel={loadError.retryable ? t("errors.retry") : undefined}
              onAction={() => void load()}
            />
          ) : (
            <InlineNotice
              tone="info"
              icon="document-text-outline"
              title={t("caseDetail.case.unavailable")}
              body={t("caseDetail.could.not.load.case")}
              actionLabel={t("errors.retry")}
              onAction={() => void load()}
            />
          )}
        </View>
      </View>
    );

  const r = data.report;
  const lost = String(r.type).toUpperCase() === "LOST";
  const closed = isReportClosed(r);
  const expired = isReportExpired(r);
  const daysLeft = reportDaysLeft(r);
  const title = caseTitle(r, language) || t("caseDetail.item");
  const statusLabel = closed
    ? t("cases.closed")
    : expired
      ? t("cases.expired")
      : daysLeft != null
        ? t("cases.active.days.left", { count: daysLeft })
        : t("caseDetail.active");
  const radius = Number(r.radius_m || r.search_radius_m || r.area_radius_m || r.location_radius_m || 0);
  const colors = caseColors(r, language);
  const category = categoryName(r.category, language);
  const description = reportDescriptionText(r.description);
  const step = nextStep(r, activity.summary);
  const timeline = activity.events.filter((e) => e.type !== "CREATED").length > 0 ? activity.events : [];
  const showAreaAlert = lost && r.lat != null && r.lng != null && !closed;

  const openAreaAlert = () =>
    router.push({
      pathname: "/geo-alert-create",
      params: { reportId: r.id, title, lat: String(r.lat), lng: String(r.lng) },
    });
  const openMatches = () => router.push({ pathname: "/match", params: { reportId: r.id } });
  const openChat = (matchId: string) => router.push(`/chat/${matchId}`);
  const editReport = () => router.push({ pathname: "/(report)/create-report", params: { editReportId: r.id } });

  const runStepAction = () => {
    if (step.action === "openChat" && activity.summary.chatMatchId) openChat(activity.summary.chatMatchId);
    else if (step.action === "openMatches") openMatches();
    else if (step.action === "reactivateLost") setConfirm("reactivate");
    else if (step.action === "extendFound") setConfirm("extend");
  };

  const openEvent = (event: ActivityEvent) => {
    const target = activityTarget(event);
    if (!target) return;
    if (target.kind === "chat") openChat(target.id);
    else if (target.kind === "observation") router.push(`/observation/${target.id}`);
    else openMatches();
  };

  const runConfirm = async () => {
    const kind = confirm;
    if (!kind) return;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "delete") {
        await deleteReportRequest(r.id);
        setConfirm(null);
        router.back();
        return;
      }
      if (kind === "close") await closeReportRequest(r.id);
      else if (kind === "extend") await extendFoundRequest(r.id);
      else if (kind === "reactivate") await reactivateLostRequest(r.id);
      setConfirm(null);
      await load(true);
    } catch (e) {
      setConfirm(null);
      const fallback =
        kind === "delete"
          ? "cases.delete.failed.body"
          : kind === "close"
            ? "cases.could.not.close.case"
            : kind === "extend"
              ? "cases.could.not.extend"
              : "cases.reactivation.failed";
      setActionError(userErrorMessage(e, t, fallback, `caseDetail.${kind}`));
    } finally {
      setBusy(false);
    }
  };

  // Close the menu first; iOS cannot open the next sheet while one is still closing.
  const fromMenu = (action: () => void) => {
    setMenuOpen(false);
    setTimeout(action, 350);
  };
  const menuItems: { key: string; icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; hint?: string; onPress: () => void; danger?: boolean }[] = [];
  if (!closed) menuItems.push({ key: "edit", icon: "create-outline", label: t("caseDetail.menu.edit"), onPress: () => fromMenu(editReport) });
  if (canExtendFound(r))
    menuItems.push({
      key: "extend",
      icon: "time-outline",
      label: t("caseDetail.menu.extend"),
      hint: t("cases.extended.count", { count: Number(r.extension_count || 0) }),
      onPress: () => fromMenu(() => setConfirm("extend")),
    });
  if (canReactivateLost(r))
    menuItems.push({ key: "reactivate", icon: "refresh-outline", label: t("cases.reactivate.30.days"), onPress: () => fromMenu(() => setConfirm("reactivate")) });
  if (!closed && !(lost && expired))
    menuItems.push({
      key: "close",
      icon: "checkmark-circle-outline",
      label: lost ? t("caseDetail.menu.closeLost") : t("caseDetail.menu.closeFound"),
      onPress: () => fromMenu(() => setConfirm("close")),
    });
  menuItems.push({ key: "delete", icon: "trash-outline", label: t("caseDetail.menu.delete"), danger: true, onPress: () => fromMenu(() => setConfirm("delete")) });

  const confirmCopy: Record<Exclude<Confirm, null>, { title: string; body: string; label: string; destructive?: boolean }> = {
    close: {
      title: lost ? t("caseDetail.confirm.closeLostTitle") : t("cases.close.case"),
      body: t("cases.the.case.stays.in.my.cases.but.it.will.no.longer.be.used.for.new.match"),
      label: t("cases.close.case.2"),
    },
    delete: {
      title: t("cases.delete.case"),
      body: t("cases.the.case.is.removed.from.your.account.immediately.for.security.and.fra"),
      label: t("cases.delete"),
      destructive: true,
    },
    extend: {
      title: t("caseDetail.confirm.extendTitle"),
      body: t("cases.keep.the.report.active.for.up.to.30.more.days.found.reports.can.remain"),
      label: t("cases.extend"),
    },
    reactivate: {
      title: t("cases.reactivate.lost.report"),
      body: [
        t("cases.reactivate.payment.summary"),
        `${t("cases.test.price")}: ${formatMoney(REACTIVATION_TEST_PRICE, STORED_MONEY_CURRENCY, language)}`,
        t("cases.test.payment.notice"),
      ].join("\n\n"),
      label: t("cases.complete.test.payment"),
    },
  };
  const current = confirm ? confirmCopy[confirm] : null;

  return (
    <View style={s.safe}>
      {header}
      <ScrollView contentContainerStyle={s.content}>
        {/* Top of the case: unchanged in T1.9G. */}
        <View style={s.hero}>
          {imgs[0] ? (
            <Pressable onPress={() => setViewer(true)} accessibilityRole="imagebutton" accessibilityLabel={t("caseDetail.tap.to.enlarge")}>
              <Image source={imgs[0]} style={s.heroImage} />
            </Pressable>
          ) : null}
          <View style={s.badges}>
            <Text style={[s.badge, lost ? s.badgeLost : s.badgeFound]}>{lost ? t("caseDetail.lost") : t("caseDetail.found")}</Text>
            <Text style={[s.badge, closed || expired ? s.badgeMuted : s.badgeActive]}>{statusLabel}</Text>
          </View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.meta}>{[r.location_label, r.occurred_at ? formatLocalizedDateTime(r.occurred_at, language) : ""].filter(Boolean).join(" · ")}</Text>
          {Number(r.reward_ore) > 0 && (
            <Text style={s.reward}>
              {t("caseDetail.reward")}: {formatMoney(Number(r.reward_ore) / 100, STORED_MONEY_CURRENCY, language)}
            </Text>
          )}
        </View>

        {!!actionError && (
          <InlineNotice tone="warning" icon="alert-circle-outline" title={t("caseDetail.actionFailed")} body={actionError} style={s.notice} />
        )}

        {/* Neste steg */}
        <View style={[s.step, step.tone === "dark" ? s.stepDark : s.stepPlain]}>
          <Text style={[s.stepEyebrow, step.tone === "dark" && s.onDarkMuted]}>{t("caseDetail.next.eyebrow")}</Text>
          <Text style={[s.stepTitle, step.tone === "dark" && s.onDark]}>{t(step.titleKey, step.params)}</Text>
          <Text style={[s.stepBody, step.tone === "dark" && s.onDarkSoft]}>{t(step.bodyKey, step.params)}</Text>
          {step.kind === "matches" && (
            <View style={s.chips}>
              {activity.summary.strongMatches > 0 && (
                <Text style={[s.chip, s.chipStrong]}>{t("caseDetail.next.strongCount", { count: activity.summary.strongMatches })}</Text>
              )}
              {activity.summary.possibleMatches - activity.summary.strongMatches > 0 && (
                <Text style={[s.chip, s.chipPossible]}>
                  {t("caseDetail.next.otherCount", { count: activity.summary.possibleMatches - activity.summary.strongMatches })}
                </Text>
              )}
            </View>
          )}
          {step.action && step.actionKey && (
            <Button
              label={t(step.actionKey)}
              onPress={runStepAction}
              variant={step.tone === "dark" ? "neutral" : "primary"}
              style={s.stepButton}
            />
          )}
        </View>

        {/* Detaljer */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.h2}>{t("caseDetail.detailsTitle")}</Text>
            {!closed && (
              <Pressable onPress={editReport} accessibilityRole="button" hitSlop={8} style={s.linkButton}>
                <Text style={s.link}>{t("caseDetail.menu.edit")}</Text>
              </Pressable>
            )}
          </View>
          <Row label={t("caseDetail.object")} value={[title, category].filter(Boolean).join(" · ")} />
          <Row label={t("caseDetail.color")} value={colors} />
          <Row label={t("caseDetail.brand")} value={r.brand} />
          {!!description && (
            <>
              <View style={s.divider} />
              <Text style={s.description}>{description}</Text>
            </>
          )}
        </View>

        {/* Område */}
        {r.lat != null && r.lng != null && (
          <View style={s.card}>
            <Text style={s.h2}>{t("caseDetail.area")}</Text>
            <MapView
              style={s.map}
              initialRegion={{ latitude: Number(r.lat), longitude: Number(r.lng), latitudeDelta: 0.02, longitudeDelta: 0.02 }}
              scrollEnabled={false}
            >
              <Marker coordinate={{ latitude: Number(r.lat), longitude: Number(r.lng) }} />
              {radius > 0 && (
                <Circle
                  center={{ latitude: Number(r.lat), longitude: Number(r.lng) }}
                  radius={radius}
                  strokeColor="#2563EB"
                  fillColor="rgba(37,99,235,.10)"
                />
              )}
            </MapView>
            {!!r.location_label && <Text style={s.place}>{r.location_label}</Text>}
            {radius > 0 && <Text style={s.muted}>{t("caseDetail.areaRadius", { radius: formatDistance(radius, language, t) })}</Text>}
          </View>
        )}

        {/* Varsle folk i nærheten */}
        {showAreaAlert && geoView.kind !== "none" && <AreaAlertServiceCard view={geoView} onSendNew={openAreaAlert} />}
        {showAreaAlert && geoView.kind === "none" && !expired && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.h2}>{t("caseDetail.notifyNearbyTitle")}</Text>
              <InfoButton title={t("info.areaAlert.title")} body={t("info.areaAlert.body")} label={t("info.areaAlert.label")} bordered={false} />
            </View>
            <Text style={s.muted}>{t("caseDetail.notifyNearbyBody")}</Text>
            <Button label={t("caseDetail.notifyNearbyAction")} variant="neutral" onPress={openAreaAlert} />
          </View>
        )}

        {/* Aktivitet */}
        {timeline.length > 0 && (
          <View style={s.card}>
            <Text style={s.h2}>{t("caseDetail.activityTitle")}</Text>
            {timeline.map((event, i) => {
              const text = activityText(event, r.type);
              const target = activityTarget(event);
              const row = (
                <View style={[s.event, i < timeline.length - 1 && s.eventBorder]}>
                  <View style={[s.dot, text.tone === "new" && s.dotNew]} />
                  <View style={s.eventText}>
                    <Text style={s.eventTitle}>{t(text.key, text.params)}</Text>
                    <Text style={s.eventTime}>{formatTimeAgo(event.at, t, "long")}</Text>
                  </View>
                  {target && <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />}
                </View>
              );
              return target ? (
                <Pressable key={`${event.type}-${event.at}-${i}`} onPress={() => openEvent(event)} accessibilityRole="button">
                  {row}
                </Pressable>
              ) : (
                <View key={`${event.type}-${event.at}-${i}`}>{row}</View>
              );
            })}
          </View>
        )}

        <Text style={s.footnote}>{t("caseDetail.menuHint")}</Text>
      </ScrollView>

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} accessibilityLabel={t("common.cancel")}>
        <Text style={s.sheetTitle} numberOfLines={2}>
          {title}
        </Text>
        <View>
          {menuItems.map((item) => (
            <React.Fragment key={item.key}>
              {item.danger && <View style={s.divider} />}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}
                onPress={item.onPress}
              >
                <Ionicons name={item.icon} size={22} color={item.danger ? theme.colors.dangerStrong : theme.colors.text} />
                <View style={s.menuText}>
                  <Text style={[s.menuLabel, item.danger && s.menuDanger]}>{item.label}</Text>
                  {!!item.hint && <Text style={s.menuHint}>{item.hint}</Text>}
                </View>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
        <Button label={t("common.cancel")} variant="neutral" onPress={() => setMenuOpen(false)} />
      </BottomSheet>

      <ConfirmSheet
        visible={!!current}
        title={current?.title ?? ""}
        body={current?.body}
        confirmLabel={current?.label ?? ""}
        cancelLabel={t("common.cancel")}
        destructive={current?.destructive}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
      />

      <ImageViewing images={imgs} imageIndex={0} visible={viewer && imgs.length > 0} onRequestClose={() => setViewer(false)} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  if (value == null || String(value).trim() === "") return null;
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{String(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  errorWrap: { padding: 16 },
  loadingContent: { padding: 16 },
  loadingCard: {
    height: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  loadingText: { marginTop: 10, color: theme.colors.textSecondary, fontWeight: "700" },
  loadingBlock: { height: 120, borderRadius: 18, backgroundColor: "#E9EEF5", marginBottom: 12 },
  loadingHero: { height: 210 },
  content: { padding: 16, paddingTop: 4, paddingBottom: 40, gap: 14 },
  hero: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    ...theme.shadow.card,
  },
  heroImage: { width: "100%", height: 220, borderRadius: 15, backgroundColor: "#E2E8F0" },
  badges: { marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: "hidden", fontWeight: "900", fontSize: 13 },
  badgeLost: { backgroundColor: "#FFF1F2", color: "#BE123C" },
  badgeFound: { backgroundColor: "#EFF6FF", color: "#1E3A8A" },
  badgeActive: { backgroundColor: "#ECFDF5", color: "#15803D" },
  badgeMuted: { backgroundColor: "#F1F5F9", color: theme.colors.textSecondary },
  title: { marginTop: 13, fontSize: 26, fontWeight: "900", color: theme.colors.text },
  meta: { marginTop: 6, color: theme.colors.textSecondary, fontWeight: "700", lineHeight: 20 },
  reward: {
    marginTop: 12,
    alignSelf: "flex-start",
    padding: 8,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#FFFBEB",
    color: "#92400E",
    fontWeight: "900",
  },
  notice: { marginTop: 0 },
  step: { borderRadius: 18, padding: 16, gap: 8 },
  stepDark: { backgroundColor: theme.colors.primary },
  stepPlain: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  stepEyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: theme.colors.textSecondary },
  stepTitle: { fontSize: 19, fontWeight: "900", color: theme.colors.text },
  stepBody: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  onDark: { color: "#FFFFFF" },
  onDarkSoft: { color: "#E5E7EB" },
  onDarkMuted: { color: "#CBD5E1" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: "hidden", fontSize: 12, fontWeight: "800" },
  chipStrong: { backgroundColor: theme.score.excellent.bg, color: theme.score.excellent.fg },
  chipPossible: { backgroundColor: theme.score.possible.bg, color: theme.score.possible.fg },
  stepButton: { marginTop: 4 },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32 },
  h2: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  linkButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  link: { fontSize: 15, fontWeight: "800", color: theme.colors.primary },
  row: { flexDirection: "row", gap: 12 },
  label: { width: 96, color: theme.colors.textSecondary, fontWeight: "700", fontSize: 14 },
  value: { flex: 1, color: theme.colors.text, fontWeight: "800", fontSize: 14 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
  description: { fontSize: 14, lineHeight: 21, fontWeight: "600", color: "#334155" },
  map: { height: 170, borderRadius: 14, overflow: "hidden" },
  place: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  muted: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  event: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, minHeight: 44 },
  eventBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  dot: { width: 10, height: 10, borderRadius: 999, backgroundColor: "#CBD5E1" },
  dotNew: { backgroundColor: theme.colors.unread },
  eventText: { flex: 1, gap: 2 },
  eventTitle: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  eventTime: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  footnote: { textAlign: "center", fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary, paddingHorizontal: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.text },
  menuItem: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 12, paddingHorizontal: 4 },
  menuItemPressed: { backgroundColor: theme.colors.divider },
  menuText: { flex: 1, gap: 2 },
  menuLabel: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  menuHint: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  menuDanger: { color: theme.colors.dangerStrong },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(Screen);
