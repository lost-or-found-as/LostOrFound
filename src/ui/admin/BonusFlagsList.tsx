// src/ui/admin/BonusFlagsList.tsx
// T1.9BB: admin list of accounts whose bonus looks arranged (friends giving each other bonus,
// most bonus from one or two accounts, many returns in a short time). Admin can withdraw a row.
// Accounts are shown by a short id only.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/I18nProvider";
import { formatDateTimeCustom } from "../../i18n/formatters";
import { userErrorMessage } from "../../lib/userError";
import { revokeBonusRow, shortId, type BonusFlag } from "../../lib/contentAdmin";
import type { TranslationKey } from "../../i18n/locales/en";
import { Button, ConfirmSheet, EmptyState } from "../kit";
import { InlineNotice } from "../InlineNotice";
import { theme } from "../theme";

export function BonusFlagsList({ flags, onChanged }: { flags: BonusFlag[]; onChanged: () => Promise<void> | void }) {
  const { language, t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await revokeBonusRow(pending);
      setPending(null);
      setError(null);
      await onChanged();
    } catch (e) {
      setPending(null);
      setError(userErrorMessage(e, t, "errors.generic", "admin.bonus"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.list}>
      <Text style={s.help}>{t("admin.bonus.help")}</Text>
      {!!error && <InlineNotice tone="error" title={error} />}
      {flags.length === 0 && <EmptyState icon="ribbon-outline" title={t("admin.bonus.empty")} />}
      {flags.map((f) => (
        <View key={f.userId} style={s.card}>
          <Text style={s.title}>{t("admin.bonus.account", { id: shortId(f.userId) })}</Text>
          <Text style={s.meta}>
            {f.reasons.map((r) => t(`admin.bonus.reason.${r}` as TranslationKey)).join(" · ")}
          </Text>
          <Text style={s.meta}>{t("admin.bonus.summary", { points: f.points, count: f.partners })}</Text>
          {f.rows.map((row) => (
            <View key={row.id} style={s.row}>
              <View style={s.flex1}>
                <Text style={s.rowText}>
                  {t(`bonus.event.${row.event}` as TranslationKey)} +{row.points}
                </Text>
                <Text style={s.rowMeta}>
                  {formatDateTimeCustom(new Date(row.at), language, { day: "numeric", month: "short" })} · {t("admin.bonus.with", { id: shortId(row.counterpart) })} · {t(`admin.bonus.status.${row.status}` as TranslationKey)}
                </Text>
              </View>
              {row.status !== "REVOKED" && <Button label={t("admin.bonus.revoke")} variant="danger" onPress={() => setPending(row.id)} />}
            </View>
          ))}
        </View>
      ))}
      <ConfirmSheet
        visible={!!pending}
        title={t("admin.bonus.revokeTitle")}
        body={t("admin.bonus.revokeBody")}
        confirmLabel={t("admin.bonus.revoke")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void revoke()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 12 },
  help: { fontSize: 13, color: theme.colors.textSecondary },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 14, gap: 8 },
  title: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  meta: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 8 },
  rowText: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  rowMeta: { fontSize: 12, color: theme.colors.textSecondary },
  flex1: { flex: 1 },
});
