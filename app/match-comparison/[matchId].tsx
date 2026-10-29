import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { theme } from "../../src/ui/theme";
function MatchComparisonRedirect() {
  const router = useRouter();
  const { matchId } = useLocalSearchParams<{ matchId?: string | string[] }>();
  const resolvedMatchId = Array.isArray(matchId) ? matchId[0] : matchId;
  useEffect(() => {
    if (resolvedMatchId) router.replace(`/matches/${resolvedMatchId}`);
    else router.back();
  }, [resolvedMatchId, router]);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.bg,
        }}
      >
        <ActivityIndicator />
      </View>
    </>
  );
}

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MatchComparisonRedirect);
