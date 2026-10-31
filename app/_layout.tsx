import React from "react";
import { Stack } from "expo-router";
import { AuthProvider } from "../src/contexts/AuthContext";
import { I18nProvider } from "../src/i18n/I18nProvider";
// T1.9A: the shared header action shows "Log in" (not "Log out") for guests.
import { AuthHeaderAction } from "../src/ui/AuthHeaderAction";
import { ReportDraftProvider } from "../src/contexts/ReportDraftContext";
import { initializeSentry, Sentry } from "../src/lib/sentry";
import { usePushLanguageSync, usePushNotificationNavigation } from "../src/lib/pushNotifications";
import { useAuth } from "../src/contexts/AuthContext";
import { useI18n } from "../src/i18n/I18nProvider";
import { useIsGuest } from "../src/ui/AccountRequired";
initializeSentry();
function PushBridge() {
  usePushNotificationNavigation();
  // T1.9F: keep the push language on the server equal to the app language.
  const { user } = useAuth();
  const { language } = useI18n();
  const isGuest = useIsGuest();
  usePushLanguageSync(language, user?.id, isGuest);
  return null;
}
function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ReportDraftProvider>
          <PushBridge />
          <Stack screenOptions={{ headerRight: () => <AuthHeaderAction /> }}>
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
            <Stack.Screen name="safety-reports" options={{ headerShown: false }} />
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
