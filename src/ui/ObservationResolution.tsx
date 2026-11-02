// src/ui/ObservationResolution.tsx
// T1.9W: the "case is resolved" part of an observation, shown on the detail screen ("card") and
// at the top of the observation chat ("bar"). Logic lives in src/lib/observationResolution.ts.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import type { ObservationResolutionController } from "../lib/observationResolution";
import { Button, ConfirmSheet } from "./kit";
import { InlineNotice } from "./InlineNotice";
import { theme } from "./theme";

type Props = {
  controller: ObservationResolutionController;
  variant?: "card" | "bar";
  // False hides the propose action (e.g. in a closed chat).
  canPropose?: boolean;
  // Label of the propose button in the card variant (e.g. "Jeg har fått den tilbake" for the owner).
  proposeLabel?: string;
};

export function ObservationResolution({ controller, variant = "card", canPropose = true, proposeLabel }: Props) {
  const { t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { status, role, busy, error, notice, propose, respond } = controller;

  const confirmPropose = async () => {
    await propose();
    setConfirmOpen(false);
  };

  let body: React.ReactNode = null;
  if (status === "ACCEPTED") {
    body = (
      <InlineNotice
        tone="success"
        icon="checkmark-circle-outline"
        title={t("observation.resolution.closedTitle")}
        body={t("observation.resolution.closedBody")}
        style={styles.noMargin}
      />
    );
  } else if (status === "PENDING" && role === "PROPOSER") {
    body =
      notice === "sent" ? (
        <InlineNotice
          tone="success"
          icon="paper-plane-outline"
          title={t("observation.resolution.sentTitle")}
          body={t("observation.resolution.sentBody")}
          style={styles.noMargin}
        />
      ) : (
        <InlineNotice tone="info" icon="time-outline" title={t("observation.resolution.pending")} style={styles.noMargin} />
      );
  } else if (status === "PENDING" && role === "RESPONDER") {
    body = (
      <View style={styles.respondBox}>
        <Text style={styles.respondText}>{t("observation.resolution.confirmQuestion")}</Text>
        <View style={styles.respondRow}>
          <Button
            label={t("observation.resolution.decline")}
            variant="neutral"
            onPress={() => void respond(false)}
            style={styles.flex1}
            disabled={busy}
          />
          <Button label={t("observation.resolution.confirm")} onPress={() => void respond(true)} style={styles.flex1} busy={busy} />
        </View>
      </View>
    );
  } else if (canPropose) {
    body =
      variant === "bar" ? (
        <View style={styles.resolveBar}>
          <Ionicons name="checkmark-circle-outline" size={20} color={theme.tone.success.icon} />
          <Text style={styles.resolveText}>{t("observation.resolution.question")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmOpen(true)}
            style={({ pressed }) => [styles.resolveBtn, pressed && styles.pressed]}
          >
            <Text style={styles.resolveBtnText}>{t("chat.markResolved")}</Text>
          </Pressable>
        </View>
      ) : (
        <Button label={proposeLabel ?? t("observation.resolution.proposeButton")} variant="neutral" onPress={() => setConfirmOpen(true)} />
      );
  }

  const rejected = notice === "rejected" && (
    <InlineNotice
      tone="info"
      icon="information-circle-outline"
      title={t("observation.resolution.rejectedTitle")}
      body={t("observation.resolution.rejectedBody")}
      style={styles.noMargin}
    />
  );

  if (!body && !error && !rejected) return null;

  return (
    <View style={styles.wrap}>
      {!!error && <InlineNotice tone="error" title={error} style={styles.noMargin} />}
      {rejected}
      {body}
      <ConfirmSheet
        visible={confirmOpen}
        title={t("observation.resolution.confirmTitle")}
        body={t("observation.resolution.proposeBody")}
        confirmLabel={t("observation.resolution.sendProposal")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmPropose()}
        onCancel={() => setConfirmOpen(false)}
        busy={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex1: { flex: 1 },
  noMargin: { marginTop: 0 },
  pressed: { opacity: 0.85 },
  resolveBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.tone.success.bg,
    borderWidth: 1,
    borderColor: theme.tone.success.border,
    borderRadius: 14,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 6,
  },
  resolveText: { flex: 1, fontSize: 13, fontWeight: "700", color: theme.tone.success.fg },
  resolveBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.tone.success.icon,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
  },
  resolveBtnText: { fontSize: 13, fontWeight: "800", color: theme.tone.success.fg },
  respondBox: {
    gap: 10,
    backgroundColor: theme.tone.info.bg,
    borderWidth: 1,
    borderColor: theme.tone.info.border,
    borderRadius: 14,
    padding: 12,
  },
  respondText: { fontSize: 14, fontWeight: "700", color: theme.tone.info.fg },
  respondRow: { flexDirection: "row", gap: 10 },
});
