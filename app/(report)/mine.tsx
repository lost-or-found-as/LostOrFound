// app/reports/mine.tsx
import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/ui/theme";

type Report = {
  id: string;
  type: "LOST" | "FOUND";
  title: string;
  created_at: string;
};

function MyReportsScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const r = await fetch(`${API_BASE_URL}/reports/mine`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await r.json();
      setReports(data.reports || []);
      setLoading(false);
    };

    load();
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Mine rapporter" }} />
      <SafeAreaView style={styles.safe}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>Laster rapporter…</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>
              Du har ingen rapporter ennå.
            </Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={{ padding: theme.space.lg }}
            data={reports}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: "/match",
                    params: { reportId: item.id },
                  })
                }
              >
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.meta}>
                  {item.type === "LOST" ? "Mistet" : "Funnet"} •{" "}
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
                <Text style={styles.link}>Se matcher →</Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: {
    marginTop: 8,
    color: theme.colors.muted,
    fontWeight: "600",
  },
  card: {
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: theme.space.md,
  },
  title: {
    fontWeight: "900",
    fontSize: 16,
    color: theme.colors.text,
  },
  meta: {
    marginTop: 4,
    color: theme.colors.muted,
    fontWeight: "600",
  },
  link: {
    marginTop: 8,
    fontWeight: "700",
    color: theme.colors.primary,
  },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(MyReportsScreen);
