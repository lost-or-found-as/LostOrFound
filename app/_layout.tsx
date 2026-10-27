import React from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { AuthProvider, useAuth } from "../src/contexts/AuthContext";
import { I18nProvider, useI18n } from "../src/i18n/I18nProvider";
import { ReportDraftProvider } from "../src/contexts/ReportDraftContext";
import { initializeSentry, Sentry } from "../src/lib/sentry";
import { usePushNotificationNavigation } from "../src/lib/pushNotifications";
initializeSentry();
function HeaderRight() {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading, signOut } = useAuth();
  const { t } = useI18n();
  if (loading) return null;
  const goLogin = () =>
    router.push({
      pathname: "/(auth)/login",
      params: { returnTo: pathname ?? "/start" },
    });
  const logout = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };
  if (!session)
    return (
      <Pressable onPress={goLogin} style={{ paddingHorizontal: 12 }}>
        <Text style={{ color: "#1a73e8", fontWeight: "700" }}>
          {t("common.login")}
        </Text>
      </Pressable>
    );
  return (
    <Pressable onPress={logout} style={{ paddingHorizontal: 12 }}>
      <Text style={{ color: "#1a73e8", fontWeight: "700" }}>
        {t("common.logout")}
      </Text>
    </Pressable>
  );
}
function PushBridge() {
  usePushNotificationNavigation();
  return null;
}
function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ReportDraftProvider>
          <PushBridge />
          <Stack screenOptions={{ headerRight: () => <HeaderRight /> }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(report)" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="my-reports" options={{ headerShown: false }} />
            <Stack.Screen name="match" options={{ headerShown: false }} />
            <Stack.Screen
              name="matches/[matchId]"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="chat/[matchId]"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="notifications"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="push-settings"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="start" options={{ headerShown: false }} />
            <Stack.Screen
              name="report-details/[id]"
              options={{ headerShown: false }}
            />
          </Stack>
        </ReportDraftProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
export default Sentry.wrap(RootLayout);
