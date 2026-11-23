// src/ui/TrustPanel.tsx
// T1.9BP: trust tools at the top of a chat between the owner and the helper.
//   - Control question: the helper may ask something only the owner knows. The owner has three
//     tries per question (people remember wrong); the helper may ask up to three questions.
//   - Handover: safe meeting places, and the owner's four-digit code. The helper types the code
//     when they meet, and the case is solved (the same as both confirming).
//   - Thank-you card: after a solved case the owner can send one short card to the helper.
// Sightings (where nobody has the item) only get the thank-you card.
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nProvider";
import { theme } from "./theme";
import { Button } from "./kit";
import { InlineNotice } from "./InlineNotice";
import { userErrorMessage } from "../lib/userError";
import { haptic } from "../lib/haptics";
import {
  SAFE_PLACES,
  THANKS_DESIGNS,
  THANKS_ICONS,
  TRUST_TEXT_MAX,
  answerQuestion,
  askQuestion,
  confirmHandover,
  fetchTrust,
  judgeAnswer,
  mapsSearchUrl,
  sendThanks,
  type ThanksDesign,
  type TrustKind,
  type TrustState,
} from "../lib/trust";

export const THANKS_TONES: Record<ThanksDesign, { bg: string; fg: string }> = {
  HEART: { bg: "#FEF3C7", fg: "#92400E" },
  SUN: { bg: "#CCFBF1", fg: "#115E59" },
  STAR: { bg: "#EDE9FE", fg: "#5B21B6" },
};

type Props = { kind: TrustKind; id: string; refreshKey?: unknown; onResolved?: () => void; hidden?: boolean };

export function TrustPanel({ kind, id, refreshKey, onResolved, hidden }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<TrustState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [code, setCode] = useState("");
  const [design, setDesign] = useState<ThanksDesign>("HEART");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setState(await fetchTrust(kind, id));
    } catch {
      setState(null);
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // T1.9BQ: feel = "success" for a code accepted, a match confirmed or a card sent; "warning"
  // for an answer that did not match. A failed call always gives the warning tick.
  const run = async (fn: () => Promise<unknown>, after?: () => void, feel?: "success" | "warning") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (feel) haptic[feel]();
      after?.();
      await load();
    } catch (e) {
      haptic.warning();
      setError(userErrorMessage(e, t, "errors.generic", "trust"));
    } finally {
      setBusy(false);
    }
  };

  if (hidden || !state) return null;
  const owner = state.role === "OWNER";
  const q = state.question;
  const triesLeft = q ? Math.max(0, q.maxAttempts - q.attempts) : 0;

  const places = (
    <View style={s.block}>
      <Pressable accessibilityRole="button" onPress={() => setPlacesOpen((v) => !v)} style={s.rowHead}>
        <Ionicons name="people-outline" size={18} color={theme.colors.text} />
        <Text style={s.rowTitle}>{t("trust.placesTitle")}</Text>
        <Ionicons name={placesOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.textSecondary} />
      </Pressable>
      {placesOpen && (
        <>
          <Text style={s.body}>{t("trust.placesBody")}</Text>
          {SAFE_PLACES.map((p) => (
            <Pressable
              key={p.key}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(mapsSearchUrl(t(p.query), Platform.OS)).catch(() => {})}
              style={({ pressed }) => [s.place, pressed && s.pressed]}
            >
              <Ionicons name={p.icon as any} size={18} color={theme.colors.text} />
              <Text style={s.placeText}>{t(p.label)}</Text>
              <Ionicons name="open-outline" size={16} color={theme.colors.textSecondary} />
            </Pressable>
          ))}
        </>
      )}
    </View>
  );

  // ---- After the case is solved: the thank-you card. ----
  if (state.resolved) {
    if (state.thanks) {
      const tone = THANKS_TONES[state.thanks.design];
      return (
        <View style={[s.thanksCard, { backgroundColor: tone.bg }]}>
          <Ionicons name={THANKS_ICONS[state.thanks.design] as any} size={20} color={tone.fg} />
          <View style={s.flex1}>
            <Text style={[s.thanksLabel, { color: tone.fg }]}>{t(owner ? "trust.thanksSent" : "trust.thanksReceived")}</Text>
            <Text style={[s.thanksText, { color: tone.fg }]}>{t("trust.quoted", { text: state.thanks.message })}</Text>
          </View>
        </View>
      );
    }
    if (!owner) return null;
    return (
      <View style={s.card}>
        <Text style={s.title}>{t("trust.thanksTitle")}</Text>
        <Text style={s.body}>{t("trust.thanksBody")}</Text>
        <View style={s.designs}>
          {THANKS_DESIGNS.map((d) => (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ selected: design === d }}
              accessibilityLabel={t(`trust.design.${d}` as any)}
              onPress={() => setDesign(d)}
              style={[s.design, { backgroundColor: THANKS_TONES[d].bg }, design === d && s.designOn]}
            >
              <Ionicons name={THANKS_ICONS[d] as any} size={20} color={THANKS_TONES[d].fg} />
            </Pressable>
          ))}
        </View>
        <TextInput
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, TRUST_TEXT_MAX))}
          placeholder={t("trust.thanksPlaceholder")}
          placeholderTextColor={theme.colors.textSecondary}
          multiline
          style={[s.input, s.inputTall]}
          accessibilityLabel={t("trust.thanksTitle")}
        />
        <Text style={s.counter}>{t("trust.counter", { n: message.length, max: TRUST_TEXT_MAX })}</Text>
        {!!error && <InlineNotice tone="error" title={error} style={s.noMargin} />}
        <Button
          label={t("trust.thanksSend")}
          onPress={() => void run(() => sendThanks(kind, id, design, message.trim()), undefined, "success")}
          busy={busy}
          disabled={!message.trim()}
        />
      </View>
    );
  }

  if (!state.canHandOver) return null;

  // ---- Control question ----
  let questionView: React.ReactNode = null;
  if (owner) {
    if (q?.status === "ASKED") {
      questionView = (
        <View style={s.block}>
          <Text style={s.label}>{t("trust.questionFromFinder")}</Text>
          <Text style={s.quote}>{t("trust.quoted", { text: q.question })}</Text>
          {q.attempts > 0 && <Text style={s.warn}>{t("trust.retryOwner", { n: triesLeft })}</Text>}
          <TextInput
            value={answer}
            onChangeText={(v) => setAnswer(v.slice(0, TRUST_TEXT_MAX))}
            placeholder={t("trust.answerPlaceholder")}
            placeholderTextColor={theme.colors.textSecondary}
            style={s.input}
            accessibilityLabel={t("trust.answerPlaceholder")}
          />
          <Button
            label={t("trust.answerSend")}
            onPress={() => void run(() => answerQuestion(q.id, answer.trim()), () => setAnswer(""))}
            busy={busy}
            disabled={!answer.trim()}
          />
        </View>
      );
    } else if (q?.status === "ANSWERED") {
      questionView = <Text style={s.muted}>{t("trust.waitingForFinder")}</Text>;
    } else if (q?.status === "NO_MATCH") {
      questionView = <Text style={s.warn}>{t("trust.noMatchOwner")}</Text>;
    } else if (q?.status === "CONFIRMED") {
      questionView = <Text style={s.ok}>{t("trust.confirmedOwner")}</Text>;
    }
  } else {
    if (q?.status === "ASKED") {
      questionView = (
        <View style={s.block}>
          <Text style={s.label}>{t("trust.yourQuestion")}</Text>
          <Text style={s.quote}>{t("trust.quoted", { text: q.question })}</Text>
          <Text style={s.muted}>{q.attempts > 0 ? t("trust.waitingRetry", { n: triesLeft }) : t("trust.waitingForOwner")}</Text>
        </View>
      );
    } else if (q?.status === "ANSWERED") {
      questionView = (
        <View style={s.block}>
          <Text style={s.label}>{t("trust.yourQuestion")}</Text>
          <Text style={s.quote}>{t("trust.quoted", { text: q.question })}</Text>
          <Text style={s.label}>{t("trust.ownerAnswered", { n: q.attempts, max: q.maxAttempts })}</Text>
          <Text style={s.quote}>{t("trust.quoted", { text: q.answer || "" })}</Text>
          <View style={s.row}>
            <Button
              label={t("trust.notMatching")}
              variant="neutral"
              onPress={() =>
                void run(
                  () => judgeAnswer(q.id, false),
                  () => setNotice(t(triesLeft > 0 ? "trust.notMatchingSent" : "trust.noMatchHelper")),
                  "warning",
                )
              }
              style={s.flex1}
              disabled={busy}
            />
            <Button label={t("trust.matching")} onPress={() => void run(() => judgeAnswer(q.id, true), undefined, "success")} style={s.flex1} busy={busy} />
          </View>
        </View>
      );
    } else if (q?.status === "CONFIRMED") {
      questionView = <Text style={s.ok}>{t("trust.confirmedHelper")}</Text>;
    }
    if (state.canAsk && q?.status !== "ASKED" && q?.status !== "ANSWERED") {
      questionView = (
        <>
          {q?.status === "NO_MATCH" && <Text style={s.warn}>{t("trust.noMatchHelper")}</Text>}
          {askOpen ? (
            <View style={s.block}>
              <Text style={s.body}>{t("trust.askBody")}</Text>
              <TextInput
                value={question}
                onChangeText={(v) => setQuestion(v.slice(0, TRUST_TEXT_MAX))}
                placeholder={t("trust.askPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                style={s.input}
                accessibilityLabel={t("trust.askTitle")}
              />
              <Button
                label={t("trust.askSend")}
                onPress={() =>
                  void run(
                    () => askQuestion(kind, id, question.trim()),
                    () => {
                      setQuestion("");
                      setAskOpen(false);
                    },
                  )
                }
                busy={busy}
                disabled={question.trim().length < 3}
              />
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setAskOpen(true)} style={s.rowHead}>
              <Ionicons name="help-circle-outline" size={18} color={theme.colors.text} />
              <Text style={s.rowTitle}>{t("trust.askTitle")}</Text>
              <Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          )}
        </>
      );
    }
  }

  // ---- Handover ----
  const h = state.handover;
  const handoverView = owner ? (
    h?.code ? (
      <View style={s.codeBox}>
        <Text style={s.codeLabel}>{t("trust.codeLabel")}</Text>
        <Text style={s.code} accessibilityLabel={h.code.split("").join(" ")}>
          {h.code.split("").join(" ")}
        </Text>
        <Text style={s.codeHint}>{t("trust.codeHint")}</Text>
      </View>
    ) : null
  ) : (
    <View style={s.block}>
      <Text style={s.label}>{t("trust.enterCodeTitle")}</Text>
      <Text style={s.body}>{t("trust.enterCodeBody")}</Text>
      {h?.locked ? (
        <Text style={s.warn}>{t("trust.codeLocked")}</Text>
      ) : (
        <View style={s.row}>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="0000"
            placeholderTextColor={theme.colors.textSecondary}
            style={[s.input, s.codeInput]}
            accessibilityLabel={t("trust.enterCodeTitle")}
          />
          <Button
            label={t("trust.confirmHandover")}
            onPress={() =>
              void run(
                () => confirmHandover(kind, id, code),
                () => {
                  setCode("");
                  onResolved?.();
                },
                "success",
              )
            }
            busy={busy}
            disabled={code.length !== 4}
            style={s.flex1}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={s.card}>
      <View style={s.rowHead}>
        <Ionicons name="shield-checkmark-outline" size={18} color={theme.tone.info.icon} />
        <Text style={s.title}>{t("trust.title")}</Text>
      </View>
      {questionView}
      {places}
      {handoverView}
      {!!notice && <InlineNotice tone="info" title={notice} style={s.noMargin} />}
      {!!error && <InlineNotice tone="error" title={error} style={s.noMargin} />}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  block: { gap: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: theme.colors.text },
  title: { flex: 1, fontSize: 16, fontWeight: "900", color: theme.colors.text },
  label: { fontSize: 13, fontWeight: "800", color: theme.colors.textSecondary },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.colors.textSecondary },
  quote: { fontSize: 15, lineHeight: 21, fontWeight: "800", color: theme.colors.text },
  muted: { fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary },
  warn: { fontSize: 14, fontWeight: "700", color: theme.tone.warning.fg },
  ok: { fontSize: 14, fontWeight: "800", color: theme.tone.success.fg },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: 12,
    fontSize: 15,
    color: theme.colors.text,
  },
  inputTall: { minHeight: 72, paddingTop: 10, textAlignVertical: "top" },
  counter: { fontSize: 12, color: theme.colors.textSecondary, textAlign: "right" },
  codeInput: { width: 96, textAlign: "center", fontSize: 20, fontWeight: "900", letterSpacing: 4 },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  placeText: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.colors.text },
  pressed: { opacity: 0.7 },
  codeBox: { alignItems: "center", gap: 4, padding: 12, borderRadius: 12, backgroundColor: theme.tone.success.bg },
  codeLabel: { fontSize: 13, fontWeight: "800", color: theme.tone.success.fg },
  code: { fontSize: 32, fontWeight: "900", letterSpacing: 6, color: theme.tone.success.fg, fontVariant: ["tabular-nums"] },
  codeHint: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: theme.tone.success.fg, textAlign: "center" },
  designs: { flexDirection: "row", gap: 8 },
  design: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  designOn: { borderColor: theme.tone.info.icon },
  thanksCard: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, alignItems: "flex-start" },
  thanksLabel: { fontSize: 13, fontWeight: "800" },
  thanksText: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  flex1: { flex: 1 },
  noMargin: { marginTop: 0, marginBottom: 0 },
});
