// app/intro.tsx
// T1.9BQ: a short intro the first time the app opens: three screens, then straight in.
import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../src/i18n/I18nProvider";
import { Button } from "../src/ui/kit";
import { theme } from "../src/ui/theme";
import { markIntroSeen } from "../src/lib/intro";
import { haptic } from "../src/lib/haptics";
import type { TranslationKey } from "../src/i18n/locales/en";

const PAGES: { icon: string; bg: string; fg: string; title: TranslationKey; body: TranslationKey }[] = [
  { icon: "search", bg: "#FEE2E2", fg: "#B91C1C", title: "intro.lost.title", body: "intro.lost.body" },
  { icon: "checkmark-circle", bg: "#DBEAFE", fg: "#1D4ED8", title: "intro.found.title", body: "intro.found.body" },
  { icon: "people", bg: "#DCFCE7", fg: "#15803D", title: "intro.help.title", body: "intro.help.body" },
];

export default function IntroScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  const finish = async () => {
    await markIntroSeen();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const next = () => {
    haptic.tap();
    if (last) return void finish();
    scroller.current?.scrollTo({ x: width * (page + 1), animated: true });
    setPage(page + 1);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (p !== page) setPage(Math.max(0, Math.min(PAGES.length - 1, p)));
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={s.top}>
        <Pressable accessibilityRole="button" onPress={() => void finish()} hitSlop={12}>
          <Text style={s.skip} maxFontSizeMultiplier={1.4}>
            {t("intro.skip")}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        accessibilityRole="adjustable"
      >
        {PAGES.map((p) => (
          <View key={p.title} style={[s.page, { width }]}>
            <View style={[s.art, { backgroundColor: p.bg }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={s.disc}>
                <Ionicons name={p.icon as any} size={64} color={p.fg} />
              </View>
              <View style={[s.spark, s.sparkA, { backgroundColor: p.fg }]} />
              <View style={[s.spark, s.sparkB, { backgroundColor: p.fg }]} />
            </View>
            <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
              {t(p.title)}
            </Text>
            <Text style={s.body} maxFontSizeMultiplier={1.6}>
              {t(p.body)}
            </Text>
          </View>
        ))}
      </ScrollView>
      <View style={s.bottom}>
        <View style={s.dots} accessibilityLabel={t("intro.step", { n: page + 1, total: PAGES.length })}>
          {PAGES.map((p, i) => (
            <View key={p.title} style={[s.dot, i === page && s.dotOn]} />
          ))}
        </View>
        <Button label={t(last ? "intro.start" : "intro.next")} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: { alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 8, minHeight: 32 },
  skip: { fontSize: 15, fontWeight: "800", color: theme.colors.textSecondary },
  page: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  art: { width: 200, height: 200, borderRadius: 100, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  disc: { width: 120, height: 120, borderRadius: 60, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  spark: { position: "absolute", borderRadius: 999, opacity: 0.35 },
  sparkA: { width: 18, height: 18, top: 18, right: 22 },
  sparkB: { width: 12, height: 12, bottom: 24, left: 20 },
  title: { fontSize: 28, fontWeight: "900", color: theme.colors.text, textAlign: "center" },
  body: { fontSize: 17, lineHeight: 24, fontWeight: "600", color: theme.colors.textSecondary, textAlign: "center" },
  bottom: { paddingHorizontal: 20, paddingBottom: 12, gap: 18 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.border },
  dotOn: { width: 22, backgroundColor: theme.colors.primary },
});
