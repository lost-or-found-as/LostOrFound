// src/ui/PetSearchTips.tsx
// T1.9BR: «Slik leter du» on a lost animal case: a short tip for the kind of animal, and a
// checklist the owner can tick off (kept on this phone). The last item opens the poster.
import React, { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { theme } from "./theme";
import { haptic } from "../lib/haptics";
import * as Localization from "expo-localization";
import { PET_TIPS, loadTicks, petKind, saveTicks, tipItems, toggleTick } from "../lib/petSearchTips";

type Props = { reportId: string; petName: string | null; subcategoryKey: string | null; onPoster?: () => void };

export function PetSearchTips({ reportId, petName, subcategoryKey, onPoster }: Props) {
  const { t } = useI18n();
  const kind = petKind(subcategoryKey);
  const tips = PET_TIPS[kind];
  // T1.9BR: the chip registry follows the phone's region (DyreID in Norway).
  const items = tipItems(kind, Localization.getLocales()[0]?.regionCode ?? null);
  const [ticks, setTicks] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void loadTicks(reportId).then((x) => live && setTicks(x));
    return () => {
      live = false;
    };
  }, [reportId]);

  const toggle = (id: string) => {
    haptic.tap();
    const next = toggleTick(ticks, id);
    setTicks(next);
    void saveTicks(reportId, next);
  };

  const done = items.filter((i) => ticks.includes(i.id)).length;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Ionicons name="paw-outline" size={20} color="#6D28D9" />
        <Text style={s.title} accessibilityRole="header">
          {petName ? t("petTips.titleNamed", { name: petName }) : t("petTips.title")}
        </Text>
      </View>
      <Text style={s.lead}>{t(tips.lead)}</Text>
      {items.map((item) => {
        const on = ticks.includes(item.id);
        return (
          <View key={item.id} style={s.row}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={t(item.label)}
              onPress={() => toggle(item.id)}
              hitSlop={6}
              style={[s.box, on && s.boxOn]}
            >
              {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </Pressable>
            <Text style={[s.item, on && s.itemDone]} onPress={() => toggle(item.id)}>
              {t(item.label)}
            </Text>
            {item.link ? (
              <Pressable accessibilityRole="link" accessibilityLabel={t("petTips.openLink")} hitSlop={8} onPress={() => void Linking.openURL(item.link!).catch(() => {})}>
                <Ionicons name="open-outline" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            ) : item.id === "poster" && onPoster ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("caseDetail.share.poster")} hitSlop={8} onPress={onPoster}>
                <Ionicons name="print-outline" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Text style={s.progress}>{t("petTips.progress", { done, total: items.length })}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "900", color: theme.colors.text },
  lead: { fontSize: 14, lineHeight: 20, fontWeight: "700", color: "#5B21B6", backgroundColor: "#EDE9FE", borderRadius: 12, padding: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: theme.tone.success.icon, borderColor: theme.tone.success.icon },
  item: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "600", color: theme.colors.text },
  itemDone: { color: theme.colors.textSecondary, textDecorationLine: "line-through" },
  progress: { fontSize: 13, fontWeight: "700", color: theme.colors.textSecondary },
});
