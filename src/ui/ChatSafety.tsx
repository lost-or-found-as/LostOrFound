// T1.9M: ⋯ menu in a chat (report, block, safe hand-over tips) and the bar that replaces the
// message field when the chat is closed. Used by the match chat and the observation chat.
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { userErrorMessage } from "../lib/userError";
import {
  OPEN_CHAT,
  REPORT_REASONS,
  REPORT_REASON_KEYS,
  blockChatPartner,
  fetchChatState,
  reportChat,
  unblockChatPartner,
  type ChatKind,
  type ChatSafetyState,
  type ReportReason,
} from "../lib/chatSafety";
import { BottomSheet, Button, ConfirmSheet, IconButton, InfoSheet } from "./kit";
import { InlineNotice } from "./InlineNotice";
import { theme } from "./theme";

export type ChatPartner = "finder" | "owner" | "other";

/** Loads the chat's state (blocked, closed) and reloads it on demand, e.g. after a failed send. */
export function useChatSafety(kind: ChatKind, id: string | undefined) {
  const [state, setState] = useState<ChatSafetyState>(OPEN_CHAT);
  const reload = useCallback(async (): Promise<ChatSafetyState | null> => {
    if (!id) return null;
    try {
      const next = await fetchChatState(kind, id);
      setState(next);
      return next;
    } catch {
      return null;
    }
  }, [kind, id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, setState, reload };
}

type MenuProps = {
  kind: ChatKind;
  id: string;
  partner: ChatPartner;
  state: ChatSafetyState;
  onState: (state: ChatSafetyState) => void;
  /** Shown after a report was sent (for a thank-you notice in the chat). */
  onReported?: () => void;
  /** Extra paragraph in the hand-over tips sheet (how this chat works). */
  aboutText?: string;
};

export function ChatSafetyMenu({ kind, id, partner, state, onState, onReported, aboutText }: MenuProps) {
  const { t } = useI18n();
  const who = t(`safety.partner.${partner}` as const);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<null | "report" | "block" | "tips">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);

  const open = (next: "report" | "block" | "tips") => {
    setMenuOpen(false);
    setError(null);
    if (next === "report") {
      setReason(null);
      setDetails("");
      setAlsoBlock(!state.blockedByMe);
    }
    // Let the menu sheet close before the next one opens (two modals at once fail on iOS).
    setTimeout(() => setSheet(next), 350);
  };

  const run = async (work: () => Promise<ChatSafetyState>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      onState(await work());
      setSheet(null);
      after?.();
    } catch (e) {
      setError(userErrorMessage(e, t, "errors.generic", "chat.safety"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton icon="ellipsis-horizontal" label={t("safety.menuLabel")} onPress={() => setMenuOpen(true)} />

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} accessibilityLabel={t("common.close")}>
        <Text style={s.title} accessibilityRole="header">
          {t("safety.menuTitle")}
        </Text>
        <View>
          <MenuRow icon="flag-outline" label={t("safety.report")} hint={t("safety.reportHint")} onPress={() => open("report")} />
          {state.blockedByMe ? (
            <MenuRow icon="lock-open-outline" label={t("safety.unblock", { who })} hint={t("safety.unblockHint")} onPress={() => void run(() => unblockChatPartner(kind, id), () => setMenuOpen(false))} />
          ) : (
            <MenuRow icon="ban-outline" danger label={t("safety.block", { who })} hint={t("safety.blockHint")} onPress={() => open("block")} />
          )}
          <MenuRow icon="shield-checkmark-outline" label={t("safety.tips")} hint={t("safety.tipsHint")} onPress={() => open("tips")} />
        </View>
        {!!error && <InlineNotice tone="error" title={error} style={s.noMargin} />}
        <Button label={t("common.close")} variant="neutral" onPress={() => setMenuOpen(false)} />
      </BottomSheet>

      <ConfirmSheet
        visible={sheet === "block"}
        title={t("safety.blockTitle", { who })}
        body={error ?? t("safety.blockBody")}
        confirmLabel={t("safety.blockConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() => void run(() => blockChatPartner(kind, id))}
      />

      <InfoSheet visible={sheet === "tips"} onClose={() => setSheet(null)} title={t("safety.tips")} body={t("safety.tipsBody")} closeLabel={t("common.close")}>
        {!!aboutText && <Text style={s.about}>{aboutText}</Text>}
      </InfoSheet>

      <BottomSheet visible={sheet === "report"} onClose={() => setSheet(null)} accessibilityLabel={t("common.cancel")}>
        <View style={s.headBlock}>
          <Text style={s.title} accessibilityRole="header">
            {t("safety.reportTitle")}
          </Text>
          <Text style={s.body}>{t("safety.reportBody", { who })}</Text>
        </View>
        <View style={s.reasons} accessibilityRole="radiogroup" accessibilityLabel={t("safety.reasonLabel")}>
          {REPORT_REASONS.map((key) => {
            const selected = reason === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setReason(key)}
                style={({ pressed }) => [s.reason, selected && s.reasonOn, pressed && s.pressed]}
              >
                <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={theme.colors.primary} />
                <Text style={[s.reasonText, selected && s.reasonTextOn]}>{t(REPORT_REASON_KEYS[key])}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder={t("safety.detailsPlaceholder")}
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel={t("safety.detailsLabel")}
          style={s.details}
          multiline
          maxLength={1000}
        />
        {!state.blockedByMe && (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: alsoBlock }}
            onPress={() => setAlsoBlock((v) => !v)}
            style={({ pressed }) => [s.check, pressed && s.pressed]}
          >
            <Ionicons name={alsoBlock ? "checkbox" : "square-outline"} size={24} color={theme.colors.primary} />
            <Text style={s.checkText}>{t("safety.alsoBlock", { who })}</Text>
          </Pressable>
        )}
        {!!error && <InlineNotice tone="error" title={error} style={s.noMargin} />}
        <Button
          label={t("safety.sendReport")}
          disabled={!reason}
          busy={busy}
          onPress={() =>
            reason &&
            void run(() => reportChat(kind, id, { reason, details, block: alsoBlock || state.blockedByMe }), onReported)
          }
        />
      </BottomSheet>
    </>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  danger,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
      <Ionicons name={icon} size={22} color={danger ? theme.colors.dangerStrong : theme.colors.text} />
      <View style={s.rowText}>
        <Text style={[s.rowLabel, danger && s.danger]}>{label}</Text>
        <Text style={s.rowHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

/** Replaces the message field when the chat is closed. */
export function ChatClosedBar({
  state,
  partner,
  onUnblock,
  busy,
  bottomInset = 0,
}: {
  state: ChatSafetyState;
  partner: ChatPartner;
  onUnblock: () => void;
  busy?: boolean;
  bottomInset?: number;
}) {
  const { t } = useI18n();
  const who = t(`safety.partner.${partner}` as const);
  const [title, body, icon] = state.blockedByMe
    ? [t("safety.blockedTitle", { who }), t("safety.blockedBody"), "ban-outline" as const]
    : state.selfSuspended
      ? [t("safety.suspendedTitle"), t("safety.suspendedBody"), "lock-closed-outline" as const]
      : [t("safety.closedTitle"), t("safety.closedBody"), "lock-closed-outline" as const];
  return (
    <View style={[s.closed, { paddingBottom: Math.max(16, bottomInset + 8) }]}>
      <View style={s.closedRow}>
        <Ionicons name={icon} size={22} color={state.blockedByMe ? theme.colors.dangerStrong : theme.colors.textSecondary} />
        <View style={s.rowText}>
          <Text style={s.closedTitle}>{title}</Text>
          <Text style={s.rowHint}>{body}</Text>
        </View>
      </View>
      {state.blockedByMe && <Button label={t("safety.unblockShort")} variant="neutral" busy={busy} onPress={onUnblock} />}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 19, fontWeight: "900", color: theme.colors.text },
  headBlock: { gap: 4 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  about: { fontSize: 15, lineHeight: 22, fontWeight: "500", color: "#334155" },
  noMargin: { marginTop: 0, marginBottom: 0 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 12, paddingHorizontal: 4, paddingVertical: 6 },
  rowPressed: { backgroundColor: theme.colors.divider },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  rowHint: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.colors.textSecondary },
  danger: { color: theme.colors.dangerStrong },
  reasons: { gap: 8 },
  reason: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reasonOn: { borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: "#F8FAFC" },
  reasonText: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.colors.text },
  reasonTextOn: { fontWeight: "800" },
  details: {
    minHeight: 64,
    maxHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    paddingTop: 12,
    fontSize: 15,
    color: theme.colors.text,
  },
  check: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  checkText: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.colors.text },
  pressed: { opacity: 0.85 },
  closed: {
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  closedRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  closedTitle: { fontSize: 15, fontWeight: "900", color: theme.colors.text },
});
