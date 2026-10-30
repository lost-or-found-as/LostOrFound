// app/start.tsx
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { theme } from "../src/ui/theme";
import { useAuth } from "../src/contexts/AuthContext";
import { PremiumHeader } from "../src/ui/PremiumHeader";
import { AuthHeaderAction } from "../src/ui/AuthHeaderAction";
import { useI18n } from "../src/i18n/I18nProvider";
import { isAnonymousUser } from "../src/lib/authGate";
import { useNewRegistration } from "../src/lib/newRegistration";
import { RegisterChoice } from "../src/ui/RegisterChoice";

export default function StartScreen() {
  // T1.9K: Profil → "Prøv ny registrering" shows the new start instead.
  const [newRegistration] = useNewRegistration();
  if (newRegistration)
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <RegisterChoice />
      </>
    );
  return <CurrentStartScreen />;
}

function CurrentStartScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const isGuest = isAnonymousUser(user as any);
  const [choice, setChoice] = useState<"LOST" | "FOUND">("LOST");

  const goCreate = () => {
    if (choice === "LOST" && (!user || isGuest)) {
      Alert.alert(
        t("start.accountRequiredTitle"),
        t("start.accountRequiredAlert"),
        [
          { text: t("start.cancel"), style: "cancel" },
          { text: t("start.loginOrCreate"), onPress: goLogin },
        ]
      );
      return;
    }
    router.push({
      pathname: "/(report)/create-report",
      params: { type: choice },
    });
  };

  const goLogin = () => {
    router.push({
      pathname: "/(auth)/login",
      params: { returnTo: "/start" },
    });
  };

  const goMyReports = () => {
    router.push("/my-reports");
  };
  const goNotifications = () => {
    router.push("/notifications");
  };

  const goBack = () => {
    try {
      router.back();
    } catch {}
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.safe}>
        {user ? (
          <PremiumHeader
            title={t("start.title")}
            subtitle={t("start.subtitle")}
            onBack={goBack}
            right={<AuthHeaderAction />}
          />
        ) : null}

        <View style={[styles.container, user ? styles.containerWithHeader : null]}>
          {!user ? (
            <Text style={styles.title}>
              {t("start.title")}
            </Text>
          ) : null}

          {!user ? (
            <Text style={styles.subtitle}>
              {t("start.subtitle")}
            </Text>
          ) : null}

          <View style={styles.segmented}>
            <Pressable
              style={[styles.segmentBtn, choice === "LOST" && styles.segmentBtnOn]}
              onPress={() => setChoice("LOST")}
            >
              <Text style={[styles.segmentTxt, choice === "LOST" && styles.segmentTxtOn]}>
                {t("start.lost")}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.segmentBtn, choice === "FOUND" && styles.segmentBtnOn]}
              onPress={() => setChoice("FOUND")}
            >
              <Text style={[styles.segmentTxt, choice === "FOUND" && styles.segmentTxtOn]}>
                {t("start.found")}
              </Text>
            </Pressable>
          </View>


          {choice === "LOST" && (!user || isGuest) ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeTitle}>{t("start.accountRequiredTitle")}</Text>
              <Text style={styles.noticeText}>
                {t("start.accountRequiredNotice")}
              </Text>
            </View>
          ) : null}
          <Pressable style={styles.primaryBtn} onPress={goCreate}>
            <Text style={styles.primaryTxt}>{t("start.cta")}</Text>
          </Pressable>

          {user ? (
            <Pressable style={styles.secondaryBtn} onPress={goMyReports}>
              <Text style={styles.secondaryTxt}>{t("start.myCases")}</Text>
            </Pressable>
          ) : null}          {user ? (
            <Pressable style={styles.secondaryBtn} onPress={goNotifications}>
              <Text style={styles.secondaryTxt}>{t("start.notifications")}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.secondaryBtn} onPress={goLogin}>
              <Text style={styles.secondaryTxt}>{t("common.login")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  container: {
    flex: 1,
    padding: theme.space.lg,
  },
  containerWithHeader: {
    paddingTop: theme.space.md,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: theme.colors.text,
  },
  subtitle: {
    marginTop: 6,
    color: theme.colors.muted,
    fontWeight: "600",
  },
  segmented: {
    marginTop: theme.space.lg,
    flexDirection: "row",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: theme.colors.card,
  },
  segmentBtnOn: {
    backgroundColor: theme.colors.primary,
  },
  segmentTxt: {
    fontWeight: "700",
    color: theme.colors.text,
  },
  segmentTxtOn: {
    color: "#fff",
  },
  noticeBox: {
    marginTop: theme.space.md,
    borderWidth: 1,
    borderColor: "#FDBA74",
    backgroundColor: "#FFF7ED",
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
  },
  noticeTitle: {
    color: "#9A3412",
    fontWeight: "900",
    marginBottom: 4,
  },
  noticeText: {
    color: "#9A3412",
    fontWeight: "700",
    lineHeight: 19,
  },
  primaryBtn: {
    marginTop: theme.space.xl,
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: theme.radius.lg,
    alignItems: "center",
  },
  primaryTxt: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 16,
  },
  secondaryBtn: {
    marginTop: theme.space.md,
    paddingVertical: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  secondaryTxt: {
    fontWeight: "700",
    color: theme.colors.text,
  },
});
