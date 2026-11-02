// app/(tabs)/index.tsx
// T1.9W: Home. Header with an explanation sheet, a summary of the user's cases, two big
// action tiles (lost / found) and a shortcut to nearby alerts.
import React, { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/contexts/AuthContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { isAnonymousUser } from "../../src/lib/authGate";
import { AuthHeaderAction } from "../../src/ui/AuthHeaderAction";
import { theme } from "../../src/ui/theme";
import { InfoButton } from "../../src/ui/kit";
import { registerRoute, useNewRegistration } from "../../src/lib/newRegistration";
import { fetchHomeSummary, type HomeSummary } from "../../src/lib/homeSummary";

const HOW_STEPS = [
  { title: "how.card1.title", body: "how.card1.body" },
  { title: "how.card2.title", body: "how.card2.body" },
  { title: "how.card3.title", body: "how.card3.body" },
  { title: "how.card4.title", body: "how.card4.body" },
] as const;

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const isGuest = isAnonymousUser(user as any);
  const hasAccount = !!user && !isGuest;
  const [newRegistration] = useNewRegistration();

  // Summary card: nothing is shown until the first load succeeds, and the old numbers stay
  // on screen while it refreshes, so the card never flickers.
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  useEffect(() => setSummary(null), [user?.id]);
  const loadSummary = useCallback(() => {
    if (!user || isGuest) return () => {};
    let live = true;
    fetchHomeSummary(user.id)
      .then((value) => live && setSummary(value))
      .catch((e) => console.warn("[home] could not load summary", e));
    return () => {
      live = false;
    };
  }, [user?.id, isGuest]);
  useFocusEffect(loadSummary);

  const openLost = () => {
    if (!user || isGuest) {
      router.push({
        pathname: "/(auth)/login",
        params: { returnTo: "/start", reason: "lost" },
      });
      return;
    }

    router.push(registerRoute(newRegistration, "LOST"));
  };

  const openFound = () => {
    router.push(registerRoute(newRegistration, "FOUND"));
  };

  const openSummaryTarget = () => {
    if (summary?.focusReportId) {
      router.push({ pathname: "/match", params: { reportId: summary.focusReportId } });
      return;
    }
    router.push("/my-reports");
  };

  const showSummary =
    hasAccount && !!summary && (summary.activeCases > 0 || summary.openMatches > 0 || summary.unreadChats > 0);

  const lostTile = (
    <Pressable
      key="lost"
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={openLost}
      accessibilityRole="button"
      accessibilityLabel={`${t("dashboard.lostTitle")}. ${isGuest ? t("guest.locked") : t("home.lostTileBody")}`}
    >
      <View style={[styles.tileIcon, styles.lostIcon]}>
        <Ionicons name="search" size={21} color="#9F1239" />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{t("dashboard.lostTitle")}</Text>
        {isGuest ? (
          <View style={styles.lockPill}>
            <Ionicons name="lock-closed" size={12} color={theme.colors.textSecondary} />
            <Text style={styles.lockPillText}>{t("guest.locked")}</Text>
          </View>
        ) : (
          <Text style={styles.tileBody}>{t("home.lostTileBody")}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
    </Pressable>
  );

  const foundTile = (
    <Pressable
      key="found"
      style={({ pressed }) => [styles.tile, isGuest && styles.tileHighlighted, pressed && styles.pressed]}
      onPress={openFound}
      accessibilityRole="button"
      accessibilityLabel={`${t("dashboard.foundTitle")}. ${t("home.foundTileBody")}`}
    >
      <View style={[styles.tileIcon, styles.foundIcon]}>
        <Ionicons name="checkmark" size={22} color="#075985" />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{t("dashboard.foundTitle")}</Text>
        <Text style={styles.tileBody}>{t("home.foundTileBody")}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.logo}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.headerText}>
            <Text style={styles.brand} accessibilityRole="header">Lost or Found</Text>
            <Text style={styles.greeting} numberOfLines={1}>
              {hasAccount ? t("home.greetingBack") : t("dashboard.greeting")}
            </Text>
          </View>
          {/* Logged-in users log out from Profile (with a confirmation); guests get a sign-in shortcut. */}
          {!hasAccount && <AuthHeaderAction />}
          <InfoButton title={t("profile.how")}>
            <View style={styles.howList}>
              {HOW_STEPS.map((step, index) => (
                <View key={step.title} style={styles.howStep}>
                  <View style={styles.howBadge}>
                    <Text style={styles.howBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.howText}>
                    <Text style={styles.howTitle}>{t(step.title)}</Text>
                    <Text style={styles.howBody}>{t(step.body)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </InfoButton>
        </View>

        {showSummary && summary && (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>{t("home.summary.title")}</Text>
            <View style={styles.summaryRow}>
              <SummaryCount value={summary.activeCases} label={t("home.summary.active", { count: summary.activeCases })} />
              <SummaryCount value={summary.openMatches} label={t("home.summary.matches", { count: summary.openMatches })} />
              <SummaryCount value={summary.unreadChats} label={t("home.summary.messages", { count: summary.unreadChats })} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={openSummaryTarget}
              style={({ pressed }) => [styles.summaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.summaryButtonText}>
                {summary.focusReportId ? t("home.summary.openMatches") : t("home.summary.openCases")}
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t("dashboard.whatToDo")}</Text>

        {/* T1.9X: lost always on top, found below (guests see the lock on lost). */}
        <View style={styles.tiles}>
          {lostTile}
          {foundTile}
        </View>

        {hasAccount && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/notifications", params: { tab: "nearby" } })}
            style={({ pressed }) => [styles.nearby, pressed && styles.pressed]}
          >
            <View style={styles.nearbyIcon}>
              <Ionicons name="location-outline" size={21} color={theme.tone.info.icon} />
            </View>
            <View style={styles.nearbyText}>
              <Text style={styles.nearbyTitle}>{t("notifications.nearby")}</Text>
              <Text style={styles.nearbyBody}>{t("home.nearbyBody")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
          </Pressable>
        )}

        {/* T1.9X: the steps are shown on the page as well, so the start page explains itself. */}
        <View style={styles.howCard}>
          <Text style={styles.howCardTitle}>{t("profile.how")}</Text>
          {HOW_STEPS.map((step, index) => (
            <View key={step.title} style={styles.howStep}>
              <View style={styles.howBadge}>
                <Text style={styles.howBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.howText}>
                <Text style={styles.howTitle}>{t(step.title)}</Text>
                <Text style={styles.howBody}>{t(step.body)}</Text>
              </View>
            </View>
          ))}
        </View>

        {isGuest && <Text style={styles.footnote}>{t("guest.homeFootnote")}</Text>}

        <Text style={styles.footnote}>{t("dashboard.safety")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCount({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.summaryCount} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryCountLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 110, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  logo: { width: 44, height: 44, borderRadius: 12 },
  headerText: { flex: 1, minWidth: 0 },
  brand: { color: theme.colors.text, fontWeight: "900", fontSize: 22 },
  greeting: { color: theme.colors.textSecondary, fontWeight: "600", fontSize: 14 },
  howList: { gap: 14 },
  howStep: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  howBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.chipBg,
    alignItems: "center",
    justifyContent: "center",
  },
  howBadgeText: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  howText: { flex: 1, gap: 3 },
  howTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "800" },
  howBody: { color: "#334155", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  summary: { backgroundColor: theme.colors.primary, borderRadius: 18, padding: 16, gap: 10 },
  summaryLabel: { color: "#CBD5E1", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  summaryRow: { flexDirection: "row", gap: 8 },
  summaryCount: { flex: 1 },
  summaryValue: { color: "#FFFFFF", fontSize: 26, fontWeight: "900" },
  summaryCountLabel: { color: "#CBD5E1", fontSize: 13, fontWeight: "700" },
  summaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  summaryButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: "800" },
  sectionTitle: { marginTop: 4, color: theme.colors.text, fontWeight: "900", fontSize: 17 },
  tiles: { gap: 10 },
  tile: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    gap: 14,
  },
  howCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    gap: 12,
  },
  howCardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  tileHighlighted: { borderWidth: 2, borderColor: theme.colors.primary },
  tileIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  lostIcon: { backgroundColor: "#FFE4E6" },
  foundIcon: { backgroundColor: "#E0F2FE" },
  tileText: { flex: 1, gap: 4 },
  tileTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  tileBody: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  lockPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.chipBg,
  },
  lockPillText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "800" },
  nearby: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  nearbyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  nearbyText: { flex: 1, gap: 2 },
  nearbyTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  nearbyBody: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  footnote: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  pressed: { opacity: 0.86 },
});
