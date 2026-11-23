// src/ui/Skeleton.tsx
// T1.9BQ: grey shapes that pulse gently where content is coming, instead of a spinner. The page
// keeps its shape, so nothing jumps when the content arrives. No pulse with reduced motion.
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { useI18n } from "../i18n/I18nProvider";
import { theme } from "./theme";

const BASE = "#E2E8F0";

function usePulse() {
  const v = useRef(new Animated.Value(0.55)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => live && setStill(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [still, v]);
  return still ? 0.8 : v;
}

export function SkeletonBlock({ width = "100%", height = 12, radius = 6, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = usePulse();
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: BASE, opacity }, style]} />;
}

/** A list of card-shaped placeholders (thumbnail and two lines). */
export function SkeletonList({ rows = 4, thumb = true, style }: { rows?: number; thumb?: boolean; style?: StyleProp<ViewStyle> }) {
  const { t } = useI18n();
  return (
    <View style={[s.list, style]} accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.card}>
          {thumb && <SkeletonBlock width={48} height={48} radius={12} />}
          <View style={s.lines}>
            <SkeletonBlock width={i % 2 ? "62%" : "74%"} height={13} />
            <SkeletonBlock width={i % 2 ? "40%" : "48%"} height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** A detail page placeholder: a picture, a title and some lines. */
export function SkeletonDetail({ style, label }: { style?: StyleProp<ViewStyle>; label?: string }) {
  const { t } = useI18n();
  return (
    <View style={[s.detail, style]} accessible accessibilityRole="progressbar" accessibilityLabel={label || t("common.loading")}>
      <SkeletonBlock height={180} radius={16} />
      <SkeletonBlock width="70%" height={18} />
      <SkeletonBlock width="45%" height={12} />
      <View style={s.card}>
        <View style={s.lines}>
          <SkeletonBlock width="90%" height={12} />
          <SkeletonBlock width="80%" height={12} />
          <SkeletonBlock width="55%" height={12} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  detail: { padding: 16, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  lines: { flex: 1, gap: 8 },
});
