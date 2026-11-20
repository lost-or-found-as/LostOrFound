// src/ui/admin/ReportedCasesList.tsx
// T1.9BB: admin list of reported cases. A hidden case can be shown again or kept hidden; a case
// still visible can be hidden or the reports closed with no action. No names or e-mail addresses.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/I18nProvider";
import { formatDateTimeCustom } from "../../i18n/formatters";
import { caseTitle } from "../../lib/caseDisplay";
import { userErrorMessage } from "../../lib/userError";
import { closeCaseReports, hideCase, restoreCase, type ReportedCase } from "../../lib/contentAdmin";
import type { TranslationKey } from "../../i18n/locales/en";
import { Button, ConfirmSheet, EmptyState } from "../kit";
import { InlineNotice } from "../InlineNotice";
import { theme } from "../theme";

type Pending = { kind: "restore" | "hide" | "close"; item: ReportedCase } | null;

export function ReportedCasesList({ items, onChanged }: { items: ReportedCase[]; onChanged: () => Promise<void> | void }) {
  const { language, t } = useI18n();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const id = pending.item.reportId;
      if (pending.kind === "restore") await restoreCase(id);
      else if (pending.kind === "hide") await hideCase(id);
      else await closeCaseReports(id);
      setPending(null);
      setError(null);
      await onChanged();
    } catch (e) {
      setPending(null);
      setError(userErrorMessage(e, t, "errors.generic", "admin.content"));
    } finally {
      setBusy(false);
    }
  };

  const hidden = (it: ReportedCase) => !!it.report?.hidden_at;
  const confirm =
    pending?.kind === "restore"
      ? { title: t("admin.content.restoreTitle"), body: t("admin.content.restoreBody"), label: t("admin.content.restore"), destructive: false }
      : pending?.kind === "hide"
        ? { title: t("admin.content.hideTitle"), body: t("admin.content.hideBody"), label: t("admin.content.hide"), destructive: true }
        : pending
          ? {
              title: hidden(pending.item) ? t("admin.content.keepTitle") : t("admin.content.noActionTitle"),
              body: hidden(pending.item) ? t("admin.content.keepBody") : t("admin.content.noActionBody"),
              label: hidden(pending.item) ? t("admin.content.keep") : t("admin.content.noAction"),
              destructive: false,
            }
          : null;

  return (
    <View style={s.list}>
      {!!error && <InlineNotice tone="error" title={error} />}
      {items.length === 0 && <EmptyState icon="shield-checkmark-outline" title={t("admin.content.empty")} />}
      {items.map((it) => {
        const r = it.report;
        const reasons = [...new Set(it.reports.map((x) => x.reason))].map((x) => t(`contentReport.reason.${x}` as TranslationKey));
        const comments = it.reports.map((x) => x.comment).filter(Boolean) as string[];
        const latest = it.reports[0]?.at;
        return (
          <View key={it.reportId} style={s.card}>
            <View style={s.top}>
              <Text style={s.title} numberOfLines={1}>
                {r ? `${t(r.type === "FOUND" ? "admin.content.found" : "admin.content.lost")}: ${caseTitle(r as any, language)}` : t("admin.content.deleted")}
              </Text>
              <Text style={[s.badge, hidden(it) ? s.badgeHidden : s.badgeVisible]}>
                {hidden(it) ? t("admin.content.hidden") : t("admin.content.visible")}
              </Text>
            </View>
            <Text style={s.meta}>
              {t("admin.content.count", { count: it.reports.length })} · {reasons.join(", ")}
              {latest ? ` · ${formatDateTimeCustom(new Date(latest), language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
            </Text>
            {!!r?.description && <Text style={s.quote} numberOfLines={4}>«{r.description}»</Text>}
            {!!r?.location_label && <Text style={s.meta}>{r.location_label}</Text>}
            {comments.slice(0, 3).map((c, i) => (
              <Text key={i} style={s.comment}>– {c}</Text>
            ))}
            {r && (
              <View style={s.actions}>
                {hidden(it) ? (
                  <>
                    <Button label={t("admin.content.restore")} variant="secondary" style={s.flex1} onPress={() => setPending({ kind: "restore", item: it })} />
                    <Button label={t("admin.content.keep")} variant="neutral" style={s.flex1} onPress={() => setPending({ kind: "close", item: it })} />
                  </>
                ) : (
                  <>
                    <Button label={t("admin.content.noAction")} variant="neutral" style={s.flex1} onPress={() => setPending({ kind: "close", item: it })} />
                    <Button label={t("admin.content.hide")} variant="danger" style={s.flex1} onPress={() => setPending({ kind: "hide", item: it })} />
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}
      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.title ?? ""}
        body={confirm?.body}
        confirmLabel={confirm?.label ?? ""}
        cancelLabel={t("common.cancel")}
        destructive={confirm?.destructive}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void act()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 12 },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 14, gap: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "800", color: theme.colors.text },
  badge: { fontSize: 12, fontWeight: "800", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  badgeHidden: { color: theme.tone.error.fg, backgroundColor: theme.tone.error.bg },
  badgeVisible: { color: theme.tone.warning.fg, backgroundColor: theme.tone.warning.bg },
  meta: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
  quote: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.text, backgroundColor: theme.colors.bg, borderRadius: 12, padding: 10 },
  comment: { fontSize: 13, color: theme.colors.text },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  flex1: { flex: 1 },
});
