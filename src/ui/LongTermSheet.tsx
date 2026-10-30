// src/ui/LongTermSheet.tsx
// T1.9H: buy (or renew) a historic period for a LOST case: choose 1, 2 or 3 years, see the
// price with credit for paid extensions, and confirm. Test-mode payment until store products exist.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/I18nProvider";
import { formatDate, formatMoney } from "../i18n/formatters";
import { quoteLongTermWatch, type LongTermQuote } from "../lib/reportCommerce";
import { buyLongTermRequest, LONG_TERM_YEAR_OPTIONS } from "../lib/reportLifecycle";
import { userErrorMessage } from "../lib/userError";
import { theme } from "./theme";
import { InlineNotice } from "./InlineNotice";
import { BottomSheet, Button } from "./kit";

type Props = {
  visible: boolean;
  reportId: string;
  onClose: () => void;
  onDone: () => void;
};

export function LongTermSheet({ visible, reportId, onClose, onDone }: Props) {
  const { language, t } = useI18n();
  const [years, setYears] = useState<number>(1);
  const [quote, setQuote] = useState<LongTermQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    quoteLongTermWatch(reportId, years)
      .then((r) => !cancelled && setQuote(r.quote))
      .catch((e) => {
        if (cancelled) return;
        setQuote(null);
        setError(userErrorMessage(e, t, "longTerm.quoteFailed", "longTerm.quote"));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [visible, reportId, years, language]);

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      await buyLongTermRequest(reportId, years);
      onDone();
    } catch (e) {
      setError(userErrorMessage(e, t, "longTerm.buyFailed", "longTerm.buy"));
    } finally {
      setBusy(false);
    }
  };

  const money = (ore: number) => formatMoney(ore / 100, quote?.currency || "NOK", language);
  const renew = !!quote?.renew;

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t("common.cancel")}>
      <Text style={styles.title} accessibilityRole="header">
        {renew ? t("longTerm.renewTitle") : t("longTerm.title")}
      </Text>
      <Text style={styles.body}>{t("longTerm.body")}</Text>

      <View style={styles.years} accessibilityRole="radiogroup">
        {LONG_TERM_YEAR_OPTIONS.map((y) => {
          const selected = y === years;
          return (
            <Pressable
              key={y}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setYears(y)}
              style={[styles.year, selected && styles.yearSelected]}
            >
              <Text style={[styles.yearText, selected && styles.yearTextSelected]}>{t("longTerm.years", { count: y })}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.summary}>
        {loading || !quote ? (
          loading ? <ActivityIndicator color={theme.colors.primary} /> : null
        ) : (
          <>
            <Row label={t("longTerm.price", { count: quote.years })} value={money(quote.baseAmountOre)} />
            {quote.creditOre > 0 && (
              <Row label={t("longTerm.credit", { count: quote.creditedExtensions })} value={`− ${money(quote.creditOre)}`} />
            )}
            <View style={styles.divider} />
            <Row label={t("longTerm.toPay")} value={money(quote.amountOre)} strong />
            <Text style={styles.until}>{t("longTerm.until", { date: formatDate(quote.endsAt, language) })}</Text>
          </>
        )}
      </View>

      <Text style={styles.test}>{t("cases.test.payment.notice")}</Text>
      {!!error && <InlineNotice tone="warning" title={t("caseDetail.actionFailed")} body={error} style={styles.notice} />}

      <View style={styles.actions}>
        <Button label={t("common.cancel")} variant="neutral" onPress={onClose} style={styles.flex} disabled={busy} />
        <Button
          label={t("cases.complete.test.payment")}
          onPress={() => void buy()}
          style={styles.flex}
          busy={busy}
          disabled={!quote || loading}
        />
      </View>
    </BottomSheet>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: "900", color: theme.colors.text },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "500", color: "#334155" },
  years: { flexDirection: "row", gap: 8 },
  year: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  yearSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  yearText: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  yearTextSelected: { color: "#FFFFFF" },
  summary: { borderRadius: 14, backgroundColor: theme.colors.bg, padding: 14, gap: 8, minHeight: 64, justifyContent: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary },
  rowValue: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  strong: { fontSize: 16, fontWeight: "900", color: theme.colors.text },
  divider: { height: 1, backgroundColor: theme.colors.border },
  until: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  test: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: theme.colors.textSecondary },
  notice: { marginTop: 0 },
  actions: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
});
