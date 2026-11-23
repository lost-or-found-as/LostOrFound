// src/lib/casesWidget.tsx
// T1.9BT: home screen widget (iOS) with the user's active cases and what is new. The app writes
// the numbers when Home has loaded them; a tap opens the app. Texts come from the locale files.
import { Platform } from "react-native";
import { createWidget, type Widget } from "expo-widgets";
import { Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, lineLimit, monospacedDigit, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { liveActivitiesAvailable } from "./liveActivity";
import type { HomeSummary } from "./homeSummary";
import type { TranslationKey } from "../i18n/locales/en";
import type { TranslateParams } from "../i18n/translate";

type T = (key: TranslationKey, params?: TranslateParams) => string;

export type CasesWidgetProps = {
  heading: string;
  count: string;
  countLabel: string;
  line1: string;
  line2: string;
};

// Runs inside the widget runtime: only Expo UI components and modifiers.
const CasesWidget = (props: CasesWidgetProps) => {
  "widget";
  return (
    <VStack
      alignment="leading"
      spacing={2}
      modifiers={[padding({ all: 4 }), containerBackground("#FFFFFF", "widget"), widgetURL("lostorfound://")]}
    >
      <Text modifiers={[font({ size: 12, weight: "heavy" }), foregroundStyle("#2563EB")]}>{props.heading}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 34, weight: "bold" }), foregroundStyle("#0F172A"), monospacedDigit()]}>{props.count}</Text>
      <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#475569"), lineLimit(1)]}>{props.countLabel}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#0F172A"), lineLimit(2)]}>{props.line1}</Text>
      {props.line2 ? <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle("#475569"), lineLimit(1)]}>{props.line2}</Text> : null}
    </VStack>
  );
};

const WIDGET_NAME = "LofCases";

let widget: Widget<CasesWidgetProps> | null | undefined;
function getWidget(): Widget<CasesWidgetProps> | null {
  if (Platform.OS !== "ios") return null;
  if (widget !== undefined) return widget;
  try {
    widget = createWidget<CasesWidgetProps>(WIDGET_NAME, CasesWidget);
  } catch (e) {
    console.warn("[widget] not available", e);
    widget = null;
  }
  return widget;
}

/** The widget's texts for a summary (pure, for tests). */
export function casesWidgetProps(summary: Pick<HomeSummary, "activeCases" | "openMatches" | "unreadChats">, t: T): CasesWidgetProps {
  const news = Number(summary.openMatches || 0);
  const unread = Number(summary.unreadChats || 0);
  return {
    heading: t("widget.heading"),
    count: String(Math.max(0, Number(summary.activeCases || 0))),
    countLabel: t("widget.activeCases"),
    line1: summary.activeCases ? (news ? t("widget.news", { count: news }) : t("widget.quiet")) : t("widget.empty"),
    line2: unread ? t("widget.unread", { count: unread }) : "",
  };
}

/** Writes the latest numbers to the widget. Never throws. */
export async function updateCasesWidget(
  summary: Pick<HomeSummary, "activeCases" | "openMatches" | "unreadChats">,
  t: T,
): Promise<void> {
  try {
    const w = getWidget();
    if (!w || !(await liveActivitiesAvailable())) return;
    w.updateSnapshot(casesWidgetProps(summary, t));
  } catch (e) {
    console.warn("[widget] update failed", e);
  }
}
