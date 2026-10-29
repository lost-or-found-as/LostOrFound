// app/commerce-test.tsx
import { requireAccount } from "../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { API_BASE_URL } from "../src/lib/config";
import { supabase } from "../src/lib/supabase";
import {
  activateTestReportOrder,
  createReportOrder,
  fetchReportProductCatalog,
  quoteGeoAlert,
} from "../src/lib/reportCommerce";
import { REPORT_PRODUCT_CODES } from "../src/lib/reportProducts";
import { theme } from "../src/ui/theme";

type LostReport = {
  id: string;
  title?: string | null;
  status?: string | null;
  created_at?: string | null;
  occurred_at?: string | null;
  location_label?: string | null;
};

type TestLog = {
  at: string;
  label: string;
  ok: boolean;
  details: string;
};

function newRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function CommerceTestScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<LostReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<TestLog[]>([]);
  const [lastOrderId, setLastOrderId] = useState("");
  const [idempotencyRequestId, setIdempotencyRequestId] = useState("");

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId]
  );

  const addLog = useCallback((label: string, ok: boolean, value: unknown) => {
    setLogs((current) => [
      {
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        label,
        ok,
        details: pretty(value),
      },
      ...current,
    ]);
  }, []);

  const accessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("AUTH_REQUIRED");
    return token;
  }, []);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const token = await accessToken();
      const response = await fetch(`${API_BASE_URL}/reports/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `HTTP_${response.status}`);
      const lost = ((data?.reports ?? []) as LostReport[]).filter(
        (report: any) => String(report?.type || "").toUpperCase() === "LOST"
      );
      setReports(lost);
      setSelectedReportId((current) => current || lost[0]?.id || "");
      addLog("Hent LOST-rapporter", true, { count: lost.length });
    } catch (error: any) {
      addLog("Hent LOST-rapporter", false, error?.message || error);
      Alert.alert("Testfeil", error?.message || "Kunne ikke hente rapporter.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, addLog]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const run = useCallback(
    async (label: string, action: () => Promise<any>) => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await action();
        addLog(label, true, result);
        return result;
      } catch (error: any) {
        addLog(label, false, error?.message || error);
        Alert.alert("Testfeil", `${label}: ${error?.message || "Ukjent feil"}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [addLog, busy]
  );

  const requireReport = useCallback(() => {
    if (!selectedReportId) throw new Error("Velg en LOST-rapport først.");
    return selectedReportId;
  }, [selectedReportId]);

  const testCatalog = () => run("Produktkatalog", () => fetchReportProductCatalog());

  const testQuote = () =>
    run("Geovarselpris", () =>
      quoteGeoAlert(requireReport(), {
        areaSqKm: 3,
        populationDensityBand: "HIGH",
        estimatedEligibleUsers: 750,
        durationHours: 72,
        reminderCount: 1,
      })
    );

  const createReactivation = async () => {
    const requestId = newRequestId("reactivation");
    setIdempotencyRequestId(requestId);
    const result = await run("Opprett reaktiveringsordre", () =>
      createReportOrder({
        reportId: requireReport(),
        productCode: REPORT_PRODUCT_CODES.REPORT_REACTIVATION,
        clientRequestId: requestId,
        platform: "TEST",
        provider: "TEST",
      })
    );
    const orderId = result?.order?.id;
    if (orderId) setLastOrderId(orderId);
  };

  const repeatReactivation = async () => {
    if (!idempotencyRequestId) {
      Alert.alert("Mangler testordre", "Opprett reaktiveringsordre først.");
      return;
    }
    await run("Gjenta samme request-ID", () =>
      createReportOrder({
        reportId: requireReport(),
        productCode: REPORT_PRODUCT_CODES.REPORT_REACTIVATION,
        clientRequestId: idempotencyRequestId,
        platform: "TEST",
        provider: "TEST",
      })
    );
  };

  const activateLastOrder = async () => {
    if (!lastOrderId) {
      Alert.alert("Mangler ordre", "Opprett en ordre først.");
      return;
    }
    await run("Aktiver siste testordre", () => activateTestReportOrder(lastOrderId));
  };

  const createLongTerm = async () => {
    const result = await run("Opprett langtidsordre", () =>
      createReportOrder({
        reportId: requireReport(),
        productCode: REPORT_PRODUCT_CODES.LONG_TERM_WATCH_ANNUAL,
        clientRequestId: newRequestId("longterm"),
        platform: "TEST",
        provider: "TEST",
        occurredPrecision: "YEAR",
        occurredYear: 2020,
        occurredMonth: null,
      })
    );
    const orderId = result?.order?.id;
    if (orderId) setLastOrderId(orderId);
  };

  const createGeoAlert = async () => {
    const result = await run("Opprett geovarselordre", () =>
      createReportOrder({
        reportId: requireReport(),
        productCode: "GEO_ALERT",
        clientRequestId: newRequestId("geo"),
        platform: "TEST",
        provider: "TEST",
        geoAlert: {
          geometryType: "CIRCLE",
          radiusM: 1500,
          areaSqKm: 7.07,
          populationDensityBand: "HIGH",
          estimatedEligibleUsers: 750,
          durationHours: 72,
          reminderCount: 1,
        },
      })
    );
    const orderId = result?.order?.id;
    if (orderId) setLastOrderId(orderId);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>Tilbake</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Commerce API-test</Text>
            <Text style={styles.subtitle}>Kun kontrollert preview-test, ingen ekte betaling</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>Testmodus</Text>
            <Text style={styles.warningText}>
              Testaktivering virker bare for UUID-er i REPORT_COMMERCE_TEST_USER_IDS. Geovarsel sender ikke push.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>1. Velg LOST-rapport</Text>
              <Pressable onPress={() => void loadReports()} disabled={loading || busy}>
                <Text style={styles.link}>Oppdater</Text>
              </Pressable>
            </View>
            {loading ? (
              <ActivityIndicator style={{ marginTop: 16 }} />
            ) : reports.length === 0 ? (
              <Text style={styles.muted}>Ingen tilgjengelige LOST-rapporter.</Text>
            ) : (
              reports.map((report) => {
                const active = selectedReportId === report.id;
                return (
                  <Pressable
                    key={report.id}
                    style={[styles.reportRow, active && styles.reportRowActive]}
                    onPress={() => setSelectedReportId(report.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reportTitle, active && styles.reportTitleActive]}>
                        {report.title || "Mistet rapport"}
                      </Text>
                      <Text style={styles.reportMeta}>
                        {report.status || "UKJENT"} · {report.location_label || "Uten sted"}
                      </Text>
                    </View>
                    <Text style={styles.radio}>{active ? "●" : "○"}</Text>
                  </Pressable>
                );
              })
            )}
            {!!selectedReport && <Text style={styles.idText}>ID: {selectedReport.id}</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>2. Katalog og pris</Text>
            <TestButton title="Hent produktkatalog" onPress={testCatalog} disabled={busy} />
            <TestButton title="Beregn geovarselpris" onPress={testQuote} disabled={busy || !selectedReportId} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>3. Reaktivering og idempotens</Text>
            <TestButton title="Opprett reaktiveringsordre" onPress={() => void createReactivation()} disabled={busy || !selectedReportId} />
            <TestButton title="Gjenta samme request-ID" onPress={() => void repeatReactivation()} disabled={busy || !idempotencyRequestId} secondary />
            <TestButton title="Aktiver siste testordre" onPress={() => void activateLastOrder()} disabled={busy || !lastOrderId} danger />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>4. Langtidsvakt</Text>
            <Text style={styles.muted}>Testen bruker usikker tapsdato med årstall 2020.</Text>
            <TestButton title="Opprett langtidsordre" onPress={() => void createLongTerm()} disabled={busy || !selectedReportId} />
            <TestButton title="Aktiver siste testordre" onPress={() => void activateLastOrder()} disabled={busy || !lastOrderId} danger />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>5. Geovarselkampanje</Text>
            <Text style={styles.muted}>Test: sirkel 1,5 km, 7,07 km², høy tetthet, 750 kvalifiserte brukere, 72 timer.</Text>
            <TestButton title="Opprett geovarselordre" onPress={() => void createGeoAlert()} disabled={busy || !selectedReportId} />
            <TestButton title="Aktiver siste testordre" onPress={() => void activateLastOrder()} disabled={busy || !lastOrderId} danger />
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Testlogg</Text>
              <Pressable onPress={() => setLogs([])}><Text style={styles.link}>Tøm</Text></Pressable>
            </View>
            {logs.length === 0 ? (
              <Text style={styles.muted}>Ingen tester kjørt ennå.</Text>
            ) : (
              logs.map((log, index) => (
                <View key={`${log.at}-${index}`} style={styles.logItem}>
                  <Text style={[styles.logTitle, { color: log.ok ? "#15803D" : "#B91C1C" }]}>
                    {log.ok ? "OK" : "FEIL"} · {log.label} · {log.at}
                  </Text>
                  <Text selectable style={styles.logDetails}>{log.details}</Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </>
  );
}

function TestButton(props: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return (
    <Pressable
      style={[
        styles.button,
        props.secondary && styles.buttonSecondary,
        props.danger && styles.buttonDanger,
        props.disabled && styles.buttonDisabled,
      ]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={[styles.buttonText, props.secondary && styles.buttonSecondaryText]}>{props.title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingTop: 56, paddingHorizontal: 18, paddingBottom: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.card },
  backButton: { paddingVertical: 8, paddingRight: 14 },
  backText: { color: theme.colors.primary, fontWeight: "900" },
  headerText: { flex: 1 },
  title: { color: theme.colors.text, fontWeight: "900", fontSize: 21 },
  subtitle: { color: theme.colors.muted, fontWeight: "600", marginTop: 3, fontSize: 12 },
  content: { padding: 14, paddingBottom: 50 },
  warningCard: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: "#FCD34D", backgroundColor: "#FFFBEB", marginBottom: 12 },
  warningTitle: { color: "#92400E", fontWeight: "900" },
  warningText: { color: "#92400E", marginTop: 5, lineHeight: 18, fontWeight: "600" },
  card: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 15, marginBottom: 12 },
  cardTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { color: theme.colors.primary, fontWeight: "900" },
  muted: { color: theme.colors.muted, fontWeight: "600", lineHeight: 18, marginTop: 8 },
  reportRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, padding: 12, marginTop: 10 },
  reportRowActive: { borderColor: theme.colors.primary, backgroundColor: "#EEF2FF" },
  reportTitle: { color: theme.colors.text, fontWeight: "800" },
  reportTitleActive: { color: theme.colors.primary },
  reportMeta: { color: theme.colors.muted, fontWeight: "600", fontSize: 12, marginTop: 3 },
  radio: { color: theme.colors.primary, fontSize: 20, marginLeft: 10 },
  idText: { color: theme.colors.muted, fontSize: 11, marginTop: 10 },
  button: { minHeight: 47, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary, marginTop: 10, paddingHorizontal: 12 },
  buttonSecondary: { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.primary },
  buttonDanger: { backgroundColor: "#92400E" },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#FFFFFF", fontWeight: "900", textAlign: "center" },
  buttonSecondaryText: { color: theme.colors.primary },
  logItem: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
  logTitle: { fontWeight: "900", fontSize: 12 },
  logDetails: { color: theme.colors.text, marginTop: 6, fontSize: 11, lineHeight: 15, fontFamily: "Courier" },
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(CommerceTestScreen);
