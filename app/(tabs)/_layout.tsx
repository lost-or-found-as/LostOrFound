// app/(tabs)/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tabs, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/contexts/AuthContext";
import { useI18n } from "../../src/i18n/I18nProvider";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/ui/theme";
import { isAnonymousUser } from "../../src/lib/authGate";

async function getUnreadCount(token: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? "Could not fetch unread notifications");
  const count = Number(data?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useAuth();
  const { t } = useI18n();
  const isGuest = isAnonymousUser(session?.user as any);

  // T1.9A: guests see a small lock on features that need an account.
  const withLock = (icon: React.ReactNode) =>
    isGuest ? (
      <View>
        {icon}
        <View style={styles.lock}>
          <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
        </View>
      </View>
    ) : (
      icon
    );
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setUnreadCount(0);
        return;
      }
      setUnreadCount(await getUnreadCount(token));
    } catch {
      setUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    if (!session || isGuest) {
      setUnreadCount(0);
      return;
    }
    refreshUnreadCount();
  }, [session, isGuest, pathname, refreshUnreadCount]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="cases"
        options={{
          title: t("tabs.cases"),
          tabBarIcon: ({ color, size, focused }) => (
            withLock(<Ionicons name={focused ? "folder-open" : "folder-open-outline"} color={color} size={size} />)
          ),
        }}
      />

      <Tabs.Screen
        name="report"
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push("/start");
          },
        }}
        options={{
          title: t("tabs.report"),
          tabBarIcon: () => (
            <View style={styles.reportButton}>
              <Ionicons name="add" color="#FFFFFF" size={30} />
            </View>
          ),
          tabBarLabelStyle: [styles.label, styles.reportLabel],
        }}
      />

      <Tabs.Screen
        name="alerts"
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push("/notifications");
          },
        }}
        options={{
          title: t("notifications.title"),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarBadgeStyle: styles.badge,
          tabBarIcon: ({ color, size }) => (
            withLock(<Ionicons name="notifications-outline" color={color} size={size} />)
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen name="matches" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 76,
    paddingTop: 7,
    paddingBottom: 9,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
  },
  reportLabel: {
    marginTop: 5,
  },
  reportButton: {
    width: 54,
    height: 54,
    marginTop: -23,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    borderWidth: 4,
    borderColor: theme.colors.card,
    ...theme.shadow.card,
  },
  lock: {
    position: "absolute",
    top: -3,
    right: -7,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#475569",
    borderWidth: 2,
    borderColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    backgroundColor: "#DC2626",
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
});
