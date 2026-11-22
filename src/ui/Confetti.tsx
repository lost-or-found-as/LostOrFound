// src/ui/Confetti.tsx
// T1.9BO: a short burst of confetti (about two seconds) that never blocks touches.
// Skipped when the phone asks for reduced motion.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

const COLORS = ["#F59E0B", "#10B981", "#3B82F6", "#EC4899", "#8B5CF6", "#EF4444"];
const PIECES = 36;

export function Confetti({ onDone }: { onDone?: () => void }) {
  const fall = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState<boolean | null>(null);
  const { width, height } = Dimensions.get("window");
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        x: Math.round(((i * 37) % 100) / 100 * width),
        drift: ((i % 7) - 3) * 18,
        delay: (i % 9) * 0.04,
        size: 6 + (i % 4) * 2,
        color: COLORS[i % COLORS.length],
        spin: (i % 2 ? 1 : -1) * (180 + (i % 5) * 90),
      })),
    [width],
  );

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => live && setReduce(value))
      .catch(() => live && setReduce(false));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (reduce === null) return;
    if (reduce) {
      onDone?.();
      return;
    }
    Animated.timing(fall, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone?.());
  }, [reduce, fall, onDone]);

  if (reduce !== false) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((p, i) => {
        const start = Math.min(0.9, p.delay);
        const translateY = fall.interpolate({ inputRange: [0, start, 1], outputRange: [-30, -30, height * 0.85] });
        const translateX = fall.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = fall.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] });
        const opacity = fall.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: 0,
              width: p.size,
              height: p.size * 1.6,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
