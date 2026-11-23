// src/lib/haptics.ts
// T1.9BQ: short vibrations, used sparingly (Apple's guidance). The phone's own settings decide
// whether they are felt; a phone without haptics simply does nothing.
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const on = Platform.OS === "ios" || Platform.OS === "android";
const quiet = (p: Promise<unknown>) => void p.catch(() => {});

export const haptic = {
  /** Tabs, chips and choices. */
  tap: () => on && quiet(Haptics.selectionAsync()),
  /** Primary buttons: a light tap. */
  press: () => on && quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Something went well: a case sent, solved, a code accepted, a card sent, bonus. */
  success: () => on && quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Something did not work: wrong code, an answer that did not match. */
  warning: () => on && quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};

/** T1.9BQ: the next layout change (a card leaving a list) slides instead of blinking. */
export function animateNextLayout() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LayoutAnimation } = require("react-native");
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  } catch {
    // Not available: the change just happens at once.
  }
}
