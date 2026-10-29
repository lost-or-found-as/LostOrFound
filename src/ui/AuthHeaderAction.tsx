import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nProvider";
import { theme } from "./theme";
import { isAnonymousUser } from "../lib/authGate";

export function AuthHeaderAction() {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading, signOut } = useAuth();
  const { t } = useI18n();
  // T1.9A: a guest has nothing to log out of; logging out would lose their found reports.
  const isGuest = isAnonymousUser(session?.user as any);

  if (loading) return null;

  const goLogin = () => {
    router.push({
      pathname: "/(auth)/login",
      params: { mode: "login", returnTo: pathname ?? "/start" },
    });
  };

  const onPressAuth = async () => {
    if (!session || isGuest) {
      goLogin();
      return;
    }

    try {
      await signOut();
    } finally {
      router.replace("/(auth)/login");
    }
  };

  const label = session && !isGuest ? t("profile.logout") : t("profile.login");

  return (
    <Pressable
      onPress={onPressAuth}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  text: {
    color: theme.colors.primary,
    fontWeight: "900",
    fontSize: 12,
  },
  pressed: {
    opacity: 0.85,
  },
});
